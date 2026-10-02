import { createPlatformSigner } from "@openpactprotocol/client";
import {
  DeviceCodeClient,
  OAuthError,
  fetchAuthorizationServerMetadata,
  verifyReceipt,
  type DelegationScheme,
  type Receipt,
} from "@openpactprotocol/client/delegation";
import {
  getConversation,
  saveConversation,
  type ReceiptSummary,
  type SignInCard,
} from "./conversationStore.js";
import {
  deleteDelegation,
  deletePendingAuthorization,
  getDelegation,
  getPendingAuthorization,
  saveDelegation,
  savePendingAuthorization,
} from "./delegationStore.js";

type Credentials = { userId: string; issuer: string; privateJwk: string; audience: string };

function paToken(credentials: Credentials): () => Promise<string> {
  const signer = createPlatformSigner({
    issuer: credentials.issuer,
    privateJwk: credentials.privateJwk,
  });
  return () => signer.sign({ sub: credentials.userId, aud: credentials.audience });
}

export function deviceCodeClient(scheme: DelegationScheme, credentials: Credentials) {
  return new DeviceCodeClient({
    scheme,
    clientId: credentials.issuer,
    getToken: paToken(credentials),
  });
}

// Stored delegation token for (user, Brand), refreshed when close to expiry.
export async function currentDelegationToken(
  customerId: string,
  scheme: DelegationScheme,
  credentials: Credentials,
): Promise<string | undefined> {
  const stored = await getDelegation(credentials.userId, customerId);
  if (!stored) return undefined;
  if (stored.expiresAt - 60_000 > Date.now()) return stored.accessToken;
  if (!stored.refreshToken) {
    await deleteDelegation(credentials.userId, customerId);
    return undefined;
  }
  try {
    const token = await deviceCodeClient(scheme, credentials).refresh(stored.refreshToken);
    await saveDelegation({
      userId: credentials.userId,
      customerId,
      accessToken: token.accessToken,
      ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      scopes: token.scopes,
      expiresAt: token.expiresAt,
    });
    return token.accessToken;
  } catch {
    await deleteDelegation(credentials.userId, customerId);
    return undefined;
  }
}

export async function checkReceipt(
  receipt: Receipt,
  input: { scheme: DelegationScheme; pa: string; brand: string },
): Promise<ReceiptSummary> {
  const summary = {
    grantId: receipt.claims.grantId,
    scopesUsed: receipt.claims.scopesUsed,
    actions: receipt.claims.actions.map((action) => action.tool),
  };
  try {
    const metadata = await fetchAuthorizationServerMetadata(input.scheme.metadataUrl);
    await verifyReceipt(receipt, {
      jwks: metadata.jwks_uri,
      expected: { pa: input.pa, brand: input.brand },
    });
    return { verified: true, ...summary };
  } catch {
    return { verified: false, ...summary };
  }
}

export async function startAuthorization(input: {
  credentials: Credentials;
  scheme: DelegationScheme;
  customerId: string;
  businessName: string;
  providerUrl: string;
  conversationId: string;
  text: string;
  missingScopes: string[];
}): Promise<SignInCard> {
  // Ask for every scope on the card; the User can switch any of them off at consent.
  const scopes = [
    ...new Set([...input.missingScopes, ...input.scheme.scopes.map((scope) => scope.id)]),
  ];
  const authorization = await deviceCodeClient(input.scheme, input.credentials).start(scopes);
  const id = crypto.randomUUID();
  await savePendingAuthorization({
    id,
    userId: input.credentials.userId,
    customerId: input.customerId,
    businessName: input.businessName,
    providerUrl: input.providerUrl,
    conversationId: input.conversationId,
    text: input.text,
    deviceCode: authorization.deviceCode,
    intervalSeconds: authorization.intervalSeconds,
    expiresAt: authorization.expiresAt,
    scheme: input.scheme,
  });
  return {
    authorizationId: id,
    customerId: input.customerId,
    businessName: input.businessName,
    url: authorization.verificationUriComplete,
    scopes,
    status: "pending",
  };
}

export type PollOutcome =
  | { status: "pending" }
  | { status: "connected"; text: string; grantedScopes: string[] }
  | { status: "denied" | "expired" };

async function updateCard(
  pending: { userId: string; providerUrl: string; conversationId: string; id: string },
  patch: Partial<SignInCard>,
): Promise<void> {
  const conversation = await getConversation({
    userId: pending.userId,
    providerUrl: pending.providerUrl,
    id: pending.conversationId,
  });
  if (!conversation) return;
  conversation.messages = conversation.messages.map((message) =>
    message.role === "personal-agent" && message.signIn?.authorizationId === pending.id
      ? { ...message, signIn: { ...message.signIn, ...patch } }
      : message,
  );
  await saveConversation(conversation);
}

export async function pollAuthorization(
  authorizationId: string,
  credentials: Credentials,
): Promise<PollOutcome> {
  const pending = await getPendingAuthorization(authorizationId, credentials.userId);
  if (!pending) return { status: "expired" };
  const now = Date.now();
  const finish = async (status: "denied" | "expired"): Promise<PollOutcome> => {
    await deletePendingAuthorization(pending.id);
    await updateCard(pending, { status });
    return { status };
  };
  if (now >= pending.expiresAt) return finish("expired");
  if (pending.lastPolledAt && now - pending.lastPolledAt < pending.intervalSeconds * 1000) {
    return { status: "pending" };
  }
  await savePendingAuthorization({ ...pending, lastPolledAt: now });
  try {
    const result = await deviceCodeClient(pending.scheme, credentials).poll(pending.deviceCode);
    if (result.status === "slow_down") {
      await savePendingAuthorization({
        ...pending,
        lastPolledAt: now,
        intervalSeconds: pending.intervalSeconds + 5,
      });
      return { status: "pending" };
    }
    if (result.status === "pending") return { status: "pending" };
    await saveDelegation({
      userId: credentials.userId,
      customerId: pending.customerId,
      accessToken: result.token.accessToken,
      ...(result.token.refreshToken ? { refreshToken: result.token.refreshToken } : {}),
      scopes: result.token.scopes,
      expiresAt: result.token.expiresAt,
    });
    await deletePendingAuthorization(pending.id);
    await updateCard(pending, { status: "connected", grantedScopes: result.token.scopes });
    return { status: "connected", text: pending.text, grantedScopes: result.token.scopes };
  } catch (error) {
    if (error instanceof OAuthError && error.error === "access_denied") return finish("denied");
    if (error instanceof OAuthError) return finish("expired");
    throw error;
  }
}
