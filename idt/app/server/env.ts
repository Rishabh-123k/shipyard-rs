import { existsSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env")) process.loadEnvFile(".env");

const schema = z.object({
  TM_API_KEY_PATH: z.string().default(".secrets"),
  TM_TOKENS: z
    .string()
    .default(
      "SOL,JUP,JTO,PYTH,RAY,ORCA,DRIFT,W,RENDER,HNT,GRASS,BONK,WIF,PENGU,POPCAT,TRUMP,CBBTC@base,AERO@base,MORPHO@base,ZORA@base",
    )
    .transform((list) =>
      list
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  API_PORT: z.coerce.number().int().positive().default(4747),
  DATA_FILE: z.string().default("data/customers.json"),
  IDT_ENGINE_URL: z.string().url().default("http://127.0.0.1:8787"),
  // Where reset links point; the web app in dev.
  APP_URL: z.string().url().default("http://localhost:5173"),
  // Anything but the literal "false" keeps execution disabled.
  DRY_RUN: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),
  MAX_ORDER_USD: z.coerce.number().positive().default(10),
  MAX_TOTAL_USD: z.coerce.number().positive().default(50),
});

type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  // A blank line in .env means "use the default", not "set to empty".
  const raw = Object.fromEntries(
    Object.keys(schema.shape).map((name) => [name, process.env[name] || undefined]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return parsed.data;
}

export const env: Readonly<Env> = Object.freeze(parseEnv());
