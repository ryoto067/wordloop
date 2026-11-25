import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        remoteBindings: false, // AI バインディングを使わずログイン不要でテストする
        miniflare: { bindings: {
            TEST_MIGRATIONS: migrations,
            GOOGLE_CLIENT_ID: "test-client-id",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
            SESSION_SECRET: "test-session-secret",
            VAPID_PUBLIC_KEY: "test-vapid-public-key",
            VAPID_PRIVATE_KEY: "test-vapid-private-key",
            VAPID_SUBJECT: "mailto:test@example.com",
          } },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
