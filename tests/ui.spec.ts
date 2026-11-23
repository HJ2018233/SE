import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { DemoData } from "../src/model";

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

for (const width of [320, 390, 768, 1440, 2560, 3840]) {
  test(`三类角色全部页面在 ${width}px 无页面横向溢出`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({
      width,
      height: width >= 2560 ? (width * 9) / 16 : width < 600 ? 844 : 1000,
    });
    for (const route of routes) {
      await open(page, route);
      const metrics = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        main: document.querySelector("main")!.clientWidth,
      }));
      expect(metrics.scroll, route).toBeLessThanOrEqual(metrics.width + 1);
      if (width >= 2560)
        expect(metrics.main, route).toBeGreaterThanOrEqual(metrics.width - 1);
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

test("长订单号和 14 晚报价在短窗口中可完整查看并接单", async ({ page }) => {
  const id = "HB1234567890abcdef1234567890abcdef";
  await page.setViewportSize({ width: 640, height: 520 });
  await open(page, "/staff/orders");
  await page.evaluate((orderId) => {
    const key = "hotel-ui-demo-v1";
    const data = JSON.parse(localStorage.getItem(key)!) as DemoData;
    const order = data.orders.find((item) => item.id === "HB20260002")!;
    order.id = orderId;
    order.end = new Date(Date.parse(order.start) + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    order.nights = Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.parse(order.start) + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
      price: 49800,
    }));
    order.history.unshift({ time: "11-21 10:05", text: "长订单滚动检查" });
    localStorage.setItem(key, JSON.stringify(data));
  }, id);
  await page.reload();

  const openOrder = page
    .getByRole("row")
    .filter({ hasText: id })
    .getByRole("button", { name: "查看与处理" });
  await openOrder.evaluate((button) => {
    window.scrollTo({
      top: scrollY + button.getBoundingClientRect().top - innerHeight / 2,
      behavior: "instant",
    });
  });
  await expect(openOrder).toBeInViewport({ ratio: 0.99 });
  await openOrder.click();
  await page.setViewportSize({ width: 320, height: 460 });
  const drawer = page.getByRole("dialog");
  const details = drawer.getByRole("region", { name: "订单明细" });
  const confirm = drawer.getByRole("button", { name: "确认接单", exact: true });
  await expect(drawer.getByText(id, { exact: true })).toBeInViewport({
    ratio: 0.99,
  });
  await expect(
    drawer.getByRole("button", { name: "关闭订单详情" }),
  ).toBeInViewport();
  await expect(drawer.getByText("入住 — 离店")).toBeInViewport();
  await expect(confirm).toBeInViewport();
  await details.press("End");
  await expect(details.getByText("长订单滚动检查")).toBeInViewport();
  await expect(confirm).toBeInViewport();
  await confirm.click();
  await expect(drawer.getByText("已确认", { exact: true })).toBeVisible();
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

test("管理端使用工作台业务标题并清理旧营销标题", async ({ page }) => {
  const forbidden = [
    "让客人先读懂这家酒店",
    "把每一晚，安排妥当",
    "下一位客人，准备就绪",
    "每一个间夜，都有来处",
    "把意外，一件件妥善处理",
    "让每一次处理，有迹可循",
    "每一家酒店，都有清晰的边界",
    "让职责，与酒店对应",
  ];
  for (const [route, heading] of [
    ["/staff/calendar", "房量与价格日历"],
    ["/staff/orders", "订单处理"],
    ["/staff/hotel", "酒店与房型资料"],
    ["/staff/stats", "统计与导出"],
    ["/staff/incidents", "异常处置"],
    ["/staff/audit", "操作日志"],
    ["/admin/incidents", "异常事件管理"],
    ["/admin/hotels", "酒店管理"],
    ["/admin/accounts", "账户与权限"],
    ["/admin/audit", "平台审计记录"],
  ] as const) {
    await open(page, route);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    const text = await page.locator("main").innerText();
    for (const phrase of forbidden) expect(text).not.toContain(phrase);
  }
});

