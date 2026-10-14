import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Migrates PGlite once per run; test files open copies with openTestDb().
    globalSetup: ["./src/server/db/pglite-global-setup.ts"],
  },
});
