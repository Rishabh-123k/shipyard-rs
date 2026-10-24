import { createPublicKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateP256Scalar, loadP256Key } from "./keys.ts";

const SCALAR = "c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721";

function compress(x: string, y: string): string {
  const yBytes = Buffer.from(y, "base64url");
  const prefix = (yBytes.at(-1)! & 1) === 0 ? "02" : "03";
  return prefix + Buffer.from(x, "base64url").toString("hex");
}

describe("loadP256Key", () => {
  it("derives the compressed public key of the private key it builds", () => {
    const key = loadP256Key(SCALAR);

    const { x, y } = createPublicKey(key.privateKey).export({ format: "jwk" });

    expect(key.publicKeyCompressedHex).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(key.publicKeyCompressedHex).toBe(compress(x!, y!));
  });

  it("rejects a scalar that is not 64 hex characters", () => {
    expect(() => loadP256Key(SCALAR.slice(1))).toThrow("64 hex characters");
  });
});

describe("generateP256Scalar", () => {
  it("returns a loadable 64-hex scalar", () => {
    const scalar = generateP256Scalar();

    expect(scalar).toMatch(/^[0-9a-f]{64}$/);
    expect(() => loadP256Key(scalar)).not.toThrow();
  });
});
