"use server";

import { randomUUID } from "node:crypto";
import { createPlatformSigner } from "@openpactprotocol/client";
import { PlatformRegistrationResponseSchema } from "@openpactprotocol/protocol";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  defaultPlatformName,
  homePath,
  parseCustomerIds,
  USER_ID_COOKIE,
  USER_ID_COOKIE_OPTIONS,
  type RegistrationNotice,
} from "../lib/session.js";

type Connection = { providerUrl: string; customerIds: string[] };
function readConnection(formData: FormData): Connection {
  return {
    providerUrl:
      String(formData.get("providerUrl") ?? "").trim() ||
      process.env.PROVIDER_URL ||
      "http://localhost:3000",
    customerIds: parseCustomerIds(
      String(formData.get("customerIds") ?? process.env.CUSTOMER_IDS ?? ""),
    ),
  };
}

async function setUserId(userId: string): Promise<void> {
  (await cookies()).set(USER_ID_COOKIE, userId, USER_ID_COOKIE_OPTIONS);
}

export async function connect(formData: FormData): Promise<void> {
  const userId = String(formData.get("userId") ?? "").trim();
  if (userId) await setUserId(userId);
  redirect(homePath(readConnection(formData)));
}

export async function newUser(formData: FormData): Promise<void> {
  await setUserId(randomUUID());
  redirect(homePath(readConnection(formData)));
}

export async function registerPersonalAgent(formData: FormData): Promise<void> {
  const connection = readConnection(formData);
  const name = defaultPlatformName();
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  if (!issuer || !privateJwk)
    throw new Error("Set PA_ISSUER and PA_PRIVATE_JWK in the server environment");
  let registration: RegistrationNotice;
  try {
    const endpoint = `${connection.providerUrl.replace(/\/+$/, "")}/api/platforms`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await createPlatformSigner({ issuer, privateJwk }).sign({ sub: issuer, aud: endpoint })}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, jwksUri: `${issuer}/.well-known/jwks.json` }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `Registration failed (${response.status})`;
      throw new Error(response.status === 401 ? "Unauthorized" : error);
    }
    PlatformRegistrationResponseSchema.parse(body);
    registration = { status: response.status === 201 ? "created" : "existing", name };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Registration failed";
    registration = { status: "error", name, message };
  }
  redirect(homePath({ ...connection, registration }));
}
