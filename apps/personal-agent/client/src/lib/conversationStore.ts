import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type StoredConversationMessage = {
  role: "ROLE_USER" | "ROLE_AGENT";
  text: string;
  at: string;
};

export type StoredConversation = {
  userId: string;
  providerUrl: string;
  customerId: string;
  contextId: string;
  messages: StoredConversationMessage[];
  updatedAt: string;
};

const storePath = resolve(process.cwd(), ".data/conversations.json");
let writeQueue: Promise<void> = Promise.resolve();

function normalizeProviderUrl(providerUrl: string): string {
  return providerUrl.replace(/\/+$/, "");
}

async function readStore(): Promise<StoredConversation[]> {
  try {
    const contents = await readFile(storePath, "utf8");
    const entries: unknown = JSON.parse(contents);
    return Array.isArray(entries) ? (entries as StoredConversation[]) : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeStore(entries: StoredConversation[]): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(entries, null, 2), "utf8");
  await rename(temporaryPath, storePath);
}

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function listConversations(input: {
  userId: string;
  providerUrl: string;
  customerId: string;
}): Promise<StoredConversation[]> {
  const providerUrl = normalizeProviderUrl(input.providerUrl);
  const entries = await readStore();
  return entries
    .filter(
      (entry) =>
        entry.userId === input.userId &&
        normalizeProviderUrl(entry.providerUrl) === providerUrl &&
        entry.customerId === input.customerId,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveConversationTurn(input: {
  userId: string;
  providerUrl: string;
  customerId: string;
  contextId: string;
  userText: string;
  agentText: string;
}): Promise<void> {
  return serializeWrite(async () => {
    const entries = await readStore();
    const providerUrl = normalizeProviderUrl(input.providerUrl);
    const existingIndex = entries.findIndex(
      (entry) =>
        entry.userId === input.userId &&
        normalizeProviderUrl(entry.providerUrl) === providerUrl &&
        entry.customerId === input.customerId &&
        entry.contextId === input.contextId,
    );
    const now = Date.now();
    const turnMessages: StoredConversationMessage[] = [
      { role: "ROLE_USER", text: input.userText, at: new Date(now).toISOString() },
      { role: "ROLE_AGENT", text: input.agentText, at: new Date(now + 1).toISOString() },
    ];
    const previous = existingIndex < 0 ? undefined : entries[existingIndex];
    const conversation: StoredConversation = {
      userId: input.userId,
      providerUrl,
      customerId: input.customerId,
      contextId: input.contextId,
      messages: [...(previous?.messages ?? []), ...turnMessages],
      updatedAt: turnMessages[1]!.at,
    };
    if (existingIndex < 0) entries.push(conversation);
    else entries[existingIndex] = conversation;
    await writeStore(entries);
  });
}
