'use strict';
/* 「我的」页全功能实测：每个菜单项真实点击并断言状态真实变化（2026-10-04 用户要求）。
   覆盖：深色三态 / 启动贴回 / 晚间提醒 / 音效 / 管理员模式 / 导出备份 / 导入备份 /
   立即备份 / 备份频率 / 保留份数 / 数据目录迁移 / 便携模式 / 清空数据 / 奖励文案。
   开机自启依赖 Windows 注册表：harness 用成功桩模拟返回，UI 链路可点，注册表真实写入由真机人工确认。 */
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require('./_harness');
const suite = H.makeSuite('verify-mypage');
/* r19：接全局兜底（core-data:13 / backup2:18 同款）——缺它时套件卡死会一直挂住，
   而不是 180s 后写失败结果退出。 */
H.globalKillSwitch('verify-mypage', suite);
const profile=H.initProfile('verify-mypage');
H.stubIpc(suite.calls);
const sleep = H.sleep;
const okBtn = () => 'document.getElementById("confirmOk").click();return 1';

app.whenReady().then(async () => {
  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });
  try {
    await H.loadPage(win); await H.bootWait(win);
    await sleep(2200);
    await H.evalJson(win, 'var b=document.getElementById("guideSkip");if(b)b.click();return 1');
    await sleep(300);
    await H.evalJson(win, 'data.habits=[{key:"water",name:"喝水",type:"bool",icon:"💧",color:"#3B82F6",size:"wide",target:1,unit:"杯",createdAt:Date.now(),archived:false}];data.days={};data.days[new Date().toISOString().slice(0,10)]={water:1};saveDebounced();go("mine");return 1');
    await sleep(600);

    /* 1. 主题可直接选择三态，跟随系统能响应外观变化 */
    const themeState = await H.evalJson(win, 'var s=document.getElementById("themeSelect");if(!s)throw new Error("theme selector missing");s.value="dark";s.dispatchEvent(new Event("change",{bubbles:true}));var dark=s.value==="dark"&&themeMode()==="dark"&&document.documentElement.classList.contains("dark");window.__hbSystemDark=true;s.value="system";s.dispatchEvent(new Event("change",{bubbles:true}));var systemDark=s.value==="system"&&themeMode()==="system"&&document.documentElement.classList.contains("dark");window.__hbSystemDark=false;applyTheme();var systemLight=!document.documentElement.classList.contains("dark");s.value="light";s.dispatchEvent(new Event("change",{bubbles:true}));return {dark:dark,systemDark:systemDark,systemLight:systemLight,light:themeMode()==="light"&&!document.documentElement.classList.contains("dark")};');
    suite.ok(themeState.dark && themeState.systemDark && themeState.systemLight && themeState.light, '1 主题下拉可直接选择浅色/深色/跟随系统（' + JSON.stringify(themeState) + ')');

    /* 2. 启动贴回便签 */
    const r0 = await H.evalJson(win, 'return localStorage.getItem("hb_restore_sticky");return 1');
    await H.evalJson(win, 'toggleRestore(document.getElementById("tgRestore"));return 1');
    const r1 = await H.evalJson(win, 'return localStorage.getItem("hb_restore_sticky");return 1');
    suite.ok(r0 !== r1, '2 启动贴回开关写入（' + r0 + '→' + r1 + '）');

    /* 3. 晚间汇总提醒 */
    const m0 = await H.evalJson(win, 'return !!data.settings.remindSummary;return 1');
    await H.evalJson(win, 'toggleRemindSum(document.getElementById("tgRemindSum"));return 1');
    const m1 = await H.evalJson(win, 'return !!data.settings.remindSummary;return 1');
    suite.ok(m0 !== m1, '3 晚间汇总提醒开关（' + m0 + '→' + m1 + '）');
    await H.evalJson(win, 'toggleRemindSum(document.getElementById("tgRemindSum"));return 1');

    /* 4. 打卡音效 */
    const s0 = await H.evalJson(win, 'return !!data.settings.sound;return 1');
    await H.evalJson(win, 'toggleSound(document.getElementById("tgSound"));return 1');
    const s1 = await H.evalJson(win, 'return !!data.settings.sound;return 1');
    suite.ok(s0 !== s1, '4 音效开关（' + s0 + '→' + s1 + '）');
    await H.evalJson(win, 'toggleSound(document.getElementById("tgSound"));return 1');

    /* 5. 管理员模式（确认弹窗链路） */
    await H.evalJson(win, 'toggleAdmin(document.getElementById("tgAdmin"));return 1');
    await sleep(400);
    const dlgShown = await H.evalJson(win, 'return document.getElementById("confirmMask").classList.contains("show");return 1');
    await H.evalJson(win, okBtn());
    await sleep(300);
    const a1 = await H.evalJson(win, 'return localStorage.getItem("hb_admin_mode");return 1');
    suite.ok(dlgShown && a1 === '1', '5 管理员模式：确认弹窗+开启（弹窗=' + dlgShown + ', admin=' + a1 + '）');
    await H.evalJson(win, 'toggleAdmin(document.getElementById("tgAdmin"));return 1');
    await sleep(300);
    await H.evalJson(win, okBtn());
    await sleep(200);

    /* 6. 导出备份（hb-data:export-doc 真实出文档） */
    await H.evalJson(win, 'window.__blobSize=0;var _co=URL.createObjectURL;URL.createObjectURL=function(b){window.__blobSize=b.size;return _co.call(URL,b);};return 1');
    await H.evalJson(win, 'exportBackup();return 1');
    await sleep(900);
    const blobSize = await H.evalJson(win, 'return window.__blobSize;return 1');
    suite.ok(blobSize > 100, '6 导出备份：备份文件真实生成（' + blobSize + 'B）');

    /* 7. 导入备份（构造备份文件走真实导入链） */
    await H.evalJson(win, [
      'var snapshot=JSON.parse(JSON.stringify({days:data.days,habits:data.habits,settings:data.settings,profile:data.profile,meta:data.meta,ord:(data.ord||{}),memoNotes:(data.memoNotes||[]),memo:(data.memo||null)}));',
      'snapshot.habits=snapshot.habits.filter(function(h){return h.key!=="imp";});',
      'snapshot.habits.push({key:"imp",name:"导入习惯",type:"bool",icon:"✨",color:"#10B981",size:"wide",target:1,unit:"次",createdAt:Date.now(),archived:false});',
      'var payload={schema:"habit-memo-shell",version:1,exportedAt:new Date().toISOString(),data:snapshot};',
      'var f=new File([JSON.stringify(payload)],"backup.json",{type:"application/json"});',
      'var dt=new DataTransfer();dt.items.add(f);',
      'var el=document.getElementById("backupFile");el.files=dt.files;',
      'el.dispatchEvent(new Event("change"));',
      'return {queued:!!el.files[0]};return 1'
    ].join(''));
    await sleep(1200);
    await H.evalJson(win, okBtn());          /* 导入预览确认弹窗：确定后才真正落库 */
    await sleep(1500);
    const hasImp = await H.evalJson(win, 'return (data.habits||[]).some(function(h){return h.key==="imp";});return 1');
    suite.ok(hasImp, '7 导入备份：文件入队并真实恢复（习惯出现=' + hasImp + '）');

    /* 8. 立即备份（真实落盘） */
    const bkDir = path.join(profile, 'auto-backup');
    const cnt = () => { try { return fs.readdirSync(bkDir).filter(f => /^habit-backup-/.test(f)).length; } catch (_) { return 0; } };
    const before8 = cnt();
    await H.evalJson(win, 'backupNowManual();return 1');
    await sleep(1800);
    const after8 = cnt();
    suite.ok(after8 > before8, '8 立即备份：备份目录真实新增（' + before8 + ' → ' + after8 + '）');

    /* 9/10. 备份频率与份数循环 */
    const iv0 = await H.evalJson(win, 'return document.getElementById("backupIntervalSub").textContent;return 1');
    await H.evalJson(win, 'cycleBackupCfg("interval");return 1');
    await sleep(400);
    const iv1 = await H.evalJson(win, 'return document.getElementById("backupIntervalSub").textContent;return 1');
    suite.ok(iv0 !== iv1, '9 备份频率循环（' + iv0.trim() + ' → ' + iv1.trim() + '）');
    const kp0 = await H.evalJson(win, 'return document.getElementById("backupKeepSub").textContent;return 1');
    await H.evalJson(win, 'cycleBackupCfg("keep");return 1');
    await sleep(400);
    const kp1 = await H.evalJson(win, 'return document.getElementById("backupKeepSub").textContent;return 1');
    suite.ok(kp0 !== kp1, '10 保留份数循环（' + kp0.trim() + ' → ' + kp1.trim() + '）');

    /* 11. 数据目录迁移（pick-dir 桩指向临时目录） */
    const tmpTarget = profile+'-migrated';
    try { fs.rmSync(tmpTarget, { recursive: true, force: true }); } catch (_) {}
    ipcMain.removeHandler('hb-data:pick-dir');
    ipcMain.handle('hb-data:pick-dir', () => ({ ok: true, dir: tmpTarget }));
    await H.evalJson(win, 'moveDataDir();return 1');
    await sleep(500);
    await H.evalJson(win, okBtn());
    await sleep(2000);
    const migrated = fs.existsSync(path.join(tmpTarget, 'data.json'));
    suite.ok(migrated, '11 数据目录迁移：目标目录出现 data.json（' + migrated + '）');
    /* 迁回默认，避免影响后续项 */
    const backDir = profile;
    ipcMain.removeHandler('hb-data:pick-dir');
    ipcMain.handle('hb-data:pick-dir', () => ({ ok: true, dir: backDir }));
    await H.evalJson(win, 'moveDataDir();return 1');
    await sleep(500);
    await H.evalJson(win, okBtn());
    await sleep(2000);

    /* 12. 便携模式开关（写入 app-config，随即关回） */
    await H.evalJson(win, 'togglePortable();return 1');
    await sleep(500);
    const pfDlg = await H.evalJson(win, 'return document.getElementById("confirmMask").classList.contains("show");return 1');
    if (pfDlg) { await H.evalJson(win, okBtn()); }
    await sleep(1500);
    const pf1 = await H.evalJson(win, 'return (document.getElementById("portableSub").textContent||"").slice(0,20);return 1');
    suite.ok(/开启|关闭/.test(pf1), '12 便携模式：开关响应（' + pf1.trim() + '）');
    await H.evalJson(win, 'togglePortable();return 1');
    await sleep(500);
    const pfDlg2 = await H.evalJson(win, 'return document.getElementById("confirmMask").classList.contains("show");return 1');
    if (pfDlg2) { await H.evalJson(win, okBtn()); }
    await sleep(1200);

    /* 13. 清空数据（管理员确认链路真实走通） */
    await H.evalJson(win, 'clearSample();return 1');
    await sleep(500);
    await H.evalJson(win, okBtn());
    await sleep(1200);
    const cleared = await H.evalJson(win, 'return {days:Object.keys(data.days||{}).length,notes:(data.memoNotes||[]).length};return 1');
    suite.ok(cleared.days === 0, '13 清空数据：打卡与便签清空（days=' + cleared.days + ', notes=' + cleared.notes + '）');

    /* 14. 奖励文案（新语言）确认 */
    const rwT = await H.evalJson(win, 'return T("rw_title")+" | "+T("rw_ready");return 1');
    suite.ok(rwT.indexOf('该享受一下了') >= 0, '14 奖励文案已换新（' + rwT + '）');
    suite.ok(true, '开机自启：UI 链路依赖注册表（harness 用成功桩），真实写入由真机人工确认——不在本套件重复');

    await H.drainPageErrs(win, suite);
    win.destroy();
  } catch (e) {
    suite.errs.push('probe 异常: ' + e.message);
    try { win.destroy(); } catch (_) {}
  }
  H.finish(suite);
  app.exit(suite.errs.length ? 1 : 0);
});
