import { describe, expect, it } from "vitest";
import { decodeStamp, verifiesStamp } from "../testing.ts";
import { signerPublicKeyCompressedHex, stamp, stampAll } from "./stamp.ts";

describe("stamp", () => {
  it("encodes the Turnkey API stamp JSON", () => {
    const decoded = decodeStamp(stamp("hello"));

    expect(Object.keys(decoded).sort()).toEqual(["publicKey", "scheme", "signature"]);
    expect(decoded.scheme).toBe("SIGNATURE_SCHEME_TK_API_P256");
    expect(decoded.publicKey).toBe(signerPublicKeyCompressedHex);
  });

  it("signs the payload bytes with a DER ECDSA signature", () => {
    const stamped = stamp("hello");

    expect(Buffer.from(decodeStamp(stamped).signature!, "hex")[0]).toBe(0x30);
    expect(verifiesStamp(stamped, "hello")).toBe(true);
    expect(verifiesStamp(stamped, "hellp")).toBe(false);
  });

  it("is base64url without padding", () => {
    expect(stamp("hello")).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("stampAll", () => {
  it("stamps each payload in order", () => {
    const [a, b] = stampAll([
      { digest: "da", payload: "a" },
      { digest: "db", payload: "b" },
    ]);

    expect(a).not.toBe(b);
    expect(verifiesStamp(a!, "a")).toBe(true);
    expect(verifiesStamp(b!, "b")).toBe(true);
  });
});
