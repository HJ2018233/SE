import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  outputDir: "Lab2/.build/ui/test-results",
  reporter: [
    ["list"],
    ["json", { outputFile: "Lab2/.build/ui/test-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
});
