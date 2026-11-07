/* verify-backup2 —— store.js 主进程数据层直测（v2.1 新增，任务 1/3/4 配套）
   隔离 harness 可以 require store.js —— 真实断言（不再是代码审查）：
   1) migrateLegacy 直调：旧档 → data.json + legacy-backup-v1.json 副本；
   2) applyFields/flush：字段合并 + 原子落盘（无 .tmp 残留）；
   3) 备份轮转：keep=3 时连续 5 次备份只留 3 份，最旧的被剪；images/ 一并纳入备份；
   4) backupStatus：lastAt/count/intervalDays/keep/root 口径完整；
   5) 数据目录迁移：copy→校验→切根；旧根保留；purgeOldRoot 只清数据不碰其他文件；
   6) 孤儿图片延迟回收：未引用但 mtime 新 → 不删（保护未保存图）；mtime 超 7 天 → 删；
   7) 性能（两段式之「改造后·新存储协议基线」）：500 天 applyFields+flush 耗时与档大小。 */
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const H = require('./_harness.js');

const NAME = 'verify-backup2';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const PROF = H.initProfile(NAME);

/* 配置先行落盘：keep=3 / 每天一备 */
fs.writeFileSync(path.join(PROF, 'app-config.json'), JSON.stringify({ backupIntervalDays: 1, backupKeep: 3 }), 'utf8');

