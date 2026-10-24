import { createPublicKey, sign } from "node:crypto";
import { persistentSecret } from "../secrets.ts";
import { generateP256Scalar, loadP256Key } from "./keys.ts";
import type { UnsignedPayload } from "./types.ts";

export const walletSigner = persistentSecret("wallet-signer-key", generateP256Scalar);

const signer = loadP256Key(walletSigner.value);

export const signerPublicKeyCompressedHex = signer.publicKeyCompressedHex;
export const signerPublicKey = createPublicKey(signer.privateKey);

export function stamp(payload: string): string {
  const signature = sign("sha256", Buffer.from(payload), signer.privateKey).toString("hex");
  const json = JSON.stringify({
    publicKey: signer.publicKeyCompressedHex,
    signature,
    scheme: "SIGNATURE_SCHEME_TK_API_P256",
  });
  return Buffer.from(json).toString("base64url");
}

export function stampAll(payloads: readonly UnsignedPayload[]): string[] {
  return payloads.map((p) => stamp(p.payload));
}
