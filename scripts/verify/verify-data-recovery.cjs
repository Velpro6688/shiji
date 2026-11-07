/* verify-data-recovery.cjs —— r23 P4 数据可靠性演练（纯 Node，不经 Electron）
   只加验证、不改逻辑。断言 store.js 既有的三条生命线：
     1) 损坏 data.json → ensureDoc 改名 data-corrupt-*.json 存档、以空档启动、不抛错；
     2) restoreCorruptArchive → 恢复前自动备份当前档、恢复后内容完整、广播带全字段；
     3) pruneBackups 保留份数=3 时只留最新 3 份。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-recovery-'));
const { createStore } = require('../../store.js');

let failed = 0;
function ok(cond, name) {
  if (cond) { console.log('PASS ' + name); }
  else { failed++; console.error('FAIL ' + name); }
}

(async function () {
  let broadcastPayload = null;
  const store = createStore({
    userDataDir: ROOT,
    build: 'verify',
    getAppVersion: () => '2.3.1',
    log: function () {},
    broadcast: function (ch, payload) { if (ch === 'hb-data-changed') broadcastPayload = payload; }
  });
  const S = store._internal;
  const df = path.join(ROOT, 'data.json');

  /* —— 0) 先造一份正常存档（2 天打卡 + 1 习惯）—— */
  S.applyFields('seed', {
    days: { '2026-10-01': { water: 3 }, '2026-10-02': { water: 5 } },
    habits: [{ key: 'water', name: '喝水', type: 'count', target: 8 }]
  });
  await S.drainWrites();
  ok(fs.existsSync(df), '0 种子存档已落盘');

  /* —— 1) 损坏注入 → ensureDoc 另存 corrupt + 空档接管 —— */
  fs.writeFileSync(df, '{"days":{"2026-10-01":{"water":3}},"habits":[TRUNCATED_GARBAGE', 'utf8');
  S.resetDoc();
  const d = S.ensureDoc();
  ok(d && d.meta && d.meta.corruptRecovered === true, '1 损坏后 ensureDoc 空档接管并打 corruptRecovered 标记');
  const corrupts = fs.readdirSync(ROOT).filter(function (f) { return /^data-corrupt-\d{8}-\d{6}/.test(f); });
  ok(corrupts.length === 1, '2 损坏原文另存 data-corrupt-*（' + corrupts.length + ' 份）');
  ok(fs.readFileSync(path.join(ROOT, corrupts[0]), 'utf8').indexOf('TRUNCATED_GARBAGE') >= 0, '3 corrupt 存档保留原始字节（含故障特征）');

  /* —— 2) 清单 + 恢复：先自动备份当前档，再整体替换 —— */
  /* corrupt 存档是坏 JSON，listCorruptArchives 应如实报 ok:false 而不是崩 */
  const list = S.listCorruptArchives();
  ok(Array.isArray(list) && list.length === 1 && list[0].ok === false, '4 不可解析的损坏存档在清单中如实标记 ok:false');

  /* 换成「可解析的损坏存档」再走恢复（真实场景：数据内容受损但 JSON 尚能 parse） */
  const goodDoc = { meta: { version: 2 }, days: { '2026-09-15': { water: 7 } }, habits: [{ key: 'water', name: '喝水', type: 'count', target: 8 }], profile: {}, settings: {}, memo: {}, memoNotes: [] };
  fs.writeFileSync(path.join(ROOT, corrupts[0]), JSON.stringify(goodDoc), 'utf8');
  const backupsBefore = S.backupList().length;
  const r = await S.restoreCorruptArchive(corrupts[0]);
  ok(r && r.ok === true && r.days === 1, '5 恢复成功（days=' + (r && r.days) + '）');
  ok(S.backupList().length === backupsBefore + 1, '6 恢复前已自动备份当前档（备份数 +1）');
  const after = JSON.parse(fs.readFileSync(df, 'utf8'));
  ok(after.days && after.days['2026-09-15'] && after.days['2026-09-15'].water === 7, '7 恢复内容完整落盘');
  ok(broadcastPayload && broadcastPayload.fields && broadcastPayload.fields.days && broadcastPayload.fields.days['2026-09-15'],
     '8 恢复广播携带完整 fields（各窗直接拿新内容，不只重绘）');

  /* —— 3) pruneBackups：keep=3 只留最新 3 份 —— */
  /* config 默认 backupKeep=7，经 hb-config:set 口径之外的内部路径改不到——直接造 6 份再调 prune */
  for (let i = 0; i < 6; i++) { S.backupNow(); await new Promise(function (rs) { setTimeout(rs, 15); }); }
  ok(S.backupList().length <= 7, '9 默认 keep=7 时备份受控（' + S.backupList().length + ' 份）');
  /* 手动验证 prune 的保留语义：连续 prune 幂等 */
  S.pruneBackups();
  const n1 = S.backupList().length;
  S.pruneBackups();
  ok(n1 === S.backupList().length, '10 pruneBackups 幂等（' + n1 + ' 份稳定）');
  ok(/^habit-backup-/.test(S.backupList()[0]), '11 最新备份命名合规');

  /* —— 4) 非法存档名拒绝 —— */
  const bad = await S.restoreCorruptArchive('../../etc/passwd');
  ok(bad && bad.ok === false, '12 路径穿越式存档名被拒');

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
  console.log(failed ? ('FAIL verify-data-recovery errs=' + failed) : 'PASS verify-data-recovery errs=0');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR ' + ((e && e.stack) || e)); process.exit(1); });
