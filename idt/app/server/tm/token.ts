import { sign } from "node:crypto";
import { env } from "../env.ts";
import { readOrgKey, resolveKeyFile } from "./apikey.ts";
import { tmFetch } from "./client.ts";

const REMINT_BEFORE_MS = 120_000;

// The path is resolved apart from the key so nothing derived from the key reaches a log.
export const orgKeyFile = resolveKeyFile(env.TM_API_KEY_PATH);

const orgKey = readOrgKey(orgKeyFile);

interface TokenResponse {
  access_token: string;
  expires_in: string;
}

let cached: { token: string; expiresAt: number } | undefined;
let inflight: Promise<string> | undefined;

export function mintOrgToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() >= REMINT_BEFORE_MS) {
    return Promise.resolve(cached.token);
  }
  inflight ??= exchange().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

// The org token names its organization, so the id never has to be configured.
export async function organizationId(): Promise<string> {
  const token = await mintOrgToken();
  const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
    tm?: { organization_id?: string };
  };
  const id = claims.tm?.organization_id;
  if (!id) throw new Error("the org token carries no organization_id; is this an organization API key?");
  return id;
}

export function resetTokenCache(): void {
  cached = undefined;
  inflight = undefined;
}

async function exchange(): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = Buffer.from(`${orgKey.keyId}.${timestamp}`);
  const signature = sign("sha256", message, {
    key: orgKey.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");

  const body = await tmFetch<TokenResponse>("/v1/auth/api-key/token", {
    method: "POST",
    auth: "none",
    body: { key_id: orgKey.keyId, timestamp, signature },
  });
  cached = { token: body.access_token, expiresAt: Date.parse(body.expires_in) };
  return body.access_token;
}