app.whenReady().then(async () => {
  try {
    const { createStore } = require(path.join(H.ROOT, 'store.js'));
    const bcalls = [];
    const store = createStore({
      userDataDir: PROF, build: 'test', getAppVersion: () => '2.1.0-test',
      log: function () {}, broadcast: (ch, p) => bcalls.push([ch, p])
    });
    store.registerIpc();
    const S = store._internal;

    /* —— 1) migrateLegacy 直调 —— */
    const legacy = JSON.stringify({
      meta: { notifiedStreak: {} },
      days: { '2026-09-01': { water: 3, early: true } },
      habits: [{ key: 'water', name: '喝水', icon: '💧', type: 'count', target: 8, unit: '杯', color: '#7FA0B4', size: 'wide' }],
      profile: { name: '用户', avatar: '☕' }, settings: { remind: true, sound: true }
    });
    const mig = S.migrateLegacy(legacy);
    suite.ok(mig && mig.ok === true && mig.doc && mig.doc.meta.version === 2, 'migrateLegacy：旧档迁移为 v2');
    suite.ok(fs.existsSync(path.join(PROF, 'legacy-backup-v1.json')), 'migrateLegacy：原文副本 legacy-backup-v1.json 落盘');
    suite.ok(fs.readFileSync(path.join(PROF, 'legacy-backup-v1.json'), 'utf8') === legacy, '副本与原文逐字节一致');

    /* —— 2) applyFields + flush 原子落盘 —— */
    S.applyFields('t1', { days: { '2026-01-01': { water: 3 } }, meta: { foo: 1 } });
    suite.ok(S.flush() === false, 'flush：挂起写入已清空');
    await S.drainWrites();   /* r23：写路径已异步化，落盘完成以 drainWrites 为准 */
    suite.ok(fs.existsSync(path.join(PROF, 'data.json')), 'data.json 已落盘');
    suite.ok(fs.readdirSync(PROF).filter(f => f.indexOf('.tmp') >= 0).length === 0, '原子写：无 .tmp 残留');
    const savedDoc = JSON.parse(fs.readFileSync(path.join(PROF, 'data.json'), 'utf8'));
    suite.ok(savedDoc.days['2026-01-01'] && savedDoc.days['2026-01-01'].water === 3 && savedDoc.meta.version === 2, '落盘内容：days 合并 + version=2');

    /* —— 3) 备份轮转 keep=3 —— */
    fs.mkdirSync(path.join(PROF, 'images'), { recursive: true });
    fs.writeFileSync(path.join(PROF, 'images', 'img1.png'), 'PNGDATA', 'utf8');
    const names = [];
    for (let i = 0; i < 5; i++) { const r = S.backupNow(); if (r && r.ok) names.push(r.name); await H.sleep(15); }
    suite.ok(names.length === 5, '连续 5 次备份目录名互不相同（含毫秒）');
    const list = S.backupList();
    suite.ok(list.length === 3, '保留份数=3：实际 ' + list.length + ' 份');
    suite.ok(!list.includes(names[0]) && !list.includes(names[1]) && list.includes(names[4]), '最旧的备份被剪除、最新保留');
    const latestDir = path.join(PROF, 'auto-backup', list[0]);
    suite.ok(fs.existsSync(path.join(latestDir, 'data.json')) && fs.existsSync(path.join(latestDir, 'images', 'img1.png')), '备份包含 data.json + images/（图片纳入）');
    suite.ok(fs.existsSync(path.join(latestDir, 'info.json')), '备份附 info.json（版本/构建/时间）');

    /* —— 4) backupStatus —— */
    const st = S.backupStatus();
    suite.ok(st.ok && st.count === 3 && st.intervalDays === 1 && st.keep === 3 && st.lastAt > 0 && st.root === PROF, 'backupStatus 口径完整（count=3 interval=1 keep=3 lastAt>0 root）');

    /* —— 5) 数据目录迁移 + 旧根清理 —— */
    const NEWROOT = path.join(PROF, '..', PROF.split(/[\\/]/).pop() + '-newroot');
    try { fs.rmSync(NEWROOT, { recursive: true, force: true }); } catch (_) {}
    const mv = await S.setDataRoot({ dataDir: NEWROOT, portable: false });
    suite.ok(mv && mv.ok === true && mv.moved === true, 'setDataRoot：迁移成功');
    suite.ok(fs.existsSync(path.join(NEWROOT, 'data.json')) && fs.existsSync(path.join(NEWROOT, 'images', 'img1.png')), '新根：data.json + images 已就位');
    suite.ok(fs.existsSync(path.join(NEWROOT, 'auto-backup', list[0])), '新根：历史备份一并迁移');
    suite.ok(fs.existsSync(path.join(PROF, 'data.json')), '旧根数据迁移后保留（未自动删除）');
    const cfg = S.loadConfig();
    suite.ok(cfg.dataDir && path.resolve(cfg.dataDir) === path.resolve(NEWROOT), '配置已指向新根');
    const pg = await S.purgeOldRoot();
    suite.ok(pg && pg.ok === true, 'purgeOldRoot：执行成功');
    suite.ok(!fs.existsSync(path.join(PROF, 'data.json')) && !fs.existsSync(path.join(PROF, 'auto-backup')), '旧根数据与备份已清理');
    suite.ok(fs.existsSync(path.join(PROF, 'app-config.json')) && fs.existsSync(path.join(NEWROOT, 'data.json')), '配置文件留在 userData、新根数据完好');
    /* 迁移回默认（还原现场），便于复跑 */
    const mv2 = await S.setDataRoot({ dataDir: '', portable: false });
    suite.ok(mv2 && mv2.ok === true, 'setDataRoot：迁回默认根');
    try { fs.rmSync(NEWROOT, { recursive: true, force: true }); } catch (_) {}

    /* —— 6) 孤儿图片延迟回收 —— */
    const gcId = 'gc_' + Date.now().toString(36);
    fs.writeFileSync(path.join(NEWROOT === undefined ? PROF : PROF, 'images', gcId + '.png'), 'ORPHAN', 'utf8');
    suite.ok(S.gcImages() === 0, 'GC：未引用但 mtime 新 → 不删（保护刚粘贴/未保存的图）');
    const gcPath = path.join(PROF, 'images', gcId + '.png');
    const old = new Date(Date.now() - 8 * 864e5);
    fs.utimesSync(gcPath, old, old);
    suite.ok(S.gcImages() >= 1, 'GC：未引用且 mtime 超 7 天 → 回收');
    suite.ok(!fs.existsSync(gcPath), 'GC：过期孤儿文件已删除');

    /* —— 6b) r19 回归：**被便签引用的**图片即使超过 7 天也绝不能被回收 ——
       历史事故：gcImages 用 x.slice(9) 切 hbimg:// id（前缀实为 8 字符），
       被引用的 id 永远匹配不上引用集 → 7 天后被当孤儿删除，已造成真实图片丢失。
       旧测试只造「未引用」的孤儿，因此该缺陷长期漏检（引用图必须在场才能覆盖）。 */
    const refId = 'iref' + Date.now().toString(36);
    const refPath = path.join(PROF, 'images', refId + '.jpg');
    fs.writeFileSync(refPath, 'REFERENCED', 'utf8');
    S.applyFields('gc-ref', { memo: { html: '<img src="hbimg://' + refId + '" crossorigin="anonymous">' } });
    S.flush();
    const refOld = new Date(Date.now() - 8 * 864e5);
    fs.utimesSync(refPath, refOld, refOld);
    S.gcImages();
    suite.ok(fs.existsSync(refPath), 'GC：★被便签引用的图片（超 7 天）必须保留——不得当孤儿删除');
    /* 反向对照：同一时刻同目录下的真孤儿仍应被回收（证明 GC 本身没被改坏） */
    const orphan2 = 'gc2_' + Date.now().toString(36);
    const orphan2Path = path.join(PROF, 'images', orphan2 + '.png');
    fs.writeFileSync(orphan2Path, 'ORPHAN2', 'utf8');
    fs.utimesSync(orphan2Path, refOld, refOld);
    S.gcImages();
    suite.ok(!fs.existsSync(orphan2Path), 'GC：同批真孤儿仍被回收（对照，证明 GC 未被改坏）');
    S.applyFields('gc-ref', { memo: {} });   /* 清掉引用，避免影响后续用例 */

    /* —— 7) 性能：新存储协议基线（500 天，两段式之「改造后」） —— */
    const bigDays = {};
    for (let i = 0; i < 500; i++) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
      bigDays[ds] = { water: (i % 8) + 1, early: (i % 2) === 0, exercise: (i % 3) !== 0, meditation: (i % 4) !== 0, reading: Math.round((i % 10)) / 10, sleep: 8, mood: i % 3 === 0 ? 'happy' : undefined };
    }
    const t0 = Date.now();
    S.applyFields('perf', { days: bigDays, habits: [], meta: {}, settings: {}, profile: {} });
    S.flush();
    await S.drainWrites();   /* r23：bytes 统计须等异步落盘完成 */
    const ms = Date.now() - t0;
    const bytes = fs.statSync(path.join(PROF, 'data.json')).size;
    suite.ok(ms < 100, '500 天 applyFields+flush=' + ms + 'ms（<100ms，含 IPC 合并+原子写盘）');
    suite.metric('savePath_ms', ms);
    suite.metric('datajson_bytes', bytes);
    suite.metric('note', 'v2.1.0 改造后·新存储协议基线（主进程合并+原子写）');
    suite.ok(bcalls.filter(c => c[0] === 'hb-data-changed').length > 0, '变更广播已发出（hb-data-changed）');
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
