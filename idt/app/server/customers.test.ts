import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataFile: string;

function loadStore() {
  return import("./customers.ts");
}

beforeEach(() => {
  dataFile = join(mkdtempSync(join(tmpdir(), "tensho-customers-")), "nested", "customers.json");
  vi.stubEnv("DATA_FILE", dataFile);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("customers", () => {
  it("finds a created customer by email regardless of case and verifies the password", async () => {
    const store = await loadStore();
    const created = store.createCustomer("Maya@Example.com", "password123");

    const found = store.findByEmail("maya@EXAMPLE.com");

    expect(found?.id).toBe(created.id);
    expect(found?.external_ref_id).toMatch(/^cust_[A-Za-z0-9_-]{1,59}$/);
    expect(store.verifyPassword(found!, "password123")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const store = await loadStore();
    const created = store.createCustomer("maya@example.com", "password123");

    expect(store.verifyPassword(created, "password124")).toBe(false);
  });

  it("refuses a second account for the same email", async () => {
    const store = await loadStore();
    store.createCustomer("maya@example.com", "password123");

    expect(() => store.createCustomer("MAYA@example.com", "other-password")).toThrow(store.EmailTaken);
  });

  it("persists the gateway user across a reload", async () => {
    const store = await loadStore();
    const created = store.createCustomer("maya@example.com", "password123");
    const wallets = [
      { chain_family: "solana", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
      { chain_family: "evm", address: "0x3fA9b1C47e0D2a8F5E6c9B04d71A2F8e5b3Cc21E" },
    ];
    store.setGatewayUser(created.id, { user_id: "user-1", wallets });

    vi.resetModules();
    const reloaded = (await loadStore()).findById(created.id);

    expect(reloaded?.user_id).toBe("user-1");
    expect(reloaded?.wallets).toEqual(wallets);
  });

  it("never writes the plaintext password", async () => {
    const store = await loadStore();
    store.createCustomer("maya@example.com", "hunter2-plaintext");

    expect(readFileSync(dataFile, "utf8")).not.toContain("hunter2-plaintext");
  });
});
