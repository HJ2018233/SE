import { defineConfig } from "@playwright/test";

const live = Boolean(process.env.HOTEL_TEST_BASE_URL);
const results = live ? "Lab3/.build/ui" : "Lab2/.build/ui";

export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  outputDir: `${results}/test-results`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${results}/test-results.json` }],
  ],
  use: {
    baseURL: process.env.HOTEL_TEST_BASE_URL || "http://127.0.0.1:5173",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
});
