import puppeteer from 'puppeteer-core';

// 本地端到端冒烟：驱动静态预览页跑完一局混战，输出中途与冠军截图。
// 用法：先 `npm run pages`（默认 4173 端口），另开终端 `npm run e2e`。
// 可用 CHROME_PATH / E2E_URL / E2E_OUT 覆盖默认值。
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const URL = process.env.E2E_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.E2E_OUT || '/tmp';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
// /api/health 探测在纯静态模式下必然 404，属于预期行为，不计为错误。
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (t.includes('Failed to load resource') && t.includes('404')) return;
  errs.push('console: ' + t);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready(tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => document.getElementById('royaleBtn'), { timeout: 20000 });
      await page.waitForFunction(() => document.documentElement.dataset.backend === 'local', { timeout: 15000 });
      return true;
    } catch { await sleep(800); }
  }
  return false;
}

if (!(await ready())) { console.log('LOAD FAILED'); await browser.close(); process.exit(1); }

await page.evaluate(() => {
  document.getElementById('rosterBtn').click();
  const ta = document.getElementById('rosterText');
  ta.value = ['赵子龙', '关云长', '张翼德', '吕奉先', '马孟起', '黄汉升', '夏侯惇', '许仲康', '太史慈', '周幼平', '陆伯言', '甘兴霸'].join('\n');
  document.getElementById('rosterCountInput').value = '12';
  document.getElementById('rosterReplace').click();
});
await sleep(900);
const stateInfo = await page.evaluate(async () => {
  const { LocalBackend } = await import('./backend.js');
  const b = new LocalBackend();
  const s = await b.state();
  return { fighters: s.fighters.length, disabled: document.getElementById('royaleBtn').disabled };
});
console.log('STATE:', JSON.stringify(stateInfo));

await page.screenshot({ path: OUT + '/ui-before.png' });

await page.evaluate(() => document.getElementById('royaleBtn').click());
await sleep(1300);
await page.screenshot({ path: OUT + '/brawl-early.png' });
await sleep(2800);
await page.screenshot({ path: OUT + '/brawl-mid.png' });

let champ = null;
for (let i = 0; i < 50; i++) {
  await sleep(500);
  champ = await page.evaluate(() => {
    const b = document.getElementById('championBanner');
    return b && b.style.display !== 'none' && b.innerText.includes('冠军') ? b.innerText.replace(/\n/g, ' | ') : null;
  });
  if (champ) break;
}
await sleep(1000);
await page.screenshot({ path: OUT + '/ui-after.png' });
const log = await page.evaluate(() => [...document.querySelectorAll('.log-line')].slice(0, 6).map((l) => l.textContent));
console.log('CHAMPION:', champ || '(none)');
console.log('EXCEPTIONS:', errs.length);
if (errs.length) console.log(errs.slice(0, 4).join('\n'));
console.log('LOG:', JSON.stringify(log, null, 0));
await browser.close();
