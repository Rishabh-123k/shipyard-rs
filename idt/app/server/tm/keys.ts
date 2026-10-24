import { createECDH, createPrivateKey, type KeyObject } from "node:crypto";
import { HEX_SCALAR } from "../../shared/validation.ts";

interface P256Key {
  privateKey: KeyObject;
  publicKeyCompressedHex: string;
}

export function loadP256Key(hexScalar: string): P256Key {
  if (!HEX_SCALAR.test(hexScalar)) {
    throw new Error("P-256 private key must be 64 hex characters");
  }
  const scalar = Buffer.from(hexScalar, "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);

  const point = ecdh.getPublicKey();
  const publicJwk = {
    kty: "EC",
    crv: "P-256",
    x: point.subarray(1, 33).toString("base64url"),
    y: point.subarray(33, 65).toString("base64url"),
  };
  const privateKey = createPrivateKey({
    key: { ...publicJwk, d: scalar.toString("base64url") },
    format: "jwk",
  });

  return {
    privateKey,
    publicKeyCompressedHex: ecdh.getPublicKey("hex", "compressed"),
  };
}

export function generateP256Scalar(): string {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return ecdh.getPrivateKey("hex").padStart(64, "0");
}
