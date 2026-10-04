const { chromium } = require("@playwright/test");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1700 } });
  await p.goto("file:///home/t-umekawa/sc-ideaquest-G2/doc/%E7%94%BB%E9%9D%A2%E8%A8%AD%E8%A8%88/mocks/style-guide.html");
  await p.waitForTimeout(600);
  await p.getByText("A 最下段", { exact: false }).first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await p.locator(".dash-top2").screenshot({ path: "/tmp/sg-dash-A.png" });
  await b.close(); console.log("ok");
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
