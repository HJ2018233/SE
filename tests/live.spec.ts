import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const base = process.env.HOTEL_TEST_BASE_URL;
const administrator = process.env.HOTEL_TEST_ADMIN;
const adminPassword = process.env.HOTEL_TEST_ADMIN_PASSWORD;

test.skip(
  !base || !administrator || !adminPassword,
  "需要独立的已初始化实验数据库",
);

async function login(
  page: Page,
  name: string,
  password: string,
  register = false,
) {
  await page.goto(`${base}/#/${register ? "register" : "login"}`);
  await page.getByLabel("账户名", { exact: false }).fill(name);
  await page.getByLabel("密码", { exact: false }).fill(password);
  await page
    .getByRole("button", { name: register ? "注册并继续" : "登录并继续" })
    .click();
}

test("三个独立会话完成工作人员分配、顾客预订、酒店确认和回查", async ({
  browser,
}) => {
  const manager = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const desk = await browser.newPage({ viewport: { width: 768, height: 900 } });
  const guest = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const tabs = [manager, desk, guest];
  const pageErrors: string[] = [];
  for (const tab of tabs)
    tab.on("pageerror", (error) => pageErrors.push(error.message));
  const suffix = Date.now().toString(36);
  const employee = `desk-${suffix}`;
  const accountPassword = `First-check-${suffix}`;
  try {
    await login(manager, administrator!, adminPassword!);
    await expect(manager).toHaveURL(/#\/admin\/incidents$/);
    await manager.goto(`${base}/#/admin/accounts`);
    await manager.getByRole("button", { name: "创建工作人员账户" }).click();
    await manager.getByLabel("账户显示名称").fill("浏览器端到端检查");
    await manager.getByLabel("登录账户名").fill(employee);
    await manager.getByLabel("初始密码").fill(accountPassword);
    await manager.getByLabel("唯一所属酒店").selectOption("qt");
    await manager.getByRole("button", { name: "创建并绑定酒店" }).click();
    await expect(manager.getByText(employee, { exact: true })).toBeVisible();

    await login(guest, `guest-${suffix}`, accountPassword, true);
    await expect(guest).toHaveURL(/#\/orders$/);
    await guest.goto(`${base}/#/hotel/qt`);
    await guest
      .getByRole("button", { name: "填写预订" })
      .filter({ visible: true })
      .click();
    await guest.getByLabel("联系姓名", { exact: false }).fill("测试旅客");
    await guest
      .getByLabel("中国大陆手机号", { exact: false })
      .fill("13800009911");
    await expect(
      guest.getByRole("region", { name: "逐晚报价", exact: false }).first(),
    ).toContainText("¥");
    await guest.getByRole("checkbox").check();
    await guest
      .getByRole("button", { name: "确认报价并提交预订", exact: true })
      .click();
    await expect(guest).toHaveURL(/#\/order\/HB[0-9a-f]+$/);
    const id = guest.url().split("/").pop()!;
    await expect(
      guest.getByRole("heading", { name: "房间已预留，等待酒店确认" }),
    ).toBeVisible();
    expect(
      await guest.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(391);

    await login(desk, employee, accountPassword);
    await expect(desk).toHaveURL(/#\/staff\/calendar$/);
    await desk.goto(`${base}/#/staff/orders`);
    await desk.getByLabel("查找订单编号").fill(id);
    const row = desk.getByRole("row").filter({ hasText: id });
    await expect(row).toBeVisible();
    await row.getByRole("button").click();
    await desk.getByRole("button", { name: "确认接单" }).click();
    await expect(desk.getByText("处理结果已更新。")).toBeVisible();
    await desk.getByRole("button", { name: "登记用途并查看联系方式" }).click();
    await desk.getByLabel("查看用途").selectOption("booking");
    await desk
      .getByRole("button", { name: "登记用途并查看", exact: true })
      .click();
    await expect(desk.getByText("测试旅客", { exact: true })).toBeVisible();
    await expect(desk.getByText("13800009911", { exact: true })).toBeVisible();

    await desk.goto(`${base}/#/staff/stats`);
    const download = desk.waitForEvent("download");
    await desk.getByRole("button", { name: "导出这份快照 CSV" }).click();
    const csv = await readFile(await (await download).path(), "utf8");
    expect(csv).toContain(id);
    expect(csv).not.toContain("测试旅客");
    expect(csv).not.toContain("13800009911");

    await guest.reload();
    await expect(
      guest.getByRole("heading", { name: "住宿已确认，期待这次停留" }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "取消预订", exact: true }).click();
    await guest.getByRole("button", { name: "确认取消预订" }).click();
    await expect(
      guest.getByRole("heading", { name: "你的预订已取消" }),
    ).toBeVisible();

    await guest.goto(`${base}/#/admin/accounts`);
    await expect(
      guest.getByRole("heading", { name: "此页面需要相应账户权限" }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all(tabs.map((page) => page.close()));
  }
});
