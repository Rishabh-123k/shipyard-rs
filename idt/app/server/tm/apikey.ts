import { createPrivateKey, type KeyObject, type webcrypto } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { errorMessage } from "./errors.ts";

export interface OrgKey {
  keyId: string;
  privateKey: KeyObject;
}

interface KeyFile {
  key_id?: unknown;
  private_key?: { kty?: unknown; crv?: unknown; d?: unknown };
}

function findKeyFileIn(dir: string): string {
  const found = readdirSync(dir).filter((name) => name.endsWith(".json"));
  if (found.length === 1) return join(dir, found[0]!);
  if (found.length === 0) {
    throw new Error(
      `no True Markets API key in ${resolve(dir)}: move the key you downloaded from the developer console into it, or set TM_API_KEY_PATH to its location`,
    );
  }
  throw new Error(`found ${found.length} API key files in ${resolve(dir)} (${found.join(", ")}): set TM_API_KEY_PATH to the one to use`);
}

// Takes the key file the developer console downloads, or a folder holding exactly one JSON file.
export function resolveKeyFile(path: string): string {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ? findKeyFileIn(path) : path;
}

export function readOrgKey(file: string): OrgKey {
  let parsed: KeyFile;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as KeyFile;
  } catch (err) {
    throw new Error(`cannot read the True Markets API key at ${resolve(file)}: ${errorMessage(err)}`);
  }

  const { key_id: keyId, private_key: jwk } = parsed;
  if (typeof keyId !== "string" || jwk?.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string") {
    throw new Error(`${resolve(file)} is not a True Markets API key file (expected key_id and a P-256 private_key)`);
  }
  return { keyId, privateKey: createPrivateKey({ key: jwk as webcrypto.JsonWebKey, format: "jwk" }) };
}
