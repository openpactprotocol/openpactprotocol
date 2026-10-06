import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: Number(process.env.E2E_TEST_TIMEOUT_MS ?? 60_000),
  },
});
