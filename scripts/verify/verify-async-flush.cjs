/* verify-async-flush.cjs —— r23 写路径异步化回归（纯 Node，不经 Electron）
   场景还原：连续 50 次字段变更（模拟高频打卡）后「立即退出」。
   旧版同步写在 before-quit 里 flush 即落盘；异步化后必须靠 drainWrites 排空写链，
   否则末次变更可能仍滞留在内存/.tmp 阶段。本套件断言：
     1) drainWrites 后 data.json 含全部 50 次变更（合并语义：最后写入的 days 生效）；
     2) 无 .tmp 残留（原子写 rename 完成）；
     3) 退出拦截链路存在：main.js before-quit 必须调 drainWrites 而非裸 flush；
     4) 写失败退避不丢数据：注入一次写失败后补轮仍能落盘。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-flush-'));
const { createStore } = require('../../store.js');

let failed = 0;
function ok(cond, name) {
  if (cond) { console.log('PASS ' + name); }
  else { failed++; console.error('FAIL ' + name); }
}

(async function () {
  const store = createStore({
    userDataDir: ROOT,
    build: 'verify',
    getAppVersion: () => '2.3.1',
    log: function () {},
    broadcast: function () {}
  });
  const S = store._internal;

  /* —— 1) 连续 50 次变更 + 立即排空 —— */
  const days = {};
  for (let i = 0; i < 50; i++) {
    days['2026-01-' + String(i % 28 + 1).padStart(2, '0')] = { water: i };
    S.applyFields('t' + i, { days: Object.assign({}, days), meta: { n: i } });
  }
  await S.drainWrites();
  const df = path.join(ROOT, 'data.json');
  ok(fs.existsSync(df), '1 data.json 已落盘');
  const doc = JSON.parse(fs.readFileSync(df, 'utf8'));
  ok(doc.meta && doc.meta.n === 49, '2 末次变更（meta.n=49）在档——退出不丢最后一笔');
  ok(doc.days && doc.days['2026-01-22'] && doc.days['2026-01-22'].water === 49, '3 末次 days 内容正确（i=49 → 2026-01-22）');
  ok(fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.tmp'); }).length === 0, '4 无 .tmp 残留');

  /* —— 2) 退出拦截：main.js 的 before-quit 必须走 drainWrites —— */
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const bq = mainSrc.match(/before-quit[\s\S]{0,600}/);
  ok(!!bq && bq[0].indexOf('drainWrites') >= 0 && bq[0].indexOf('preventDefault') >= 0,
     '5 main.js before-quit 拦截退出并等待 drainWrites');

  /* —— 3) 写失败退避后补轮落盘（注入一次性 rename 失败） —— */
  const fsp = fs.promises;
  const origRename = fsp.rename;
  let injected = 0;
  fsp.rename = async function (a, b) {
    if (injected++ === 0 && String(b).endsWith('data.json')) throw new Error('injected rename failure');
    return origRename.call(fsp, a, b);
  };
  try {
    S.applyFields('fail1', { meta: { afterFail: true } });
    await S.drainWrites();
    /* 失败会置 writePending 并经退避补轮；最多等 8s（退避封顶 5s + 余量） */
    const t0 = Date.now();
    let okFlag = false;
    while (Date.now() - t0 < 8000) {
      await new Promise(function (r) { setTimeout(r, 200); });
      await S.drainWrites();
      try {
        const d2 = JSON.parse(fs.readFileSync(df, 'utf8'));
        if (d2.meta && d2.meta.afterFail === true) { okFlag = true; break; }
      } catch (_) {}
    }
    ok(okFlag, '6 注入写失败后指数退避补轮，最终落盘不丢数据');
  } finally {
    fsp.rename = origRename;
  }

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
  console.log(failed ? ('FAIL verify-async-flush errs=' + failed) : 'PASS verify-async-flush errs=0');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR ' + ((e && e.stack) || e)); process.exit(1); });
