import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = [
  "/explore",
  "/hotel/qt",
  "/book/qt",
  "/orders",
  "/order/HB20260001",
  "/modify/HB20260001",
  "/account",
  "/login",
  "/register",
  "/staff/calendar",
  "/staff/orders",
  "/staff/hotel",
  "/staff/stats",
  "/staff/incidents",
  "/staff/audit",
  "/admin/incidents",
  "/admin/hotels",
  "/admin/accounts",
  "/admin/audit",
];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("hotel-ui-session-v1", "true");
  });
});
async function open(page, route: string) {
  await page.goto(`/#${route}`);
  await expect(page.locator("main")).toHaveAttribute("data-route", route);
  await expect(page.locator("h1")).toBeVisible();
}
async function bookForm(page) {
  await open(page, "/book/qt");
  await page.getByLabel("联系姓名", { exact: false }).fill("演示旅客");
  await page.getByLabel("中国大陆手机号", { exact: false }).fill("13800000000");
  await page.getByRole("checkbox").check();
}

for (const width of [320, 390, 768, 1440]) {
  test(`三类角色全部页面在 ${width}px 无页面横向溢出`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    for (const route of routes) {
      await open(page, route);
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(metrics.scroll, route).toBeLessThanOrEqual(metrics.width + 1);
    }
    expect(errors).toEqual([]);
  });
}

test("预订提交、快速重复点击、刷新查回和取消保留报价", async ({ page }) => {
  await bookForm(page);
  await page
    .getByRole("button", { name: "确认报价并提交预订", exact: true })
    .dblclick();
  await expect(page).toHaveURL(/#\/order\/HB\d+/);
  const id = page.url().split("/").pop();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "房间已预留，等待酒店确认" }),
  ).toBeVisible();
  const count = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).orders.filter(
        (o) => o.id === id,
      ).length,
    id,
  );
  expect(count).toBe(1);
  const quoteBefore = await page
    .getByRole("region", { name: "订单逐晚报价" })
    .innerText();
  await page.getByRole("button", { name: "取消预订", exact: true }).click();
  await page.getByRole("button", { name: "确认取消预订", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "你的预订已取消" }),
  ).toBeVisible();
  expect(
    await page.getByRole("region", { name: "订单逐晚报价" }).innerText(),
  ).toBe(quoteBefore);
});

test("价格变化先重新报价，同意后才能创建", async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("hotel-ui-scenario-v1", "price"),
  );
  await bookForm(page);
  await page
    .getByRole("button", { name: "确认报价并提交预订", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "价格有更新，请重新核对" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).orders.length,
    ),
  ).toBe(11);
  await page
    .getByRole("button", { name: "使用新报价，继续核对", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "确认报价并提交预订", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/order\/HB\d+/);
  await expect(
    page.getByRole("region", { name: "订单逐晚报价" }),
  ).toContainText("¥966");
});

test("无房失败不建单，结果不确定场景可查回同一单", async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("hotel-ui-scenario-v1", "unavailable"),
  );
  await bookForm(page);
  await page
    .getByRole("button", { name: "确认报价并提交预订", exact: true })
    .click();
  await expect(
    page.getByText("本次预订未创建", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).orders.length,
    ),
  ).toBe(11);
  await page.getByRole("button", { name: "原型场景", exact: true }).click();
  await page
    .getByRole("radio", { name: "结果暂未显示，可查回原订单", exact: true })
    .check();
  await page.getByRole("button", { name: "开始体验", exact: true }).click();
  await page
    .getByRole("button", { name: "确认报价并提交预订", exact: true })
    .click();
  await page.getByRole("button", { name: "查回预订结果", exact: true }).click();
  await expect(page).toHaveURL(/#\/order\/HB\d+/);
});

test("改订失败保留原单，仅联系人变化保留原价", async ({ page }) => {
  await open(page, "/modify/HB20260001");
  await page.getByLabel("手机号", { exact: false }).fill("13900000000");
  await page.getByRole("button", { name: "确认修改", exact: true }).click();
  await expect(page).toHaveURL(/#\/order\/HB20260001/);
  const order = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).orders.find(
      (o) => o.id === "HB20260001",
    ),
  );
  expect(order.version).toBe(2);
  expect(order.status).toBe("已确认");
  expect(order.nights.reduce((s, n) => s + n.price, 0)).toBe(93600);
  await open(page, "/modify/HB20260001");
  const original = order.start;
  const incident = await page.evaluate(
    () => JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).incidents[0],
  );
  await page.getByLabel("入住日期", { exact: false }).fill(incident.start);
  await page.getByLabel("离店日期", { exact: false }).fill(incident.end);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认修改", exact: true }).click();
  await expect(
    page.getByText("原订单与房量占用保持有效", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).orders.find(
          (o) => o.id === "HB20260001",
        ).start,
    ),
  ).toBe(original);
});

