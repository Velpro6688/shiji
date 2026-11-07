'use strict';
/* verify-shadow-corner —— r12「圆角外方形阴影角」回归（用户反馈问题的自动化复现）
   现象（用户原话）：白色背景时窗口四角露出方形直角阴影，下面两角最明显。
   取证结论：真凶不是 DWM 系统投影（窗口四缘外侧恒 255 纯白 → 系统投影本就关闭），
             而是两层「大模糊 box-shadow」把 #app 36px 圆角之外的四个角缺口染灰：
               ① #app 自身的 0 0 40px 外阴影（浅色 habit.html:2603 / 深色 habit.html:2546）
               ② 三个常驻 DOM 的底部抽屉 #editorSheet/#profileSheet/#timerSheet
                  （靠 translateY(105%) 停在窗外，并非 display:none）的 0 -14px 44px
   本套件加载【真实 habit.html】，用两条互补证据链断言：
     A. 确定性判据（主）——`capturePage()` 的 alpha 通道：圆角缺口在窗口矩形内却不在 #app
        不透明区内，凡是画到那里的阴影都会在 alpha 上留下非 0 值。此法取的是窗口自身绘制面，
        **不受桌面窗口层叠影响**，因此可稳定复现（CopyFromScreen 会因别的窗口盖住而假阴性）。
        实测：修好时四角 alpha 全 0；把旧阴影注回去 → 上两角 alpha 之和≈100、下两角≈485
        （正好复现用户「下面两角最明显」的不对称）。
     B. 屏幕真值（辅，仅在白底垫底窗确实位于最上层时才判）——CopyFromScreen 逐点取色，
        四角应为 255 纯白；垫底 sanity 点不白则记「无法判定」而不误判失败。
   ※ 自检：套件末尾会把 r11 的旧阴影注入回去，断言 alpha 必须升高（证明该断言真能抓到回归）。
   用法：unset ELECTRON_RUN_AS_NODE && ./node_modules/electron/dist/electron.exe scripts/verify/verify-shadow-corner.cjs
   结果：scripts/verify/results/verify-shadow-corner-result.json（+ shadow-corner.png） */
const H = require('./_harness.js');
const { app, BrowserWindow, screen, nativeImage } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NAME = 'verify-shadow-corner';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);
app.on('window-all-closed', () => {});

const log = [];
function out(m) { log.push(String(m)); }

/* 逐点取色：GetPixel 在多数环境返回 0，必须走 Graphics.CopyFromScreen（沿袭既有探针约定）。
   标签用 ASCII（中文经 powershell 回传会乱码）。 */
function px(pts) {
  const inline = "using System;using System.Drawing;public static class CP{public static string Px(int x,int y){var b=new Bitmap(1,1);var g=Graphics.FromImage(b);g.CopyFromScreen(x,y,0,0,b.Size);var p=b.GetPixel(0,0);g.Dispose();b.Dispose();return p.R+\",\"+p.G+\",\"+p.B;}}";
  const b64 = Buffer.from(inline).toString('base64');
  const cmd = "Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + b64 + "'))) -ReferencedAssemblies System.Drawing;" +
    pts.map(p => "Write-Output ('" + p[0] + "|' + [CP]::Px(" + p[1] + "," + p[2] + "))").join(';');
  const r = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: 40000 });
  if (r.error) out('  spawn error: ' + r.error.message);
  const m = {};
  String(r.stdout || '').trim().split('\n').map(s => s.trim()).filter(Boolean).forEach(l => {
    const i = l.indexOf('|'); if (i > 0) m[l.slice(0, i)] = l.slice(i + 1);
  });
  return m;
}
function rgb(s) { const a = String(s || '').split(',').map(Number); return { r: a[0], g: a[1], b: a[2] }; }
function isWhite(s) { const c = rgb(s); return c.r >= 254 && c.g >= 254 && c.b >= 254; }

