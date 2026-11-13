import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".local/browsers");
const { chromium } = await import("playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];
await mkdir("Lab2/.build/ui", { recursive: true });
for (const [label, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
]) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173/#/explore");
  await page.locator("h1").waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) => image.decode().catch(() => {})),
    );
  });
  await page.screenshot({
    path: `Lab2/.build/ui/${label}-initial.png`,
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      label,
      ...(await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        title: document.querySelector("h1")?.textContent,
        buttons: document.querySelectorAll("button").length,
      }))),
    }),
  );
  await page.close();
}
console.log(JSON.stringify({ errors }));
await writeFile(
  "Lab2/.build/ui/probe.json",
  JSON.stringify({ errors }, null, 2),
);
await browser.close();
