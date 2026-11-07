'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require('./_harness.js');

const NAME = 'capture-ui-after';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);

async function waitForToastClear(win) {
  for (let i = 0; i < 24; i++) {
    const count = await H.evalJson(win, 'return document.querySelectorAll("#toastWrap .toast").length');
    if (!count) return;
    await H.sleep(250);
  }
}

app.whenReady().then(async function () {
  const win = H.makeWin(suite, { show: false, offscreen: true, frame: false, transparent: true, backgroundColor: '#00000000', width: 520, height: 720 });
  const outDir = path.join(__dirname, 'results', 'ui-after');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    await H.loadPage(win);
    await H.bootWait(win);
    await H.sleep(2100);
    const onboarding = await H.evalJson(win, 'var skip=document.getElementById("guideSkip");if(skip)skip.click();var cm=document.getElementById("confirmMask");if(cm&&cm.classList.contains("show")){var cancel=document.getElementById("confirmCancel");if(cancel)cancel.click();}return {guide:!!document.getElementById("guideMask"),confirm:!!(cm&&cm.classList.contains("show"))}');
    suite.ok(!onboarding.guide && !onboarding.confirm, '首次使用引导与确认弹层已关闭');
    const dimensions = [[320, 480], [520, 720], [780, 900], [1200, 860]];
    for (const size of dimensions) {
      win.setSize(size[0], size[1]);
      await H.sleep(350);
      for (const theme of ['light', 'dark']) {
        await H.evalJson(win, 'document.querySelector(".tab[data-tab=mine]").click();return true');
        await H.sleep(250);
        await H.evalJson(win, 'var select=document.getElementById("themeSelect");if(!select)throw new Error("theme selector missing");select.value=' + JSON.stringify(theme) + ';select.dispatchEvent(new Event("change",{bubbles:true}));return themeMode()');
        await waitForToastClear(win);
        await H.sleep(250);
        for (const page of ['today', 'stat', 'memo', 'mine']) {
          const pageId = { today: 'page-today', stat: 'page-stat', memo: 'page-memo', mine: 'page-mine' }[page];
          await H.evalJson(win, 'document.querySelector(".tab[data-tab="+' + JSON.stringify(page) + '+"]").click();return true');
          await H.sleep(450);
          const state = await H.evalJson(win,
            'var p=document.getElementById(' + JSON.stringify(pageId) + '),r=p&&p.getBoundingClientRect(),cm=document.getElementById("confirmMask");return {active:!!p&&p.classList.contains("active"),visible:!!p&&getComputedStyle(p).display!=="none"&&!!r&&r.width>0&&r.height>0,dark:document.documentElement.classList.contains("dark"),overlay:!!document.getElementById("guideMask")||!!(cm&&cm.classList.contains("show")),width:innerWidth,height:innerHeight,pageWidth:p&&p.scrollWidth,pageClient:p&&p.clientWidth}');
          const valid = state.active && state.visible && state.dark === (theme === 'dark') && !state.overlay && state.pageWidth <= state.pageClient + 1;
          suite.ok(valid, size.join('x') + '/' + theme + '/' + page + ' 截图前页面、主题、横向溢出与遮罩状态有效（' + JSON.stringify(state) + ')');
          if (!state.active || !state.visible || state.dark !== (theme === 'dark') || state.overlay) continue;
          await win.webContents.executeJavaScript('new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);})})', true);
          let png = null;
          for (let retry = 0; retry < 3; retry++) {
            png = await H.capturePng(win);
            if (png.length > 5000) break;
            await H.sleep(300);
          }
          const shotName = size[0] + 'x' + size[1] + '-' + theme + '-' + page + '.png';
          const shotPath = path.join(outDir, shotName);
          if (png && png.length > 5000) {
            fs.writeFileSync(shotPath, png);
            suite.metric(size.join('x') + '/' + theme + '/' + page, { path: path.relative(H.ROOT, shotPath), bytes: png.length, size: [size[0], size[1]], capture: 'Electron webContents.capturePage (offscreen, stayHidden; fresh paint)' });
          } else {
            suite.errs.push(size.join('x') + '/' + theme + '/' + page + ' capturePage 未取得有效截图');
          }
        }
        await H.drainPageErrs(win, suite);
      }
    }
  } catch (e) {
    suite.errs.push('截图套件异常: ' + String((e && e.stack) || e).slice(0, 1000));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
