/* verify-save-guard —— 跨窗数据协作守卫（v2.1 IPC 字段属主协议）
   旧 localStorage 心跳协议已退役，本套件按新协议断言：
   1) 主窗打卡/设置 → hb-data:save(days/habits/settings/profile/meta)，data.json 落盘；
   2) 编辑窗（真实第二窗）保存便签 → hb-data:save(memo/memoNotes) → 主进程合并 → 广播；
   3) 主窗 save() 不携带 memo 字段——编辑窗便签绝不被主窗旧快照覆盖（历史回滚问题消除点）；
   4) persistNoteOrder → 主进程按 id 只合并 ord/pin，正文不动；
   5) 主窗删除便签走 saveMemoFields() → memoNotes 生效；
   6) 编辑窗保存后主窗经 hb-data-changed 广播自动刷新内存与列表；
   7) localStorage 旧键全程只读；重启后全部持久（data.json 单一事实源）。 */
'use strict';
const { app } = require('electron');
const H = require('./_harness.js');

const NAME = 'verify-save-guard';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);
const SETTLE = 800;

app.whenReady().then(async () => {
  const main = H.makeWin(suite);
  let ed = null;
  try {
    await H.loadPage(main);
    await H.bootWait(main);

    /* 主窗造数据：便签走 saveMemoFields（memo 属主），打卡走 save（days 属主） */
    let r = await H.evalJson(main, [
      'data.memoNotes=[{id:"ntest",ts:Date.now(),html:"<p>初始内容</p>",text:"初始内容",title:""}];',
      'data.memo=data.memoNotes[0];saveMemoFields();',
      'var k=activeHabits()[0].key;',
      'toggleBool(k,null);save();',
      'return {key:k,noteOk:noteById("ntest")!==null,done:!!((data.days[todayStr()]||{})[k])}'
    ].join(''));
    suite.ok(r.noteOk === true && r.done === true, '主窗：便签建立 + 打卡生效（key=' + r.key + '）');
    const hkey = JSON.stringify(r.key);
    await H.sleep(SETTLE);

    /* 打开编辑窗（真实第二窗）：boot 从主进程读档，新协议下不再有心跳 */
    ed = H.makeWin(suite);
    await H.loadPage(ed, { view: 'editor', note: 'ntest' });
    await H.bootWait(ed);
    r = await H.evalJson(ed, 'return {isEd:IS_EDITOR_WIN===true,hbGone:localStorage.getItem("hb_editor_open")===null,doc:hbShell.dataLoadSync().status}');
    suite.ok(r.isEd === true && r.hbGone === true && r.doc === 'ok', '编辑窗启动：读主进程档、心跳协议已退役');

    /* 编辑窗保存便签 → 主进程合并落盘；打卡数据不动；主窗经广播自动刷新 */
    await H.evalJson(ed, 'var n=noteById("ntest");n.html="<p>编辑窗内容A</p>";n.text="编辑窗内容A";data.memo={html:n.html,text:n.text};save();return true');
    await H.sleep(500);   /* 广播到达主窗 + 写盘防抖 */
    r = await H.evalJson(ed, 'var d=hbShell.dataLoadSync().doc;return {memo:String((d.memo||{}).html),done:!!((d.days[todayStr()]||{})[' + hkey + '])}');
    suite.ok(r.memo.indexOf('编辑窗内容A') >= 0, '编辑窗 save()：便签字段经主进程合并落盘');
    suite.ok(r.done === true, '编辑窗 save()：主窗打卡数据未被回滚');
    r = await H.evalJson(main, 'return {synced:(data.memoNotes||[]).map(function(n){return String(n.html)}).join(",")}');
    suite.ok(r.synced.indexOf('编辑窗内容A') >= 0, '主窗经 hb-data-changed 广播自动刷新便签内存（无需手动回读）');

    /* 主窗 save()（不携带 memo 字段）：settings/days 落盘，编辑窗便签不受影响 */
    await H.evalJson(main, 'toggleRemindSum(document.getElementById("tgRemindSum"));save();return true');
    await H.sleep(SETTLE);
    r = await H.evalJson(main, 'var d=hbShell.dataLoadSync().doc;return {remind:d.settings.remindSummary,memo:String((d.memo||{}).html),done:!!((d.days[todayStr()]||{})[' + hkey + '])}');
    suite.ok(r.remind === false, '主窗 save()：settings 写入成功（remindSummary true→false）');
    suite.ok(r.memo.indexOf('编辑窗内容A') >= 0, '主窗 save()：便签字段不随主窗提交（旧快照覆盖问题从机制消除）');
    suite.ok(r.done === true, '主窗 save()：打卡数据保持');

    /* persistNoteOrder：主进程按 id 只合并 ord/pin，正文不动 */
    await H.evalJson(main, 'var n=noteById("ntest");n.ord=5;persistNoteOrder();return true');
    await H.sleep(SETTLE);
    r = await H.evalJson(main, 'var d=hbShell.dataLoadSync().doc;var n=(d.memoNotes||[])[0];return {ord:n.ord,html:String(n.html)}');
    suite.ok(r.ord === 5 && r.html.indexOf('编辑窗内容A') >= 0, 'persistNoteOrder：ord 合并且正文不被覆盖');

    /* 主窗删除便签（saveMemoFields）：memoNotes 生效 */
    await H.evalJson(main, 'data.memoNotes=[];data.memo={html:"",text:""};saveMemoFields();return true');
    await H.sleep(SETTLE);
    r = await H.evalJson(main, 'var d=hbShell.dataLoadSync().doc;return {n:(d.memoNotes||[]).length}');
    suite.ok(r.n === 0, '主窗 saveMemoFields()：删除便签落盘');

    /* localStorage 迁移源全程只读；重启后由 data.json 恢复 */
    try { ed.destroy(); } catch (_) {}
    ed = null;
    await main.webContents.reload(); await H.bootWait(main);
    r = await H.evalJson(main, 'return {done:!!((data.days[todayStr()]||{})[' + hkey + ']),remind:data.settings.remindSummary,ls:localStorage.getItem(LS_KEY)===null}');
    suite.ok(r.done === true && r.remind === false, '重启后：打卡 + 设置全部由 data.json 恢复');
    suite.ok(r.ls === true, 'localStorage 旧键全程未被写入（迁移源保留红线）');
    await H.drainPageErrs(main, suite);
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { if (ed) ed.destroy(); } catch (_) {}
    try { main.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
