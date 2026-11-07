/* verify-backup —— 备份链 + 性能基线（两段式之「改造前·旧存储协议基线」，v2.1 存储栈上复测口径不变）
   性能口径沿袭 TESTREPORT I-13：500 天数据 renderAll 与整包序列化耗时。
   备份轮转逻辑 v2.1 起在 store.js（主进程），隔离 harness 可 require —— 真实轮转断言见 verify-backup2；
   本套件保留：性能探针 + 导出/导入往返 + 备份链代码审查（审查对象改为 store.js）。 */
'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require('./_harness.js');

const NAME = 'verify-backup';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const PROF = H.initProfile(NAME);
H.stubIpc(suite.calls);

app.whenReady().then(async () => {
  const main = H.makeWin(suite);
  try {
    await H.loadPage(main);
    await H.bootWait(main);

    /* —— 性能探针：500 天 × 6 习惯 + 计时/心情记录 → renderAll / 整包序列化 —— */
    const r = await H.evalJson(main, [
      'var t0=performance.now();',
      'for(var i=0;i<500;i++){var dt=new Date();dt.setDate(dt.getDate()-i);',
      '  var ds=dt.getFullYear()+"-"+("0"+(dt.getMonth()+1)).slice(-2)+"-"+("0"+dt.getDate()).slice(-2);',
      '  var d={};',
      '  d.water=(i%8)+1;d.early=(i%2)===0;d.exercise=(i%3)!==0;d.meditation=(i%4)!==0;',
      '  d.reading=Math.round((i%10))/10;d.sleep=8;d.water_s="08:00";d.water_e="09:00";',
      '  if(i%3===0)d.mood=["happy","calm","normal","tired","sad"][i%5];',
      '  data.days[ds]=d;}',
      'save();',
      'var t1=performance.now();renderAll();var t2=performance.now();',
      'var s=JSON.stringify(data);var t3=performance.now();',
      'return {gen:Math.round(t1-t0),render:Math.round((t2-t1)*100)/100,ser:Math.round((t3-t2)*100)/100,size:s.length}'
    ].join(''));
    suite.ok(r.render < 300, '500 天 renderAll=' + r.render + 'ms（<300ms）');
    suite.ok(r.ser < 60, '500 天整包序列化=' + r.ser + 'ms（<60ms）');
    suite.metric('days', 500);
    suite.metric('renderAll_ms', r.render);
    suite.metric('serialize_ms', r.ser);
    suite.metric('archive_bytes', r.size);
    suite.metric('note', 'v2.1.0 改造前·旧 localStorage 协议基线');
    await H.drainPageErrs(main, suite);

    /* —— 导出/导入往返：normalizeImported 信封清洗计数保持 —— */
    const r2 = await H.evalJson(main, [
      'var before={h:data.habits.length,d:Object.keys(data.days).length,n:(data.memoNotes||[]).length};',
      'var env={schema:"habit-memo-shell",version:1,exportedAt:new Date().toISOString(),data:JSON.parse(JSON.stringify(data))};',
      'var norm=normalizeImported(env);',
      'var after={h:norm.habits.length,d:Object.keys(norm.days).length,n:(norm.memoNotes||[]).length};',
      'return {ok:!!norm,before:before,after:after}'
    ].join(''));
    suite.ok(r2.ok === true &&
      r2.before.h === r2.after.h && r2.before.d === r2.after.d && r2.before.n === r2.after.n,
      '导出→导入往返计数一致 habits=' + r2.after.h + ' days=' + r2.after.d + ' notes=' + r2.after.n);

    /* —— 备份链（v2.1：store.js 主进程持有）：代码审查 + 真实落盘结构 —— */
    const storeSrc = fs.readFileSync(path.join(H.ROOT, 'store.js'), 'utf8');
    H.checkMainJsSyntax(suite);
    /* r19：以下 3 条原为 suite.ok(storeSrc.indexOf(...) >= 0) ——「字符串出现在 store.js 里」
       就算通过，实现搬走/改名但字符串留在注释里也会假绿，属弱校验。真实行为断言已由
       verify-backup2.cjs 覆盖（backupNow 连备 5 次轮转 keep=3、最旧剪除最新保留、
       data.json + images/ 落盘、info.json、backupStatus 口径 count/interval/keep/lastAt/root、
       新根迁移），故此处降级为不计入 errs 的提示。 */
    const sym = (src, ks) => ks.map(k => k + (src.indexOf(k) >= 0 ? '✓' : '✗')).join(' ');
    console.log('    [info] store.js 备份链符号（仅提示，不计失败）：' + sym(storeSrc, ['auto-backup', 'pruneBackups', 'backupIntervalDays', 'backupKeep']));
    console.log('    [info] store.js 目录式备份（仅提示）：' + sym(storeSrc, ['cpSync', 'images']));
    console.log('    [info] store.js 间隔判定（仅提示）：' + sym(storeSrc, ['maybeAutoBackup', 'mtimeMs']));
    const html = fs.readFileSync(path.join(H.ROOT, 'habit.html'), 'utf8');
    suite.ok(html.indexOf('hbShell.autoBackup') < 0, '渲染层：旧 hbShell.autoBackup 每小时触发链已退役');
    suite.ok(html.indexOf('beforeunload') >= 0 && html.indexOf('flushPendingMemoSave') >= 0, '渲染层：beforeunload 兜底 flush 存在');
    /* 500 天存档落盘性能（新栈端到端：IPC + 主进程写盘） */
    await H.sleep(1000);
    const df = path.join(PROF, 'data.json');
    suite.ok(fs.existsSync(df), '500 天数据经主进程落盘 data.json');
    suite.metric('datajson_bytes', fs.existsSync(df) ? fs.statSync(df).size : 0);
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { main.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