test("自定义 Fluent 日历限制公历天数且支持键盘 Escape 分层关闭", async ({
  page,
}) => {
  await open(page, "/explore");
  await page.getByRole("button", { name: /修改住宿条件/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "打开日历选择日期" }).first().click();
  const popover = page.getByRole("group", { name: "日历日期选择" });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("button", { name: "2026年11月30日" })).toBeVisible();
  await expect(popover.getByRole("button", { name: "2026年11月31日" })).toHaveCount(0);

  await popover.getByRole("button", { name: "2026年11月30日" }).focus();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(dialog).toBeVisible();

  const startInput = dialog.getByLabel("入住日期");
  await startInput.fill("2026-11-31");
  await expect(dialog.getByText("该公历日期不存在", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "查找酒店", exact: true }).click();
  await expect(dialog).toBeVisible();

  await startInput.fill("2026-11-28");
  await dialog.getByRole("button", { name: "查找酒店", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("日历编辑支持房型切换、直接输入小数价格与十元步进及退格清空", async ({
  page,
}) => {
  await open(page, "/staff/calendar");
  await page.getByRole("button", { name: "批量维护日期", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("房型").selectOption("window");
  const priceInput = dialog.getByLabel("每晚单间价（元）");
  await expect(priceInput).toHaveValue("498");

  await dialog.getByRole("button", { name: "加价 10 元" }).click();
  await expect(priceInput).toHaveValue("508");

  await priceInput.fill("");
  await expect(priceInput).toHaveValue("");
  await priceInput.fill("512.50");
  await expect(priceInput).toHaveValue("512.50");

  const qtyInput = dialog.getByLabel("每日可售总量");
  await qtyInput.fill("");
  await expect(qtyInput).toHaveValue("");
  await qtyInput.fill("15");

  await dialog.getByRole("button", { name: "保存所选日期", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: /临窗大床房.*¥512\.50.*可订 15 间，编辑/ })
      .first(),
  ).toBeVisible();
});

test("选房页整卡可点，改订页隐藏目的地城市输入", async ({ page }) => {
  await open(page, "/hotel/qt");
  await page.locator(".room-option").filter({ hasText: "临窗大床房" }).click();
  await expect(page.locator("aside.aside-panel")).toContainText("临窗大床房");

  await open(page, "/modify/HB20260001");
  await expect(page.getByLabel("目的地城市")).toHaveCount(0);
});

test("酒店订单处理在 600–1200px 临界宽度无筛选框重叠与状态徽章溢出", async ({
  page,
}) => {
  for (const width of [600, 601, 640, 700, 768, 820, 821, 900, 1000, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "/staff/orders");
    const check = await page.evaluate(() => {
      const docOverflow =
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1;
      const filterItems = [...document.querySelectorAll(".filter-bar > *")]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      const overlaps: string[] = [];
      for (let i = 0; i < filterItems.length; i++) {
        for (let j = i + 1; j < filterItems.length; j++) {
          const a = filterItems[i];
          const b = filterItems[j];
          const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (vOverlap > 4 && hOverlap > 2) {
            overlaps.push(`${i}-${j}:${Math.round(hOverlap)}px`);
          }
        }
      }
      const badBadges = [...document.querySelectorAll(".fui-Badge")]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          return (
            el.scrollHeight > el.clientHeight + 1 ||
            el.scrollWidth > el.clientWidth + 1 ||
            getComputedStyle(el).whiteSpace !== "nowrap"
          );
        })
        .map((el) => el.textContent?.trim() || "");
      return { docOverflow, overlaps, badBadges };
    });
    expect(check.docOverflow, `width ${width} docOverflow`).toBe(false);
    expect(check.overlaps, `width ${width} filter overlaps`).toEqual([]);
    expect(check.badBadges, `width ${width} wrapped/overflowed badges`).toEqual([]);
  }
});

test("酒店资料编辑区域与标语、未保存提示、顾客页预览及相册闭环", async ({
  page,
}) => {
  await open(page, "/staff/hotel");
  await page.getByLabel("所在区域（选填）").fill("夫子庙秦淮带");
  await page.getByLabel("一句话介绍（选填）").fill("枕水而居的安静庭院。");
  await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "预览顾客页面", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "顾客页面预览" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("夫子庙秦淮带");
  await expect(preview).toContainText("枕水而居的安静庭院。");
  await expect(preview).toContainText("尚未保存的酒店资料修改");
  await preview.getByRole("button", { name: "关闭顾客页面预览" }).click();

  await page.getByRole("button", { name: "保存酒店资料", exact: true }).click();
  await expect(page.getByText("有未保存修改", { exact: true })).toHaveCount(0);

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("选择酒店图片文件").setInputFiles({
    name: "courtyard-custom.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await expect(page.getByText("已添加 3 / 12 张", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "从示例图库选取", exact: true }).click();
  const presetDialog = page.getByRole("dialog", { name: "从内置示例图库选取" });
  await presetDialog.getByRole("button", { name: "加入相册" }).nth(1).click();
  await expect(page.getByText("已添加 4 / 12 张", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "设为封面" }).first().click();
  await page.getByRole("button", { name: "将第 3 张照片后移" }).click();
  await page.getByRole("button", { name: "删除第 4 张照片" }).click();
  await expect(page.getByText("已添加 3 / 12 张", { exact: false })).toBeVisible();

  await open(page, "/hotel/qt");
  await expect(page.getByText("夫子庙秦淮带", { exact: false })).toBeVisible();
  const tiles = page.locator(".detail-gallery .gallery-tile");
  await expect(tiles).toHaveCount(3);
  await tiles.first().click();
  const lightbox = page.getByRole("dialog");
  await expect(lightbox).toContainText("1 / 3");
  await lightbox.getByRole("button", { name: "下一张照片" }).click();
  await expect(lightbox).toContainText("2 / 3");
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
});

test("管理员新建酒店不借用其他酒店图片且无空分隔符", async ({ page }) => {
  await open(page, "/admin/hotels");
  await page.getByRole("button", { name: "创建酒店", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建酒店" });
  await dialog.getByLabel("酒店名称", { exact: false }).fill("钟山 · 云舍");
  await dialog.getByLabel("城市", { exact: false }).fill("南京");
  await dialog.getByLabel("联系电话", { exact: false }).fill("025-88888888");
  await dialog.getByLabel("地址", { exact: false }).fill("南京市玄武区陵园路 1 号");
  await dialog.getByRole("button", { name: "创建酒店", exact: true }).click();

  const card = page.locator(".hotel-admin-card", { hasText: "钟山 · 云舍" });
  await expect(card).toBeVisible();
  await expect(card.locator(".hotel-image-placeholder")).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  const text = await card.innerText();
  expect(text).not.toContain("·  ·");

  const newId = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("hotel-ui-demo-v1")!).hotels.find(
        (h) => h.name === "钟山 · 云舍",
      ).id,
  );
  await open(page, `/hotel/${newId}`);
  await expect(page.locator(".detail-gallery.is-empty")).toBeVisible();
  await expect(page.getByText("暂无实景照片", { exact: true }).first()).toBeVisible();
});

test("不可订房型显示不可订原因而非 ¥0、城市建议可选、手机端我的订单抽屉筛选", async ({
  page,
}) => {
  await open(page, "/hotel/qt");
  await page.getByRole("button", { name: "修改日期与人数" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("group", { name: "可订城市建议" })
    .getByRole("button", { name: "南京", exact: true })
    .click();
  await dialog.getByLabel("入住人数", { exact: false }).fill("3");
  await dialog.getByRole("button", { name: "查找酒店", exact: true }).click();

  const firstRoom = page.locator(".room-option").first();
  await expect(firstRoom).toContainText("当前不可订");
  await expect(firstRoom).toContainText("人数超限（最多可住 2 人）");
  await expect(firstRoom.locator(".room-price")).not.toContainText("¥0");
  await expect(page.getByRole("button", { name: "填写预订" }).first()).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/orders");
  await expect(page.locator(".orders-filter-bar")).toBeHidden();
  await expect(page.locator(".mobile-orders-bar")).toBeVisible();
  await page
    .locator(".mobile-orders-bar")
    .getByRole("button", { name: /筛选/ })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("订单状态").selectOption("已确认");
  await drawer.getByRole("button", { name: /查看订单/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(".order-card").first()).toContainText("已确认");
});

for (const route of [
  "/explore",
  "/hotel/qt",
  "/book/qt",
  "/orders",
  "/order/HB20260001",
  "/staff/calendar",
  "/staff/orders",
  "/staff/hotel",
  "/staff/stats",
  "/admin/incidents",
  "/admin/accounts",
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
