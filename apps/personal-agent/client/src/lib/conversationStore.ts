import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type PhoneMessage =
  | { role: "user"; text: string; at: string }
  | { role: "business"; customerId: string; businessName: string; text: string; at: string }
  | { role: "personal-agent"; text: string; at: string };

export type ThreadMessage = {
  role: "ROLE_USER" | "ROLE_AGENT";
  text: string;
  at: string;
};

export type BusinessThread = {
  customerId: string;
  businessName: string;
  contextId: string;
  messages: ThreadMessage[];
  awaitingReply: boolean;
};

export type PaConversation = {
  id: string;
  userId: string;
  providerUrl: string;
  messages: PhoneMessage[];
  threads: BusinessThread[];
  createdAt: string;
  updatedAt: string;
};

const storePath = resolve(process.cwd(), ".data/pa-conversations.json");
let writeQueue: Promise<void> = Promise.resolve();

function normalizeProviderUrl(providerUrl: string): string {
  return providerUrl.replace(/\/+$/, "");
}

async function readStore(): Promise<PaConversation[]> {
  try {
    const contents = await readFile(storePath, "utf8");
    const entries: unknown = JSON.parse(contents);
    return Array.isArray(entries) ? (entries as PaConversation[]) : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeStore(entries: PaConversation[]): Promise<void> {
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
}): Promise<PaConversation[]> {
  const providerUrl = normalizeProviderUrl(input.providerUrl);
  const entries = await readStore();
  return entries
    .filter(
      (entry) =>
        entry.userId === input.userId && normalizeProviderUrl(entry.providerUrl) === providerUrl,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(input: {
  userId: string;
  providerUrl: string;
  id: string;
}): Promise<PaConversation | undefined> {
  const providerUrl = normalizeProviderUrl(input.providerUrl);
  const entries = await readStore();
  return entries.find(
    (entry) =>
      entry.id === input.id &&
      entry.userId === input.userId &&
      normalizeProviderUrl(entry.providerUrl) === providerUrl,
  );
}

export function saveConversation(conversation: PaConversation): Promise<void> {
  return serializeWrite(async () => {
    const entries = await readStore();
    const normalized = {
      ...conversation,
      providerUrl: normalizeProviderUrl(conversation.providerUrl),
    };
    const existingIndex = entries.findIndex((entry) => entry.id === conversation.id);
    if (existingIndex < 0) entries.push(normalized);
    else entries[existingIndex] = normalized;
    await writeStore(entries);
  });
}