/* 本进程窗口的原生句柄（x64 下 getNativeWindowHandle 是 8 字节 LE） */
function hwndOf(w) {
  try { const b = w.getNativeWindowHandle(); return Number(b.readBigUInt64LE ? b.readBigUInt64LE(0) : b.readUInt32LE(0)); }
  catch (_) { return 0; }
}
/* 每个采样点最上层窗口的 PID：只有全部属于本进程，屏幕取色才可信（否则读到别的窗口 → 假阴性） */
function hits(pts) {
  const inline = "using System;using System.Runtime.InteropServices;public static class HT{" +
    "public struct PT{public int X;public int Y;}" +
    "[DllImport(\"user32.dll\")]public static extern IntPtr WindowFromPoint(PT p);" +
    "[DllImport(\"user32.dll\")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);" +
    "public static uint Hit(int x,int y){var h=WindowFromPoint(new PT{X=x,Y=y});uint p;GetWindowThreadProcessId(h,out p);return p;}}";
  const b64 = Buffer.from(inline).toString('base64');
  const cmd = "Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + b64 + "'))) -ReferencedAssemblies System.Drawing;" +
    pts.map(p => "Write-Output ('" + p[0] + "|' + [HT]::Hit(" + p[1] + "," + p[2] + "))").join(';');
  const r = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: 40000 });
  const m = {};
  String(r.stdout || '').trim().split('\n').map(s => s.trim()).filter(Boolean).forEach(l => {
    const i = l.indexOf('|'); if (i > 0) m[l.slice(0, i)] = Number(l.slice(i + 1));
  });
  return m;
}

/* 角上 6x6 区域的 alpha 之和（确定性判据；取窗口自身绘制面，不受层叠影响） */
function cornerAlpha(img) {
  const sz = img.getSize();
  const W = sz.width, Hh = sz.height;
  const buf = img.toBitmap(); // BGRA
  const at = (x, y) => buf[(y * W + x) * 4 + 3];
  const patch = (x0, y0) => {
    let s = 0, mx = 0;
    for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 6; x++) { const a = at(x, y); s += a; if (a > mx) mx = a; }
    return { sum: s, max: mx };
  };
  return {
    TL: patch(0, 0), TR: patch(W - 6, 0),
    BL: patch(0, Hh - 6), BR: patch(W - 6, Hh - 6),
    inner: at(40, 40), size: W + 'x' + Hh
  };
}

