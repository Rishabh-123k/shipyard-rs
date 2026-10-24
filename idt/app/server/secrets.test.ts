import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubEnv("DATA_FILE", join(mkdtempSync(join(tmpdir(), "tensho-secrets-")), "customers.json"));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("persistentSecret", () => {
  it("generates a secret once and returns the same one afterwards", async () => {
    const { persistentSecret } = await import("./secrets.ts");
    const generate = vi.fn(() => "abc123");

    const first = persistentSecret("wallet-signer-key", generate);
    const second = persistentSecret("wallet-signer-key", generate);

    expect(first).toMatchObject({ value: "abc123", created: true });
    expect(second).toMatchObject({ value: "abc123", created: false });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("writes the secret readable by its owner only", async () => {
    const { persistentSecret } = await import("./secrets.ts");

    const { file } = persistentSecret("wallet-signer-key", () => "abc123");

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
