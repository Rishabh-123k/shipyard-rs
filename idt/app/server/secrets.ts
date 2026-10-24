import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "./env.ts";

export const DATA_DIR = dirname(env.DATA_FILE);

export interface PersistentSecret {
  value: string;
  file: string;
  created: boolean;
}

// Generated on first boot and kept in data/, so a disposable run needs no key setup.
export function persistentSecret(name: string, generate: () => string): PersistentSecret {
  const file = join(DATA_DIR, name);
  if (existsSync(file)) return { value: readFileSync(file, "utf8").trim(), file, created: false };
  const value = generate();
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(file, value, { mode: 0o600 });
  return { value, file, created: true };
}
