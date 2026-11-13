import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".local/browsers");
const { chromium } = await import("playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const out = "Lab2/UI界面";
await mkdir(out, { recursive: true });
const routes = [
  [
    "01",
    "顾客-酒店浏览",
    "/explore",
    "REQ-004、021",
    "错落图文浏览，条件展开编辑。",
  ],
  [
    "02",
    "顾客-选房与逐晚报价",
    "/hotel/qt",
    "REQ-004、005、022",
    "按房型选择，展示逐晚单价、间数和整段总额。",
  ],
  [
    "03",
    "顾客-预订填写",
    "/book/qt",
    "REQ-005、006、016",
    "核对联系信息、住宿条件和报价后提交。",
  ],
  [
    "04",
    "顾客-我的订单",
    "/orders",
    "REQ-013、017",
    "酒店、入住日和七种状态组合筛选。",
  ],
  [
    "05",
    "顾客-订单详情",
    "/order/HB20260001",
    "REQ-009、010、013",
    "查看保存报价、联系信息与处理记录。",
  ],
  [
    "06",
    "顾客-原单保障改订",
    "/modify/HB20260001",
    "REQ-009",
    "原方案和新方案并列比较，成功前保留原单。",
  ],
  [
    "07",
    "顾客-个人中心",
    "/account",
    "REQ-001、016",
    "本人订单入口与联系信息说明。",
  ],
  [
    "08",
    "账户-登录",
    "/login",
    "REQ-001、019",
    "登录交互演示，并提供继续原操作的入口。",
  ],
  [
    "09",
    "账户-顾客注册",
    "/register",
    "REQ-001、019",
    "仅注册顾客身份，管理角色由平台分配。",
  ],
  [
    "10",
    "酒店-房量价格日历",
    "/staff/calendar",
    "REQ-003、017",
    "同日展示价格、占用、总量和可订量；手机按日查看。",
  ],
  [
    "11",
    "酒店-订单处理",
    "/staff/orders",
    "REQ-008、011、013",
    "待确认优先，按当前状态提供履约动作。",
  ],
  [
    "12",
    "酒店-酒店与房型资料",
    "/staff/hotel",
    "REQ-002",
    "维护所属酒店、房型容量与说明。",
  ],
  [
    "13",
    "酒店-统计与导出",
    "/staff/stats",
    "REQ-014",
    "房量、有效间夜约定金额和 CSV 对应同一快照。",
  ],
  [
    "14",
    "酒店-异常处置",
    "/staff/incidents",
    "REQ-012",
    "先停售，逐单联系，保留真实订单状态。",
  ],
  [
    "15",
    "酒店-操作日志",
    "/staff/audit",
    "REQ-015、016",
    "按对象、动作、操作者筛选脱敏追加记录。",
  ],
  [
    "16",
    "平台-异常事件",
    "/admin/incidents",
    "REQ-012、015",
    "从异常事件进入关联订单和联系记录。",
  ],
  [
    "17",
    "平台-酒店管理",
    "/admin/hotels",
    "REQ-001、002",
    "创建、启用或停用酒店，保留历史订单。",
  ],
  [
    "18",
    "平台-账户与权限",
    "/admin/accounts",
    "REQ-001、019",
    "创建工作人员并绑定唯一酒店，管理账户启停。",
  ],
  [
    "19",
    "平台-审计记录",
    "/admin/audit",
    "REQ-015",
    "调查操作过程，不提供业务日志编辑入口。",
  ],
];
const views = [
  ["桌面", 1440, 1000],
  ["手机", 390, 844],
];
const manifest = [];
async function ready(page, route) {
  await page.goto(`http://127.0.0.1:5173/#${route}`);
  await page.locator(`main[data-route="${route}"]`).waitFor();
  await page.locator("h1").waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => img.decode().catch(() => {})),
    );
  });
}
async function capture(page, name, record) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  if (layout.content > layout.viewport + 1)
    throw new Error(`Layout overflow: ${name}: ${JSON.stringify(layout)}`);
  await page.screenshot({
    path: `${out}/${name}.png`,
    fullPage:
      (await page.getByRole("dialog").count()) === 0 &&
      !(record.viewport === "手机" && record.route === "/hotel/qt"),
    animations: "disabled",
  });
  manifest.push({ file: `${name}.png`, ...record, ...layout });
}
for (const [viewport, width, height] of views) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  await context.addInitScript(() =>
    sessionStorage.setItem("hotel-ui-session-v1", "true"),
  );
  const page = await context.newPage();
  for (const [number, title, route, requirements, description] of routes) {
    await ready(page, route);
    await capture(page, `${number}-${title}-${viewport}`, {
      title,
      viewport,
      route,
      requirements,
      description,
    });
    if (route === "/hotel/qt" && viewport === "手机") {
      await page.locator(".room-list").scrollIntoViewIfNeeded();
      await capture(page, "02B-顾客-房型选择-手机", {
        title: "手机选房",
        viewport,
        route,
        requirements,
        description: "滚动查看房型时，固定的报价与预订入口始终可达。",
      });
      await page
        .locator(".hotel-selection .aside-panel")
        .scrollIntoViewIfNeeded();
      await capture(page, "02C-顾客-住宿报价-手机", {
        title: "手机住宿报价",
        viewport,
        route,
        requirements,
        description: "按住宿日核对单价与整段总额。",
      });
    }
  }
  await ready(page, "/explore");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await capture(page, `20-顾客-住宿条件筛选-${viewport}`, {
    title: "住宿条件筛选",
    viewport,
    route: "/explore",
    requirements: "REQ-004",
    description:
      "明确字段标签，包含城市、日期、人数、间数、房型、每晚价格范围。",
  });
  await page.keyboard.press("Escape");
  await ready(page, "/staff/calendar");
  await page.getByRole("button", { name: "批量维护日期", exact: true }).click();
  await capture(page, `21-酒店-批量房量价格编辑-${viewport}`, {
    title: "批量房量价格编辑",
    viewport,
    route: "/staff/calendar",
    requirements: "REQ-003",
    description: "维护住宿日范围、总量、单间价和普通停售。",
  });
  await page.keyboard.press("Escape");
  await ready(page, "/staff/orders");
  if (width < 600)
    await page
      .locator("tr")
      .filter({ hasText: "HB20260002" })
      .getByRole("button", { name: "查看与处理" })
      .click();
  else
    await page
      .getByRole("row")
      .filter({ hasText: "HB20260002" })
      .getByRole("button", { name: "查看与处理" })
      .click();
  await capture(page, `22-酒店-确认订单抽屉-${viewport}`, {
    title: "确认与履约抽屉",
    viewport,
    route: "/staff/orders",
    requirements: "REQ-008、011、016",
    description: "显示期限、掩码电话、逐晚报价和当前可执行动作。",
  });
  await page
    .getByRole("button", { name: "登记用途并查看联系方式", exact: true })
    .click();
  await capture(page, `23-酒店-联系方式用途登记-${viewport}`, {
    title: "联系方式用途登记",
    viewport,
    route: "/staff/orders",
    requirements: "REQ-016",
    description: "完整号码查看前登记具体用途。",
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  for (const [scenario, number, title] of [
    ["price", "24", "顾客-价格变化重新确认"],
    ["unavailable", "25", "顾客-整段无房反馈"],
    ["uncertain", "26", "顾客-预订结果查回"],
  ]) {
    await ready(page, "/book/qt");
    await page.evaluate(
      (value) => sessionStorage.setItem("hotel-ui-scenario-v1", value),
      scenario,
    );
    await page.reload();
    await page.getByLabel("联系姓名").fill("演示旅客");
    await page.getByLabel("中国大陆手机号").fill("13800000000");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "确认报价并提交预订", exact: true })
      .click();
    if (scenario === "price") await page.getByRole("dialog").waitFor();
    else if (scenario === "unavailable")
      await page.getByText("本次预订未创建", { exact: false }).waitFor();
    else await page.getByRole("button", { name: "查回预订结果" }).waitFor();
    await capture(page, `${number}-${title}-${viewport}`, {
      title,
      viewport,
      route: "/book/qt",
      requirements: "REQ-005、006、007、020",
      description:
        scenario === "price"
          ? "并列展示新旧逐晚报价，顾客重新同意前不建单。"
          : scenario === "unavailable"
            ? "指出失败住宿日，不产生半段预订。"
            : "提交结果不确定时查回本次操作，不诱导重复下单。",
    });
    if (scenario === "price") await page.keyboard.press("Escape");
  }
  await ready(page, "/order/HB20260001");
  await page.getByRole("button", { name: "取消预订", exact: true }).click();
  await capture(page, `27-顾客-取消确认-${viewport}`, {
    title: "取消预订确认",
    viewport,
    route: "/order/HB20260001",
    requirements: "REQ-010",
    description: "明确释放尚有效房量并保留报价，取消原因为选填。",
  });
  await page.keyboard.press("Escape");
  await ready(page, "/explore");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByLabel("目的地城市").fill("上海");
  await page.getByRole("button", { name: "查找酒店", exact: true }).click();
  await page
    .getByRole("heading", { name: "暂无匹配的酒店", exact: true })
    .waitFor();
  await capture(page, `28-顾客-查询空结果-${viewport}`, {
    title: "查询空结果",
    viewport,
    route: "/explore",
    requirements: "REQ-004、021",
    description: "保留原查询条件，提供明确的条件修改入口。",
  });
  await context.close();
}
const tablet = await browser.newContext({
  viewport: { width: 768, height: 1024 },
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
await tablet.addInitScript(() =>
  sessionStorage.setItem("hotel-ui-session-v1", "true"),
);
const page = await tablet.newPage();
for (const index of [0, 9, 15]) {
  const [number, title, route, requirements, description] = routes[index];
  await ready(page, route);
  await capture(page, `${number}-${title}-平板`, {
    title,
    viewport: "平板",
    route,
    requirements,
    description,
  });
}
await tablet.close();
await writeFile(
  "Lab2/过程记录/UI截图清单.json",
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      browser: await browser.version(),
      source: "浏览器实际渲染；非平台原生运行截图",
      entries: manifest,
    },
    null,
    2,
  ),
);
const cards = manifest
  .map(
    (item) =>
      `<article><a href="../UI界面/${encodeURIComponent(item.file)}"><img loading="lazy" src="../UI界面/${encodeURIComponent(item.file)}" alt="${item.title} ${item.viewport}" /></a><h2>${item.title} · ${item.viewport}</h2><p>${item.description}</p><small>${item.requirements}</small></article>`,
  )
  .join("");
await writeFile(
  "Lab2/过程记录/UI审阅.html",
  `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>实验二 UI 审阅</title><style>body{font:14px/1.6 system-ui,sans-serif;color:#242424;background:#fafafa;margin:32px}header{max-width:1100px;margin:0 auto 32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}article{background:white;border:1px solid #e0e0e0;padding:16px;border-radius:4px}img{width:100%;height:240px;object-fit:contain;object-position:top;background:#f5f5f5}h2{font-size:18px}small{color:#424242}a{color:#0f6cbd}</style><header><h1>酒店预订系统 · 实验二 UI 审阅</h1><p>共 ${manifest.length} 张实际浏览器截图。点击图片查看原图。交付图片位于 UI界面 目录；本页是本地审阅索引。</p><p>三类角色采用 Fluent UI React v9。桌面、平板和手机是窗口布局检查，尚未进行 Tauri 四平台构建或真机验证。</p></header><main>${cards}</main></html>`,
);
console.log(
  JSON.stringify({
    screenshots: manifest.length,
    manifest: "Lab2/过程记录/UI截图清单.json",
    gallery: "Lab2/过程记录/UI审阅.html",
  }),
);
await browser.close();
