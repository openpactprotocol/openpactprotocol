import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DelegationScheme } from "@openpactprotocol/client/delegation";

// Demo-only token store. A production personal agent keeps delegation and
// refresh tokens in encrypted, per-user storage.

export type StoredDelegation = {
  userId: string;
  customerId: string;
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  expiresAt: number;
};

export type PendingAuthorization = {
  id: string;
  userId: string;
  customerId: string;
  businessName: string;
  providerUrl: string;
  conversationId: string;
  text: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresAt: number;
  lastPolledAt?: number;
  scheme: DelegationScheme;
};

type Store = { tokens: StoredDelegation[]; pending: PendingAuthorization[] };

const storePath = resolve(process.cwd(), ".data/pa-delegations.json");
let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<Store>;
    return { tokens: parsed.tokens ?? [], pending: parsed.pending ?? [] };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { tokens: [], pending: [] };
    }
    throw error;
  }
}

function update(change: (store: Store) => void): Promise<void> {
  const result = writeQueue.then(async () => {
    const store = await readStore();
    change(store);
    await mkdir(dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
    await rename(temporaryPath, storePath);
  });
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function getDelegation(
  userId: string,
  customerId: string,
): Promise<StoredDelegation | undefined> {
  return (await readStore()).tokens.find(
    (token) => token.userId === userId && token.customerId === customerId,
  );
}

export function saveDelegation(delegation: StoredDelegation): Promise<void> {
  return update((store) => {
    store.tokens = store.tokens.filter(
      (token) => token.userId !== delegation.userId || token.customerId !== delegation.customerId,
    );
    store.tokens.push(delegation);
  });
}

export function deleteDelegation(userId: string, customerId: string): Promise<void> {
  return update((store) => {
    store.tokens = store.tokens.filter(
      (token) => token.userId !== userId || token.customerId !== customerId,
    );
  });
}

export async function getPendingAuthorization(
  id: string,
  userId: string,
): Promise<PendingAuthorization | undefined> {
  return (await readStore()).pending.find((entry) => entry.id === id && entry.userId === userId);
}

export function savePendingAuthorization(pending: PendingAuthorization): Promise<void> {
  return update((store) => {
    store.pending = store.pending.filter((entry) => entry.id !== pending.id);
    store.pending.push(pending);
  });
}

export function deletePendingAuthorization(id: string): Promise<void> {
  return update((store) => {
    store.pending = store.pending.filter((entry) => entry.id !== id);
  });
}
