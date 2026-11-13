import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/browsers');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const entries = [
  ['顾客 / 酒店浏览', '01-顾客-酒店浏览-桌面.png'],
  ['手机 / 选房与固定预订入口', '02B-顾客-房型选择-手机.png'],
  ['酒店工作人员 / 房量日历', '10-酒店-房量价格日历-桌面.png'],
  ['平台管理员 / 异常事件', '16-平台-异常事件-桌面.png'],
];
const figures = [];
for (const [label, file] of entries) {
  const data = await readFile(`Lab2/UI界面/${file}`);
  figures.push(`<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${data.toString('base64')}" alt="${label}" /></figure>`);
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#f5f5f5;color:#242424;font:14px/1.5 system-ui,'Noto Sans CJK SC',sans-serif}header{height:80px;display:flex;justify-content:space-between;align-items:start}h1{font-size:32px;line-height:40px;margin:0}p{margin:8px 0;color:#424242}.blue{color:#0f6cbd}main{display:grid;grid-template-columns:2.5fr 1fr 1.4fr;grid-template-rows:430px 430px;gap:24px}figure{margin:0;min-width:0;overflow:hidden;border:1px solid #d1d1d1;background:white;border-radius:4px;box-shadow:0 2px 4px #0000000d}figcaption{height:40px;padding:10px 16px;border-bottom:1px solid #e0e0e0;font-weight:600}img{display:block;width:100%;height:calc(100% - 40px);object-fit:cover;object-position:top}figure:nth-child(1){grid-row:1/3}figure:nth-child(2){grid-row:1/3}figure:nth-child(2) img{object-fit:contain;background:#fafafa}figure:nth-child(3){grid-column:3;grid-row:1}figure:nth-child(4){grid-column:3;grid-row:2}figure:nth-child(n+3) img{object-fit:contain;background:#fafafa}footer{padding-top:16px;color:#424242}</style><header><div><h1>酒店预订系统 <span class="blue">/</span> 实验二 UI</h1><p>旅宿手册 · 三种角色，同一套 Fluent 设计语言</p></div><p>实际浏览器界面截图<br>桌面 · 平板 · 手机布局</p></header><main>${figures.join('')}</main><footer>Fluent UI React v9 · 可点击交互原型 · 61 张课程截图 · 21 项浏览器检查通过</footer></html>`;
const page = await browser.newPage({ viewport: { width: 1800, height: 1050 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
await page.screenshot({ path: 'Lab2/过程记录/UI设计总览.png', fullPage: true });
await writeFile('Lab2/.build/ui/overview.html', html);
await browser.close();
console.log('Lab2/过程记录/UI设计总览.png');
