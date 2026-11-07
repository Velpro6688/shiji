/* verify-lock-sticky —— 锁定贴纸链路 + 编辑窗贴纸极简形态 + 主进程降级代码审查
   （合并原 verify-lock-sticky / verify-finalui / verify-lockflow 中可隔离覆盖的部分；
    desktop-layer.exe 沉底为纯主进程行为，隔离 harness 不可达，沿袭 TESTREPORT 以代码审查替代） */
'use strict';
const { app } = require('electron');
const H = require('./_harness.js');

const NAME = 'verify-lock-sticky';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);

app.whenReady().then(async () => {
  /* 本套件必须用【可见窗口】：applyLock 靠双 rAF 实测内容尺寸后才调 setLocked，
     show:false 的隐藏窗合成器不出帧，rAF 永不回调（测试专用，应用本体无此问题）。 */
  const main = H.makeWin(suite, { show: true });
  let ed = null;
  try {
    await H.loadPage(main);
    await H.bootWait(main);
    await H.evalJson(main, 'data.memoNotes=[{id:"ntest",ts:Date.now(),html:"<p>贴纸内容</p>",text:"贴纸内容",title:""}];data.memo=data.memoNotes[0];save();renderMemoList();return true');

    /* —— 锁定：applyLock(true) → hbShell.setLocked(true,size) —— */
    await H.evalJson(main, 'window.lockStickyNote&&window.lockStickyNote();window.applyLock&&window.applyLock(true);return true');
    await H.sleep(1200);   /* 双 rAF 实测内容尺寸 + setLocked + 200ms 沉底 */
    let lockCall = suite.calls.filter(c => c[0] === 'hb-set-locked').find(c => c[1] === true);
    suite.ok(!!lockCall, 'applyLock(true) → hb-set-locked(true,size) 已调用');
    if (lockCall) {
      const sz = lockCall[2] || {};
      suite.ok((sz.width || 0) >= 200 && (sz.height || 0) >= 160,
        '锁定尺寸合理 width=' + sz.width + ' height=' + sz.height + '（≥最小 200×160）');
    }
    let r = await H.evalJson(main, 'return {locked:document.body.classList.contains("app-locked"),ro:document.getElementById("memoInput").getAttribute("contenteditable")==="false"}');
    suite.ok(r.locked === true, '锁定态 body.app-locked');
    suite.ok(r.ro === true, '锁定态便签只读（contenteditable=false，纯展示不落盘）');
    await H.drainPageErrs(main, suite);

    /* —— 解锁 —— */
    await H.evalJson(main, 'window.applyLock(false);return true');
    await H.sleep(800);
    suite.ok(suite.calls.some(c => c[0] === 'hb-set-locked' && c[1] === false), 'applyLock(false) → hb-set-locked(false) 已调用');
    r = await H.evalJson(main, 'return {locked:document.body.classList.contains("app-locked"),editable:document.getElementById("memoInput").getAttribute("contenteditable")!=="false"}');
    suite.ok(r.locked === false && r.editable === true, '解锁恢复可编辑态');

    /* —— 编辑窗贴纸形态（?sticky=1）：极简 UI + 自适应高度回报 —— */
    ed = H.makeWin(suite, { show: true });
    await H.loadPage(ed, { view: 'editor', sticky: '1', note: 'ntest' });
    await H.bootWait(ed);
    await H.sleep(900);   /* sticky 首开 450ms 后 fitSelf */
    r = await H.evalJson(ed, 'return {sticker:document.body.classList.contains("sticky-sticker"),meTop:getComputedStyle(document.querySelector(".me-top")).display,edit:document.getElementById("memoInput").getAttribute("contenteditable")!=="false"}');
    suite.ok(r.sticker === true, '贴纸编辑窗 body.sticky-sticker');
    suite.ok(r.meTop === 'none', '贴纸极简 UI：.me-top 顶栏 display=none');
    suite.ok(r.edit === true, '贴纸正文仍可输入（非只读）');
    const fit = suite.calls.filter(c => c[0] === 'hb-sticky-fit-self');
    suite.ok(fit.length > 0 && typeof fit[0][1] === 'number' && fit[0][1] >= 200 && fit[0][1] <= 860,
      'hb-sticky-fit-self 高度回报在 [200,860]（fit=' + (fit[0] ? fit[0][1] : 'none') + '）');
    await H.drainPageErrs(ed, suite);

    /* —— 主进程沉底链路存在（desktop-layer.exe 缺失时静默降级）：代码审查替代 —— */
    const src = H.checkMainJsSyntax(suite);
    suite.ok(src.includes('function onWinLockedBlur()') && src.includes("win.on('blur', winLockBlurHandler)") && !src.includes('function bottomWindowNow()'),
      'main.js 贴桌面沿用普通窗口层级，失焦不再调用已废弃沉底链路');
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { if (ed) ed.destroy(); } catch (_) {}
    try { main.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
