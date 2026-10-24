import { createPublicKey, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.ts";
import { TMError } from "./errors.ts";
import { deps, TM_API_URL } from "./client.ts";
import { readOrgKey, resolveKeyFile } from "./apikey.ts";
import { mintOrgToken, organizationId, resetTokenCache } from "./token.ts";

const orgPublicKey = createPublicKey(readOrgKey(resolveKeyFile(env.TM_API_KEY_PATH)).privateKey);

function tokenResponse(token: string, expiresInMs: number): Response {
  const body = {
    access_token: token,
    token_type: "Bearer",
    expires_in: new Date(Date.now() + expiresInMs).toISOString(),
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

const originalFetch = deps.fetch;
let fetchMock: ReturnType<typeof vi.fn<typeof deps.fetch>>;

beforeEach(() => {
  resetTokenCache();
  fetchMock = vi.fn<typeof deps.fetch>();
  deps.fetch = fetchMock;
});

afterEach(() => {
  deps.fetch = originalFetch;
});

describe("mintOrgToken", () => {
  it("signs key_id.timestamp as raw r||s ES256", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse("tok-1", 3_600_000));

    const token = await mintOrgToken();

    expect(token).toBe("tok-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${TM_API_URL}/v1/auth/api-key/token`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string) as { key_id: string; timestamp: number; signature: string };
    expect(body.key_id).toBe("8a4f1e2b-6c3d-4e5f-8a9b-0c1d2e3f4a5b");
    expect(Math.abs(body.timestamp - Date.now() / 1000)).toBeLessThan(2);
    const signature = Buffer.from(body.signature, "base64url");
    expect(signature).toHaveLength(64);
    const message = Buffer.from(`${body.key_id}.${body.timestamp}`);
    expect(verify("sha256", message, { key: orgPublicKey, dsaEncoding: "ieee-p1363" }, signature)).toBe(true);
  });

  it("reuses the cached token while it has more than two minutes left", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse("tok-1", 3_600_000));

    await mintOrgToken();
    const second = await mintOrgToken();

    expect(second).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-mints when the cached token expires within two minutes", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1", 60_000))
      .mockResolvedValueOnce(tokenResponse("tok-2", 3_600_000));

    await mintOrgToken();
    const second = await mintOrgToken();

    expect(second).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one exchange between concurrent first callers", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse("tok-1", 3_600_000));

    const tokens = await Promise.all(Array.from({ length: 10 }, () => mintOrgToken()));

    expect(new Set(tokens)).toEqual(new Set(["tok-1"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the auth error envelope as a TMError", async () => {
    const envelope = { type: "unauthenticated", message: "invalid signature", request_id: "r1" };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(envelope), { status: 401 }));

    const err = await mintOrgToken().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TMError);
    expect(err).toMatchObject({ status: 401, body: envelope });
  });

  it("reads the organization id from the token's claims", async () => {
    const claims = Buffer.from(JSON.stringify({ tm: { organization_id: "org-7" } })).toString("base64url");
    fetchMock.mockResolvedValueOnce(tokenResponse(`header.${claims}.signature`, 3_600_000));

    expect(await organizationId()).toBe("org-7");
  });

  it("refuses a token without an organization id", async () => {
    const claims = Buffer.from(JSON.stringify({ tm: {} })).toString("base64url");
    fetchMock.mockResolvedValueOnce(tokenResponse(`header.${claims}.signature`, 3_600_000));

    await expect(organizationId()).rejects.toThrow("no organization_id");
  });
});