test("酒店接单、联系方式按需查看和审计脱敏", async ({ page }) => {
  await open(page, "/staff/orders");
  await page
    .getByRole("row")
    .filter({ hasText: "HB20260002" })
    .getByRole("button", { name: "查看与处理" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("13800000000", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "登记用途并查看联系方式" }).click();
  await page
    .getByLabel("查看用途", { exact: false })
    .fill("联系顾客核实到店时间");
  await page
    .getByRole("button", { name: "登记用途并查看", exact: true })
    .click();
  await expect(page.getByText("13800000000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认接单", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("已确认", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭订单详情" }).click();
  await open(page, "/staff/audit");
  await expect(
    page
      .getByRole("region", { name: "审计记录" })
      .getByText("查看完整联系方式", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("13800000000", { exact: false })).toHaveCount(0);
});

test("异常联系中保留原单，联系齐备后按酒店原因取消", async ({ page }) => {
  await open(page, "/admin/incidents");
  const card = page.locator(".incident-contact").first();
  await card
    .getByLabel("联系 / 处理说明", { exact: false })
    .fill("尚未接通，继续联系");
  await card.getByRole("button", { name: "保存联系进度" }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).orders.find(
          (o) => o.id === "HB20260010",
        ).status,
    ),
  ).toBe("已确认");
  await card
    .getByLabel("联系 / 处理说明", { exact: false })
    .fill("已联系顾客并登记酒店原因");
  await card.getByRole("checkbox").check();
  await card.getByRole("button", { name: "按酒店原因取消" }).click();
  await expect(card.getByText("已取消", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "全部处理后完成事件" }),
  ).toBeEnabled();
});

test("日历拒绝过低房量，房型修改限定所属酒店", async ({ page }) => {
  await open(page, "/staff/calendar");
  const occupiedCell = page
    .getByRole("button", { name: /庭院大床房.*可订 11 间，编辑/ })
    .first();
  await occupiedCell.click();
  await page.getByLabel("每日可售总量", { exact: false }).fill("0");
  await page.getByRole("button", { name: "保存所选日期", exact: true }).click();
  await expect(page.getByText("整批未保存", { exact: false })).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await open(page, "/staff/hotel");
  await page
    .locator(".room-edit-row")
    .first()
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByLabel("房型名称", { exact: false }).fill("栖庭庭院房");
  await page.getByRole("button", { name: "保存房型", exact: true }).click();
  await open(page, "/hotel/xw");
  await expect(page.getByText("栖庭庭院房", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("庭院大床房", { exact: true }).first(),
  ).toBeVisible();
  await open(page, "/staff/hotel");
  await page.getByRole("button", { name: "新增房型", exact: true }).click();
  await page.getByLabel("房型名称").fill("栖庭新房型");
  await page.getByRole("button", { name: "保存房型", exact: true }).click();
  await expect(page.getByText("栖庭新房型", { exact: true })).toBeVisible();
  await open(page, "/explore");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(
    page.getByLabel("房型").locator("option", { hasText: "栖庭新房型" }),
  ).toHaveCount(1);
});

test("统计导出与屏幕使用同一金额快照且不含联系信息", async ({ page }) => {
  await open(page, "/staff/stats");
  const display = await page.locator(".summary-amount").innerText();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出这份快照 CSV" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).not.toMatch(/13800000000|演示顾客|联系姓名|手机号/);
  const rows = csv.trim().split("\r\n").slice(1);
  const sum = rows.reduce(
    (s, row) => s + Number(row.split(",").pop()!.replaceAll('"', "")),
    0,
  );
  expect(display).toContain(`¥${sum.toLocaleString("zh-CN")}`);
});

test("键盘打开条件弹窗并关闭后恢复焦点", async ({ page }) => {
  await open(page, "/explore");
  const trigger = page.getByRole("button", { name: /修改住宿条件/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const [clock, released] of [
  ["11:59:00", 1],
  ["12:00:00", 0],
] as const) {
  test(`提前退房 ${clock} 按十二点边界展示间夜`, async ({ page }) => {
    await open(page, "/staff/orders");
    const today = await page.evaluate(() =>
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    await page.clock.setFixedTime(new Date(`${today}T${clock}+08:00`));
    await page
      .getByRole("row")
      .filter({ hasText: "HB20260004" })
      .getByRole("button", { name: "查看与处理" })
      .click();
    await page.getByRole("button", { name: "办理退房", exact: true }).click();
    const confirmation = page.getByRole("dialog").last();
    await expect(confirmation.getByText("已释放", { exact: true })).toHaveCount(
      released,
    );
    await page
      .getByRole("button", { name: "登记实际退房", exact: true })
      .click();
    const order = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).orders.find(
        (o) => o.id === "HB20260004",
      ),
    );
    expect(order.status).toBe("已退房");
    expect(order.nights.length).toBe(2);
    expect(order.nights.reduce((sum, n) => sum + n.price, 0)).toBe(105600);
  });
}

test("手机访客导航具备可读名称与无障碍结构", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/account");
  await page.getByRole("button", { name: "退出演示账户", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "访客，打开账户菜单与原型视图",
      exact: true,
    }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .exclude("[data-tabster-dummy]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

for (const route of [
  "/explore",
  "/hotel/qt",
  "/book/qt",
  "/staff/calendar",
  "/admin/incidents",
]) {
  test(`无障碍自动检查 ${route}`, async ({ page }) => {
    await open(page, route);
    const results = await new AxeBuilder({ page })
      // Tabster's intentional focus sentinels support Fluent keyboard navigation.
      .exclude("[data-tabster-dummy]")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  });
}
