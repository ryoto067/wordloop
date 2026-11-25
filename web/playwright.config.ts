import { defineConfig, devices } from "@playwright/test";

// E2E: スマホ幅 390×844。API(8787) と Web(5173) をローカルで起動して実行する
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
  },
  webServer: [
    {
      command: "npx wrangler d1 migrations apply DB --local && npx wrangler dev --port 8787",
      cwd: "../api",
      url: "http://localhost:8787/api/me",
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      timeout: 120_000,
      // /api/me は未ログインで 401 になるが、サーバーが応答していれば起動済みとみなす
    },
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
