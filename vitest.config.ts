import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // setup.ts points DATABASE_URL at an in-memory SQLite db BEFORE any module
    // imports config.ts (which reads env at import time). Each test file runs in
    // its own worker/process, so the in-memory db is isolated per file.
    setupFiles: ["./test/setup.ts"]
  }
});
