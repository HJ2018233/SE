import { spawnSync } from "node:child_process";

const endpoint = process.env.VITE_API_BASE_URL;
let url;
try {
  url = new URL(endpoint);
} catch {
  console.error("请将 VITE_API_BASE_URL 设置为酒店服务的 HTTPS 源地址。");
  process.exit(1);
}
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
) {
  console.error(
    "VITE_API_BASE_URL 应为 HTTPS 源地址，例如 https://hotel.example.edu。",
  );
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npm, ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.error) console.error(build.error.message);
process.exit(build.status ?? 1);
