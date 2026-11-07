/* verify-core-data —— 数据完整性 + 故障注入 + 边界输入（v2.1 存储栈口径）
   合并原 verify-fixes / verify-faultinject / verify-boundary 场景。
   v2.1 变化：存档在主进程 <profile>/data.json，故障注入改为直接写坏该文件；
   同时断言 localStorage 旧键全程只读（迁移源保留红线）。 */
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const H = require('./_harness.js');

const NAME = 'verify-core-data';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const PROFILE = H.initProfile(NAME);
H.stubIpc(suite.calls);
const DATA_FILE = () => path.join(PROFILE, 'data.json');

app.whenReady().then(async () => {
  const win = H.makeWin(suite);
  /* 写坏存档后等写入期（主进程写盘防抖 250ms）过去再 reload */
  const SETTLE = 800;
  try {
    /* —— 场景 1：首次运行（主进程无存档、无旧 localStorage）→ 示例数据 —— */
    await H.loadPage(win);
    await H.bootWait(win);
    let r = await H.evalJson(win, 'return {sample:!!(data.meta&&data.meta.sampleLoaded),days:Object.keys(data.days).length,habits:data.habits.length,buildOk:(MAIN_BUILD===APP_BUILD),hb:!!(window.hbShell&&hbShell.dataLoadSync)}');
    suite.ok(r.sample === true, '首启无存档 → 示例数据 sampleLoaded=true');
    suite.ok(r.days > 0 && r.habits > 0, '示例 days/habits 就绪 days=' + r.days + ' habits=' + r.habits);
    suite.ok(r.buildOk === true, '构建号一致 MAIN_BUILD===APP_BUILD（' + H.BUILD + '）');
    suite.ok(r.hb === true, '主进程数据层已挂载（hbShell.dataLoadSync 可用）');
    await H.sleep(SETTLE);
    suite.ok(fs.existsSync(DATA_FILE()), '示例数据已落盘 data.json（主进程持有）');
    await H.drainPageErrs(win, suite);

    /* —— 场景 2：存档损坏（垃圾字节写入 data.json）→ 原文另存 data-corrupt-* + 示例兜底 —— */
    fs.writeFileSync(DATA_FILE(), '{{{bad json}}', 'utf8');
    H.storeInternal().resetDoc();   /* 丢弃主进程内存档：故障注入直接改磁盘，须重新读盘 */
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {corrupt:!!(data.meta&&data.meta.corruptRecovered),bodyOk:document.body.children.length>0,lsUntouched:localStorage.getItem(LS_KEY)===null}');
    suite.ok(r.corrupt === true, '损坏存档 → corruptRecovered 兜底启动');
    suite.ok(r.bodyOk === true, '损坏场景页面渲染不白屏');
    suite.ok(r.lsUntouched === true, 'localStorage 旧键未被回写（迁移源保留）');
    const corruptCopies = fs.readdirSync(PROFILE).filter(f => f.indexOf('data-corrupt-') === 0);
    suite.ok(corruptCopies.length >= 1, '损坏原文已另存副本（' + corruptCopies.join(',') + '）');
    await H.drainPageErrs(win, suite);

    /* —— 场景 3：截断 JSON —— */
    const good = fs.readFileSync(DATA_FILE(), 'utf8');
    fs.writeFileSync(DATA_FILE(), good.slice(0, Math.floor(good.length * 0.55)), 'utf8');
    H.storeInternal().resetDoc();
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {bodyOk:document.body.children.length>0,corrupt:!!(data.meta&&data.meta.corruptRecovered),hasDays:!!data.days&&typeof data.days==="object"}');
    suite.ok(r.bodyOk === true && r.hasDays === true, '截断存档 → 渲染不白屏且 data 可用（corrupt=' + r.corrupt + '）');
    await H.drainPageErrs(win, suite);

    /* —— 场景 4：旧版缺字段存档（仅 {}）→ 迁移框架 + 默认补齐 —— */
    fs.writeFileSync(DATA_FILE(), '{}', 'utf8');
    H.storeInternal().resetDoc();
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {days:!!data.days&&typeof data.days==="object",habits:Array.isArray(data.habits)&&data.habits.length>0,remind:typeof (data.settings||{}).remind!=="undefined",profile:!!data.profile,ver:(data.meta||{}).version}');
    suite.ok(r.days && r.habits && r.remind && r.profile, '缺字段存档 → 默认补齐 meta/days/habits/settings/profile');
    suite.ok(r.ver === 2, 'MIGRATIONS：v1 缺版本档 → 迁移为 meta.version=2（实际 ' + r.ver + '）');
    await H.drainPageErrs(win, suite);

    /* —— 场景 5：300KB 超大便签 → 字段属主提交落盘 → 重启不白屏 —— */
    await H.evalJson(win, 'data.memoNotes=[{id:"nbig",ts:Date.now(),html:"<p>"+new Array(300*1024+1).join("A")+"</p>",text:"A",title:""}];data.memo=data.memoNotes[0];saveMemoFields();return true');
    await H.sleep(SETTLE);
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {bodyOk:document.body.children.length>0,notes:(data.memoNotes||[]).length}');
    suite.ok(r.bodyOk === true && r.notes === 1, '300KB 便签 → 渲染不白屏且经主进程落盘后完整');
    await H.drainPageErrs(win, suite);

    /* —— 场景 6：删除习惯持久化（重启不复活）—— */
    const delKey = await H.evalJson(win, 'var h0=activeHabits()[0];h0.deleted=true;h0.deletedAt="2026-09-25";save();return h0.key');
    await H.sleep(SETTLE);
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'var h=data.habits.filter(function(x){return x.key===' + JSON.stringify(delKey) + '})[0];return {still:h?h.deleted===true:false}');
    suite.ok(r.still === true, '删除习惯（软删）经新存储持久化：重启仍为 deleted');
    await H.drainPageErrs(win, suite);

    /* —— 场景 7：删光习惯（habitsCleared）→ 重启不补默认 ——
       save() 首行 data.habits=HABITS，须同步清空内存 HABITS 才是「彻底删光」的最终状态 */
    await H.evalJson(win, 'HABITS.length=0;data.habits=[];data.meta.habitsCleared=true;save();return true');
    await H.sleep(SETTLE);
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {n:data.habits.length}');
    suite.ok(r.n === 0, 'meta.habitsCleared=true 时默认习惯不复活（habits.length=0）');
    await H.drainPageErrs(win, suite);

    /* —— 场景 8：边界输入 —— 241 字符 + emoji + 特殊符号名，无注入；计数钳制到 target —— */
    const longName = '⭐'.repeat(60) + '<b onmouseover=window.__pwn=1>点击</b>' + 'x'.repeat(121);
    await H.evalJson(win, 'data.habits.push({key:"bd1",name:' + JSON.stringify(longName) + ',icon:"🎯",type:"count",target:3,unit:"次",color:"#7FA0B4",size:"wide"});syncHabits();save();renderAll(false);return true');
    r = await H.evalJson(win, 'return {pwn:!!window.__pwn,inj:!!document.querySelector("[onmouseover]"),hasName:document.body.textContent.indexOf("点击")>=0}');
    suite.ok(r.pwn === false && r.inj === false, '超长+emoji+特殊符号名：无注入（无 onmouseover 属性节点/pwn=0）');
    suite.ok(r.hasName === true, '超长名保存且渲染可读');
    await H.evalJson(win, 'addCount("bd1",5,null);save();return true');
    r = await H.evalJson(win, 'return {v:(data.days[todayStr()]||{}).bd1}');
    suite.ok(r.v === 3, '计数打卡超出 target 被钳制（5→3）');
    await H.drainPageErrs(win, suite);

    /* —— 场景 9：导出/导入往返（normalizeImported 信封清洗 + 计数保持）—— */
    r = await H.evalJson(win, [
      'var before={h:data.habits.length,d:Object.keys(data.days).length,n:(data.memoNotes||[]).length};',
      'var env={schema:"habit-memo-shell",version:1,exportedAt:new Date().toISOString(),data:JSON.parse(JSON.stringify(data))};',
      'var norm=normalizeImported(env);',
      'var after={h:norm.habits.length,d:Object.keys(norm.days).length,n:(norm.memoNotes||[]).length};',
      'return {before:before,after:after,ok:!!norm}'
    ].join(''));
    suite.ok(r.ok === true, 'normalizeImported 接受标准信封');
    suite.ok(r.before.h === r.after.h && r.before.d === r.after.d && r.before.n === r.after.n,
      '导出→导入往返计数一致 habits=' + r.after.h + ' days=' + r.after.d + ' notes=' + r.after.n);
    await H.drainPageErrs(win, suite);

    /* —— 场景 10：重复启动幂等——再 reload 一轮，数据稳定、无重复迁移痕迹 —— */
    const snapBefore = fs.readFileSync(DATA_FILE(), 'utf8');
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {habits:data.habits.length,ver:(data.meta||{}).version}');
    suite.ok(r.ver === 2 && r.habits === 1, '重复启动幂等：version 稳定为 2、习惯数稳定（' + r.habits + '）');
    suite.ok(fs.readFileSync(DATA_FILE(), 'utf8').indexOf('"version":2') >= 0 || snapBefore.indexOf('"version"') >= 0, '存档带版本号落盘');
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
