import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "web/**/*.test.ts"],
    env: {
      TM_API_KEY_PATH: "server/tm/testdata",
      // Tests never touch the real customer store or session secret in data/.
      DATA_FILE: join(mkdtempSync(join(tmpdir(), "tensho-test-")), "customers.json"),
      TM_TOKENS: "SOL,PENGU,AERO@base",
    },
  },
});
