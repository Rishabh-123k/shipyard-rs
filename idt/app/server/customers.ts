import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { env } from "./env.ts";
import { DATA_DIR } from "./secrets.ts";
import type { OrganizationUserWallet } from "./tm/types.ts";

export type Wallet = OrganizationUserWallet;

export interface Customer {
  id: string;
  email: string;
  password: { salt: string; hash: string };
  external_ref_id: string;
  user_id: string | null;
  wallets: Wallet[];
  created_at: string;
}

interface CustomerFile {
  customers: Customer[];
}

export class EmailTaken extends Error {
  constructor() {
    super("an account with this email already exists");
    this.name = "EmailTaken";
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

const DATA_FILE = env.DATA_FILE;

const store: CustomerFile = existsSync(DATA_FILE)
  ? (JSON.parse(readFileSync(DATA_FILE, "utf8")) as CustomerFile)
  : { customers: [] };

function persist(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, DATA_FILE);
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, SCRYPT);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findByEmail(email: string): Customer | undefined {
  const normalized = normalizeEmail(email);
  return store.customers.find((c) => c.email === normalized);
}

export function findById(id: string): Customer | undefined {
  return store.customers.find((c) => c.id === id);
}

export function createCustomer(email: string, password: string): Customer {
  if (findByEmail(email)) throw new EmailTaken();

  const id = randomUUID();
  const salt = randomBytes(16);
  const customer: Customer = {
    id,
    email: normalizeEmail(email),
    password: { salt: salt.toString("hex"), hash: hashPassword(password, salt).toString("hex") },
    external_ref_id: `cust_${id}`,
    user_id: null,
    wallets: [],
    created_at: new Date().toISOString(),
  };
  store.customers.push(customer);
  persist();
  return customer;
}

export function verifyPassword(customer: Customer, password: string): boolean {
  const expected = Buffer.from(customer.password.hash, "hex");
  const actual = hashPassword(password, Buffer.from(customer.password.salt, "hex"));
  return timingSafeEqual(expected, actual);
}

export function setGatewayUser(id: string, user: { user_id: string; wallets: Wallet[] }): Customer {
  const customer = findById(id);
  if (!customer) throw new Error(`unknown customer ${id}`);
  customer.user_id = user.user_id;
  customer.wallets = user.wallets.map(({ chain_family, address }) => ({ chain_family, address }));
  persist();
  return customer;
}