app.whenReady().then(async () => {
  let win = null, bg = null;
  try {
    const disp = screen.getPrimaryDisplay();
    const scale = disp.scaleFactor;
    const wa = disp.workArea;
    /* 全屏纯白垫底窗：给「屏幕真值」那条证据链用（四角若被应用画上东西，取色就不再是 255） */
    bg = new BrowserWindow({ x: wa.x, y: wa.y, width: wa.width, height: wa.height, show: true, frame: false, resizable: false, backgroundColor: '#FFFFFF', skipTaskbar: true });
    await H.sleep(500);
    win = H.makeWin(suite, {
      show: false, offscreen: true, x: wa.x + 300, y: wa.y + 120, width: 520, height: 720,
      minWidth: 320, minHeight: 480, resizable: false, frame: false,
      transparent: true, thickFrame: false, backgroundColor: '#00000000',
      autoHideMenuBar: true, skipTaskbar: true
    });
    try { if (typeof win.setHasShadow === 'function') win.setHasShadow(false); } catch (_) {}
    await H.loadPage(win);
    await H.bootWait(win);
    await H.sleep(2400);
    /* 关掉首启引导遮罩：它不靠 .show 控制，只能摘元素 + 置 guideDone（否则角上取到的是遮罩灰） */
    await H.evalJson(win, 'try{var g=document.getElementById("guideMask");if(g)g.remove();if(typeof data!=="undefined"&&data&&data.meta)data.meta.guideDone=true;}catch(_){};return 1');
    await H.closeMask(win);
    const initialClose = await H.evalJson(win, 'var closed=closeSheet(true);return {closed:closed,sheets:document.querySelectorAll(".sheet.show").length,mask:document.getElementById("mask").classList.contains("show"),confirm:document.getElementById("confirmMask").classList.contains("show")}');
    suite.ok(initialClose.closed === true && initialClose.sheets === 0 && !initialClose.mask && !initialClose.confirm, '初始化：所有抽屉与遮罩确实关闭');
    suite.metric('initialClose', initialClose);
    await H.sleep(900);

    /* 垫底窗先置顶、应用窗再置顶（顺序不能反），让「屏幕真值」那条链通常有效；
       若仍被别的窗口盖住，screenCheck 的逐点 z 序门会自动降级为仅记录。
       注意：必须用 setAlwaysOnTop（Electron 自带），不要再 Add-Type P/Invoke——
       本机 powershell 每次 Add-Type 编译约 20s，spawnSync 会超时（实测 ETIMEDOUT）。 */
    out('hwnd: app=' + hwndOf(win) + ' bg=' + hwndOf(bg) + ' pid=' + process.pid);
    try { bg.setAlwaysOnTop(true, 'screen-saver'); } catch (_) { try { bg.setAlwaysOnTop(true); } catch (__) {} }
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) { try { win.setAlwaysOnTop(true); } catch (__) {} }
    await H.sleep(900);

    const b = win.getBounds();
    const L = Math.round(b.x * scale), T = Math.round(b.y * scale);
    const W = Math.round(b.width * scale), Hh = Math.round(b.height * scale);
    out('physical L=' + L + ' T=' + T + ' W=' + W + ' H=' + Hh + ' scale=' + scale);
    suite.metric('bounds', [L, T, W, Hh]);

    const corners = [
      ['TL', L + 2, T + 2], ['TR', L + W - 3, T + 2],
      ['BL', L + 2, T + Hh - 3], ['BR', L + W - 3, T + Hh - 3]
    ];
    /* 边缘剖面：旧 bug 时这里是一条向下/向右渐暗的灰带 */
    const edges = [700, 704, 708, 712, 715, 718].map(y => ['Lx2_y' + y, L + 2, T + y])
      .concat([1, 3, 5, 8, 12, 18, 26, 36, 50].map(x => ['By717_x' + x, L + x, T + Hh - 3]));
    /* 垫底 sanity 点：应用矩形之外、仍在屏幕内（必须纯白，否则说明别的窗口盖在最上层） */
    const back = [['BACKDROP', Math.max(wa.x + 5, L - 60), Math.max(wa.y + 5, T - 60)]];

    /* —— 证据链 A：capturePage alpha（确定性） —— */
    async function alphaCheck(tag) {
      const img = nativeImage.createFromBuffer(await H.capturePng(win));
      const a = cornerAlpha(img);
      out('  [' + tag + '] alpha: TL=' + a.TL.sum + '(max' + a.TL.max + ') TR=' + a.TR.sum + '(max' + a.TR.max + ')' +
          ' BL=' + a.BL.sum + '(max' + a.BL.max + ') BR=' + a.BR.sum + '(max' + a.BR.max + ') | inner(40,40)=' + a.inner + ' | ' + a.size);
      suite.metric(tag + '_alphaTL', a.TL.sum);
      suite.metric(tag + '_alphaBL', a.BL.sum);
      return a;
    }
    /* —— 证据链 B：屏幕真值（逐点核对最上层窗口归属，全部属于本进程才判） —— */
    async function screenCheck(tag) {
      const pts = back.concat(corners).concat(edges);
      const m = px(pts);
      /* 逐点 z 序门：只看 BACKDROP 一个点不够——别的窗口可能恰好只盖住角（实测 TR/BR 被盖而 backdrop 仍白）。
         垫底窗与应用窗都是本进程创建的，故「最上层窗口 PID == 本进程 PID」即为可信。 */
      const hp = hits(pts);
      const foreign = pts.filter(p => hp[p[0]] !== process.pid).map(p => p[0] + '(pid' + hp[p[0]] + ')');
      const gate = isWhite(m['BACKDROP']) && foreign.length === 0;
      out('  [' + tag + '] screen: backdrop=' + m['BACKDROP'] + ' gate=' + gate +
        ' | 采样点最上层窗口: ' + (foreign.length ? '外来 ' + foreign.join(',') : '全部本进程'));
      if (!gate) {
        out('    → 垫底窗/应用窗未在采样点最上层（被其他窗口盖住），本条仅记录不判失败');
        return null;
      }
      out('    ' + corners.map(c => c[0] + '=' + m[c[0]]).join('  '));
      out('    left-edge x=2 : ' + [700, 704, 708, 712, 715, 718].map(y => y + ':' + m['Lx2_y' + y]).join('  '));
      out('    bottom-edge y=717 : ' + [1, 3, 5, 8, 12, 18, 26, 36, 50].map(x => x + ':' + m['By717_x' + x]).join('  '));
      corners.forEach(c => suite.metric(tag + '_' + c[0], m[c[0]]));
      return m;
    }
    async function styles() {
      return H.evalJson(win, [
        'var a=document.getElementById("app");var es=document.getElementById("editorSheet");',
        'var ps=document.getElementById("profileSheet");var ts=document.getElementById("timerSheet");',
        'var ca=getComputedStyle(a);',
        'return {appShadow:ca.boxShadow,appBg:ca.backgroundColor,appRadius:ca.borderTopLeftRadius,',
        ' appOverflow:ca.overflow,appRadiusBL:ca.borderBottomLeftRadius,',
        ' sheetShadow:getComputedStyle(es).boxShadow,profileShadow:getComputedStyle(ps).boxShadow,',
        ' timerShadow:getComputedStyle(ts).boxShadow,editorShow:es.classList.contains("show"),',
        ' htmlBg:getComputedStyle(document.documentElement).backgroundColor,',
        ' bodyBg:getComputedStyle(document.body).backgroundColor,',
        ' dark:document.documentElement.classList.contains("dark")};'
      ].join(''));
    }

    /* ================= 浅色（用户报障场景） ================= */
    suite.step('浅色：四角缺口不得被任何阴影染上（确定性 alpha 判据）');
    let st = await styles();
    out('LIGHT computed: appShadow=' + st.appShadow + ' | appBg=' + st.appBg + ' | radius=' + st.appRadius + '/' + st.appRadiusBL);
    out('  hidden sheets: editor=' + st.sheetShadow + ' | profile=' + st.profileShadow + ' | timer=' + st.timerShadow);
    out('  htmlBg=' + st.htmlBg + ' | bodyBg=' + st.bodyBg + ' | dark=' + st.dark);
    suite.metric('light_appShadow', st.appShadow);
    suite.metric('light_appBg', st.appBg);

    suite.ok(!st.dark, '浅色基线：html 不含 dark 类');
    suite.ok(st.appShadow === 'none',
      '#app 浅色已无大模糊阴影（#app 与窗口同尺寸，大模糊只在四角缺口显形；实际: ' + st.appShadow + '）');
    suite.ok(st.sheetShadow === 'none', '隐藏态 #editorSheet 不投影（实际: ' + st.sheetShadow + '）');
    suite.ok(st.profileShadow === 'none', '隐藏态 #profileSheet 不投影（实际: ' + st.profileShadow + '）');
    suite.ok(st.timerShadow === 'none', '隐藏态 #timerSheet 不投影（实际: ' + st.timerShadow + '）');
    suite.ok(st.appBg === 'rgb(245, 245, 247)', '#app 浅色底色符合 ui-1 令牌（实际: ' + st.appBg + '）');
    suite.ok(st.appRadius === '36px' && st.appRadiusBL === '36px', '#app 圆角 36px 未被改动');
    suite.ok(st.appOverflow === 'hidden', '#app overflow:hidden 未被改动');
    suite.ok(st.htmlBg === 'rgba(0, 0, 0, 0)' && st.bodyBg === 'rgba(0, 0, 0, 0)',
      'html/body 透明（r11 兜底仍生效）');

    let a = await alphaCheck('LIGHT');
    suite.ok(a.inner === 255, '浅色：窗口内区 alpha=255（窗口自身确实在绘制；实际: ' + a.inner + '）');
    ['TL', 'TR', 'BL', 'BR'].forEach(k => {
      suite.ok(a[k].sum === 0, '浅色 ' + k + ' 角缺口 alpha=0（无阴影溢出；实际: ' + a[k].sum + '）');
    });

    let m = await screenCheck('LIGHT');
    if (m) {
      for (const c of corners) suite.ok(isWhite(m[c[0]]), '浅色 ' + c[0] + ' 角屏幕取色纯白（实际: ' + m[c[0]] + '）');
      for (const e of edges) suite.ok(isWhite(m[e[0]]), '浅色边缘 ' + e[0] + ' 无灰带（实际: ' + m[e[0]] + '）');
    }

    /* 抽屉打开：阴影必须回来（纵深不被误伤） */
    suite.step('浅色：抽屉打开时仍有纵深阴影');
    await H.evalJson(win, 'try{openSheet("editorSheet")}catch(e){};return 1');
    await H.sleep(1200);
    st = await styles();
    out('  OPEN editor: show=' + st.editorShow + ' shadow=' + st.sheetShadow);
    suite.ok(st.editorShow, 'openSheet 后 #editorSheet 带 show 类');
    suite.ok(/44px/.test(st.sheetShadow), '抽屉打开时恢复纵深阴影（实际: ' + st.sheetShadow + '）');
    /* 抽屉开着时遮罩铺满窗口，四角本就是遮罩色（设计如此，仅记录不判失败） */
    const imgOpen = nativeImage.createFromBuffer(await H.capturePng(win));
    const ao = cornerAlpha(imgOpen);
    out('  DRAWER_OPEN(informational): TL=' + ao.TL.sum + ' BL=' + ao.BL.sum);
    suite.metric('drawerOpen_BL', ao.BL.sum);
    const closed = await H.evalJson(win, 'var result=closeSheet(true);return {result:result,sheets:document.querySelectorAll(".sheet.show").length,mask:document.getElementById("mask").classList.contains("show"),confirm:document.getElementById("confirmMask").classList.contains("show")}');
    suite.metric('afterCloseState', closed);
    out('  CLOSE state: ' + JSON.stringify(closed));
    suite.ok(closed.result === true && closed.sheets === 0 && !closed.mask && !closed.confirm, '强制关闭路径确实清除所有抽屉、遮罩与确认层');
    await H.sleep(1200);
    st = await styles();
    suite.ok(st.sheetShadow === 'none', 'closeSheet 后阴影回收为 none（实际: ' + st.sheetShadow + '）');
    a = await alphaCheck('LIGHT_AFTER_CLOSE');
    ['TL', 'TR', 'BL', 'BR'].forEach(k => {
      suite.ok(a[k].sum === 0, '浅色闭合后 ' + k + ' 角缺口 alpha=0（实际: ' + a[k].sum + '）');
    });

    /* ================= 深色 ================= */
    suite.step('深色：四角缺口同样不得被染（深色壁纸下不出现深色方块）');
    await H.evalJson(win, 'try{if(typeof setThemeMode==="function")setThemeMode("dark")}catch(e){};return 1');
    await H.sleep(1600);
    st = await styles();
    out('DARK computed: appShadow=' + st.appShadow + ' | appBg=' + st.appBg + ' | dark=' + st.dark);
    suite.metric('dark_appShadow', st.appShadow);
    suite.metric('dark_appBg', st.appBg);
    suite.ok(st.dark, '深色切换生效（html.dark）');
    suite.ok(/1px/.test(st.appShadow) && !/40px/.test(st.appShadow),
      '#app 深色阴影已收口为 0 模糊微光描边（实际: ' + st.appShadow + '）');
    suite.ok(st.appBg === 'rgb(20, 20, 22)', '#app 深色底色符合 ui-1 令牌（实际: ' + st.appBg + '）');
    suite.ok(st.sheetShadow === 'none', '深色下隐藏态抽屉不投影（实际: ' + st.sheetShadow + '）');
    a = await alphaCheck('DARK');
    ['TL', 'TR', 'BL', 'BR'].forEach(k => {
      suite.ok(a[k].sum === 0, '深色 ' + k + ' 角缺口 alpha=0（实际: ' + a[k].sum + '）');
    });

    try {
      const png = nativeImage.createFromBuffer(await H.capturePng(win));
      fs.writeFileSync(path.join(__dirname, 'results', 'shadow-corner.png'), png.toPNG());
      out('截图: results/shadow-corner.png');
    } catch (e) { out('capturePage err ' + e.message); }

    /* ================= 自检：断言必须真能抓到回归 ================= */
    suite.step('自检：把 r11 旧阴影注回去，四角 alpha 必须升高（并复现「下两角更明显」）');
    await H.evalJson(win, 'try{if(typeof setThemeMode==="function")setThemeMode("light")}catch(e){};return 1');
    await H.sleep(1200);
    /* 用 user 源 CSS 模拟旧代码：同特异度下后插入者胜（不依赖 removeInsertedCSS，本版 Electron 里它不可靠） */
    await win.webContents.insertCSS('#app{box-shadow:0 0 40px rgba(0,0,0,.06)!important;}', { cssOrigin: 'user' });
    await H.sleep(700);
    await win.webContents.insertCSS('#editorSheet,#profileSheet,#timerSheet{box-shadow:0 -14px 44px rgba(16,24,40,.14)!important;}', { cssOrigin: 'user' });
    await H.sleep(1200);
    const stOld = await H.evalJson(win, 'var a=document.getElementById("app");var e=document.getElementById("editorSheet");return {app:getComputedStyle(a).boxShadow,sheet:getComputedStyle(e).boxShadow};');
    out('  injected: app=' + stOld.app + ' | sheet=' + stOld.sheet);
    const aOld = await alphaCheck('SELFCHECK_OLD');
    const topSum = aOld.TL.sum + aOld.TR.sum, botSum = aOld.BL.sum + aOld.BR.sum;
    out('  上两角 alpha 之和=' + topSum + ' | 下两角 alpha 之和=' + botSum);
    suite.ok(topSum > 20, '自检：旧 #app 阴影使上两角 alpha 升高（实际: ' + topSum + '）');
    suite.ok(botSum > 20, '自检：旧 .sheet 阴影使下两角 alpha 升高（实际: ' + botSum + '）');
    suite.ok(botSum > topSum * 2,
      '自检：复现用户「下面两角最明显」的不对称（下 ' + botSum + ' > 2×上 ' + topSum + '）');

    await H.drainPageErrs(win, suite);
  } catch (e) {
    suite.errs.push('套件异常: ' + (e && e.message));
    out('ERR ' + (e && e.stack || e));
  }
  try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
  try { if (bg && !bg.isDestroyed()) bg.destroy(); } catch (_) {}
  try { fs.writeFileSync(path.join(__dirname, '_shadow-corner.txt'), log.join('\n'), 'utf8'); } catch (_) {}
  const ok = H.finish(suite);
  app.exit(ok ? 0 : 1);
});
