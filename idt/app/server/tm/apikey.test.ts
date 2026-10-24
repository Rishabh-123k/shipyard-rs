import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readOrgKey, resolveKeyFile } from "./apikey.ts";

const FIXTURE = "server/tm/testdata/truemarkets-org-api-key-test.json";

function folder(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "tensho-key-"));
  for (const name of files) copyFileSync(FIXTURE, join(dir, name));
  return dir;
}

describe("api key file", () => {
  it("reads the key file the console downloads", () => {
    const key = readOrgKey(FIXTURE);

    expect(key.keyId).toBe("8a4f1e2b-6c3d-4e5f-8a9b-0c1d2e3f4a5b");
    expect(key.privateKey.asymmetricKeyType).toBe("ec");
  });

  it("finds the one key file in a folder, whatever it is named", () => {
    const dir = folder("prod-key (1).json");
    writeFileSync(join(dir, ".gitkeep"), "");

    expect(resolveKeyFile(dir)).toBe(join(dir, "prod-key (1).json"));
  });

  it("finds the console's download by its own name", () => {
    const dir = folder("truemarkets-org-api-key-b232524f.json");

    expect(resolveKeyFile(dir)).toBe(join(dir, "truemarkets-org-api-key-b232524f.json"));
  });

  it("explains where to put a key when the folder has none", () => {
    expect(() => resolveKeyFile(folder())).toThrow("move the key you downloaded from the developer console into it");
  });

  it("names the candidates when the folder has several keys", () => {
    const dir = folder("truemarkets-org-api-key-a.json", "truemarkets-org-api-key-b.json");

    expect(() => resolveKeyFile(dir)).toThrow("truemarkets-org-api-key-a.json, truemarkets-org-api-key-b.json");
  });

  it("rejects a file that is not an API key", () => {
    const dir = folder();
    const file = join(dir, "truemarkets-org-api-key-bad.json");
    writeFileSync(file, JSON.stringify({ key_id: "k" }));

    expect(() => readOrgKey(file)).toThrow("is not a True Markets API key file");
  });

  it("reports a path that does not exist", () => {
    expect(() => readOrgKey("/nonexistent/truemarkets-org-api-key-x.json")).toThrow("cannot read the True Markets API key");
  });
});
