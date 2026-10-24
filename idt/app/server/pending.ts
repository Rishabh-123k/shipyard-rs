import type { UnsignedPayload } from "./tm/types.ts";

export interface Prepared {
  id: string;
  payloads: UnsignedPayload[];
}

interface Entry<R> {
  customerId: string;
  request: R;
  payloads: UnsignedPayload[];
  preparedAt: number;
}

const MAX_AGE_MS = 5 * 60_000;
// A Solana payload carries the blockhash from prepare time, which the network drops after about a minute.
const REPREPARE_AFTER_MS = 20_000;

// In-process only: a second instance or a restart between prepare and execute answers "quote expired".
export class QuoteCache<R> {
  readonly #entries = new Map<string, Entry<R>>();

  put(id: string, customerId: string, request: R, payloads: UnsignedPayload[]): number {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (now - entry.preparedAt > MAX_AGE_MS) this.#entries.delete(key);
    }
    this.#entries.set(id, { customerId, request, payloads, preparedAt: now });
    return now;
  }

  take(id: string, customerId: string): Entry<R> | undefined {
    const entry = this.#entries.get(id);
    if (!entry || entry.customerId !== customerId) return undefined;
    this.#entries.delete(id);
    return Date.now() - entry.preparedAt > MAX_AGE_MS ? undefined : entry;
  }

  // A stale quote is prepared again from the reviewed request, never from anything the browser sends later.
  async signable(id: string, customerId: string, reprepare: (request: R) => Promise<Prepared>): Promise<Prepared | undefined> {
    const entry = this.take(id, customerId);
    if (!entry) return undefined;
    if (Date.now() - entry.preparedAt > REPREPARE_AFTER_MS) return reprepare(entry.request);
    return { id, payloads: entry.payloads };
  }
}
