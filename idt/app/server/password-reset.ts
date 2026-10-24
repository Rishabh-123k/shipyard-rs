import { createHash, randomBytes } from "node:crypto";

const TTL_MS = 15 * 60_000;
// One link per account per window, so the endpoint can't be used to flood the terminal.
const REISSUE_AFTER_MS = 30_000;

interface Pending {
  customerId: string;
  issuedAt: number;
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

// In-process and hashed: a restart invalidates outstanding links, and the store never holds a usable token.
export class ResetTokens {
  readonly #byHash = new Map<string, Pending>();

  issue(customerId: string, now = Date.now()): string | null {
    for (const [hash, p] of this.#byHash) {
      if (now - p.issuedAt > TTL_MS) this.#byHash.delete(hash);
      else if (p.customerId === customerId) {
        if (now - p.issuedAt < REISSUE_AFTER_MS) return null;
        this.#byHash.delete(hash);
      }
    }
    const token = randomBytes(32).toString("base64url");
    this.#byHash.set(digest(token), { customerId, issuedAt: now });
    return token;
  }

  consume(token: string, now = Date.now()): string | undefined {
    const hash = digest(token);
    const pending = this.#byHash.get(hash);
    this.#byHash.delete(hash);
    if (!pending || now - pending.issuedAt > TTL_MS) return undefined;
    return pending.customerId;
  }
}

export type ResetNotifier = (email: string, link: string) => void;

// No email service is configured, so the link goes to the server's own terminal: only someone at this
// machine can use it. Swap this for a real mailer before running IDT anywhere shared.
export const printResetLink: ResetNotifier = (email, link) => {
  console.log(`\n[password reset] link for ${email} (valid 15 minutes, single use):\n  ${link}\n`);
};
