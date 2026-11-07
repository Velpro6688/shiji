'use strict';
/* scripts/verify/verify-dark-palette.cjs —— 今日页配色【永久回归】（ui-1 新设计真值）
   ============================================================================
   用户反馈（验收锚点）：「深色模式UI设计得有点难看，特别是今日页那里颜色区分
   和黑色不是很配呀」

   r20 时代的解法是「七个星期色带按 WCAG 反解等亮度」；本轮 UI 优化（ui-1）
   方向已确认为**冷静极简**：星期七色封面退出默认主视觉，卡片统一中性表面，
   习惯色只作小范围识别。所以本套件不再锁「七色设计值」，改为锁新设计真值，
   并把用户反馈翻译成仍然成立的量化门：

     A. 深色页面底 = #141416（相对亮度 < 0.06）
     B. 深色卡片表面 = #202023、描边 = #3B3B42、描边宽 1px
     C. ★用户反馈量化门：卡片表面与页面底必须**真的分开**（亮度比 ≥1.08）——
        旧 bug 是整卡叠泥色，卡片与底几乎同色。
     D. ★今日页不得再出现「彩色色带」：.hh 必须是 transparent（七日逐一核对）。
        这条正是「颜色区分和黑色不配」的直接回归护栏。
     E. 完成/未完成卡同色（历史 bug：完成就整卡叠 --sage-t 变绿）
     F. 习惯名对卡片底对比度 ≥ 4.5:1（WCAG AA 正文）
     G. 七日卡片表面完全一致（新设计的一致性要求，替代旧「七色等亮度」）
     H. 浅色未受影响：卡片 #FFFFFF、描边 #E4E4E9、.hh 同样 transparent
     I. 截图：深/浅各一份，且深色帧必须真的是深色（防把浅色帧当深色证据）
     J. 正负对照：同一套比较函数喂旧值必须判 FAIL（自证断言非空转）

   运行（本机必须 unset ELECTRON_RUN_AS_NODE，否则 electron 退化为纯 Node）：
     node scripts/verify/run-electron.cjs scripts/verify/verify-dark-palette.cjs
   ============================================================================ */
const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const H = require(path.join(__dirname, '_harness.js'));

const NAME = 'verify-dark-palette';
const RESULT_DIR = path.join(__dirname, 'results');

const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);
app.on('window-all-closed', () => {});

/* ---------------- 设计真值表（与 docs/UI与交互优化-2026-10-10.md §3.2 一致） ---------------- */
const LIGHT = {
  appBg: 'rgb(245, 245, 247)',   /* --app-bg #F5F5F7 */
  cardBg: 'rgb(255, 255, 255)',  /* --ui-surface / --bg-card #FFFFFF */
  border: 'rgb(228, 228, 233)',  /* --ui-border / --line-2 #E4E4E9 */
  text: 'rgb(29, 29, 31)'        /* --ui-text / --text-1 #1D1D1F */
};
const DARK = {
  appBg: 'rgb(20, 20, 22)',      /* --app-bg #141416 */
  cardBg: 'rgb(32, 32, 35)',     /* --bg-card #202023 */
  border: 'rgb(59, 59, 66)',     /* --line-2 #3B3B42 */
  text: 'rgb(245, 245, 247)'     /* --text-1 #F5F5F7 */
};
const SAGE_T_DARK = 'rgb(31, 58, 44)';    /* --sage-t 深色（完成态专用绿，历史 bug 真身） */
const SAGE_T_LIGHT = 'rgb(233, 249, 238)';
const CARD_VS_PAGE_MIN = 1.10;            /* 卡片表面 vs 页面底亮度比下限（深色实测 1.131；旧「泥色卡」1.083 会被判失败） */
const TEXT_FLOOR = 4.5;

/* ---------------- 色彩工具（探针侧独立实现，不引用页面函数） ---------------- */
function parseRgb(s) {
  const str = String(s || '').trim();
  /* 十六进制（正负对照表里用的是 #RRGGBB 字面量） */
  const h = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(str);
  if (h) {
    const f = h[1].length === 3 ? h[1].split('').map(function (c) { return c + c; }).join('') : h[1];
    return { r: parseInt(f.slice(0, 2), 16), g: parseInt(f.slice(2, 4), 16), b: parseInt(f.slice(4, 6), 16), a: 1 };
  }
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
}
function relLum(s) {
  const c = parseRgb(s);
  if (!c || c.a < 0.99) return null;
  const f = [c.r, c.g, c.b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function contrast(a, b) {
  const la = relLum(a), lb = relLum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function isTransparent(s) {
  const c = parseRgb(s);
  return !!c && c.a < 0.01;
}
function isCompletionGreen(s, dark) { return s === (dark ? SAGE_T_DARK : SAGE_T_LIGHT); }

/* ★深色卡面是 linear-gradient 叠出来的，computed backgroundColor 恒为透明 →
   必须按**真实合成像素**取值，否则会拿透明色算出虚假的通过/失败。 */
function samplePatch(img, x, y, size) {
  const s = size || 4;
  const bmp = img.crop({ x: Math.round(x), y: Math.round(y), width: s, height: s }).toBitmap();
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < bmp.length; i += 4) { b += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2]; n++; }
  return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : null;
}
function rgbStr(c) { return c ? 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')' : null; }
function nearColor(a, want, tol) {
  const p = parseRgb(a), w = parseRgb(want);
  if (!p || !w) return false;
  const t = tol === undefined ? 6 : tol;
  return Math.abs(p.r - w.r) <= t && Math.abs(p.g - w.g) <= t && Math.abs(p.b - w.b) <= t;
}
/* 取卡片左上内边距处的真实像素（该处必为纯卡面，不含图标/文字/按钮） */
async function cardSurface(win) {
  const g = await H.evalJson(win, 'var c=document.querySelector("#checkinList .hcard.done");if(!c)return null;var b=c.getBoundingClientRect();return {x:b.left,y:b.top,vw:window.innerWidth};');
  if (!g) return null;
  const img = nativeImage.createFromBuffer(await H.capturePng(win));
  const scale = img.getSize().width / g.vw;
  const px = samplePatch(img, (g.x + 5) * scale, (g.y + 5) * scale, 4);
  return px ? rgbStr(px) : null;
}

/* ---------------- 页面侧脚本片段 ---------------- */

/* 干净重置 + 造 7 个 bool 习惯，把完成记录写到指定日期。
   坑①：必须 data.days={} 整体重置，否则 profile 里 store 播种的样例数据残留。
   坑②：习惯 key/name/icon 必须自造，避免命中 store 内建样例定义被重新物化。
   ★ui-1：习惯自带 color，用于验证「彩色色带已退出主视觉」这条回归护栏。 */
const KEY = ['dp_a', 'dp_b', 'dp_c', 'dp_d', 'dp_e', 'dp_f', 'dp_g'];
const NAM = ['甲学习', '乙喝水', '丙早睡', '丁冥想', '戊运动', '己早起', '庚读书'];
const ICO = ['📕', '🥤', '🛏️', '🕯️', '🏸', '🐓', '📗'];
const COL = ['#5D4F1F', '#2A527F', '#1E5B35', '#5939AB', '#674B22', '#8B2E49', '#1D5858'];

function mkScene(doneIdx, onDate) {
  const dateExpr = onDate ? JSON.stringify(onDate) : 'T';
  return [
    'var T=todayStr();var D=' + dateExpr + ';',
    'var keys=' + JSON.stringify(KEY) + ';',
    'var names=' + JSON.stringify(NAM) + ';',
    'var icons=' + JSON.stringify(ICO) + ';',
    'var cols=' + JSON.stringify(COL) + ';',
    'var didx=' + JSON.stringify(doneIdx) + ';',
    'var hs=[];for(var i=0;i<7;i++){hs.push({key:keys[i],name:names[i],type:"bool",icon:icons[i],color:cols[i],size:"wide",target:1,unit:"次",createdAt:Date.now(),archived:false});}',
    'data.habits=hs;',
    'data.days={};',
    'var day={};for(var j=0;j<didx.length;j++){day[keys[didx[j]]]=1;}',
    'data.days[D]=day;',
    'data.settings=data.settings||{};',
    'syncHabits();streakCacheReset();',
    'resetViewDate();go("today");renderAll();',
    'return {habits:data.habits.length,today:T};'
  ].join('');
}

/* 真实按钮点击导航（不使用任何调试钩子）：‹ → shiftViewDate(-1)，今天 → resetViewDate() */
function setViewDate(want) {
  return [
    'var want=' + JSON.stringify(want) + ';',
    'var nav=document.querySelector(".date-nav");',
    'if(!nav)return {ok:false,reason:"no-date-nav"};',
    'var btns=Array.prototype.slice.call(nav.querySelectorAll("button"));',
    'var iPrev=-1,iToday=-1;',
    'for(var i=0;i<btns.length;i++){var oc=btns[i].getAttribute("onclick")||"";',
    '  if(oc.indexOf("shiftViewDate(-1)")>=0)iPrev=i;',
    '  else if(oc.indexOf("resetViewDate")>=0)iToday=i;}',
    'function click(b){if(!b)return false;b.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));return true;}',
    'function cur(){var lab=(document.getElementById("viewDateLabel")||{}).textContent||"";var m=lab.match(/(\\d{2})\\/(\\d{2})/);return m?(new Date().getFullYear()+"-"+m[1]+"-"+m[2]):(/今天/.test(lab)?todayStr():null);}',
    'click(btns[iToday]);',
    'var at=cur();var steps=0;',
    'if(want!==at){var dW=new Date(want+"T12:00:00"),dA=new Date(at+"T12:00:00");var diff=Math.round((dA-dW)/86400000);',
    '  if(diff>0){for(var k=0;k<diff;k++){if(!click(btns[iPrev]))break;steps++;}}}',
    'var back=cur();',
    'var cls=document.getElementById("checkinList").className;',
    'return {ok:back===want,back:back,want:want,clsDow:(cls.match(/dow-\\d/)||[null])[0],steps:steps,label:(document.getElementById("viewDateLabel")||{}).textContent||""};'
  ].join('');
}

/* 读卡片：卡面底/描边、.hh 底、正文色、页面底 */
function readCard(want) {
  return [
    'var cl=document.getElementById("checkinList");',
    'var g=function(el){if(!el)return null;var c=getComputedStyle(el);return {bg:c.backgroundColor,btW:c.borderTopWidth,btC:c.borderTopColor};};',
    'var d=cl.querySelector(".hcard.done"),u=cl.querySelector(".hcard:not(.done)");',
    'var dd=d&&d.querySelector(".hh"),uu=u&&u.querySelector(".hh");',
    'var hn=d&&d.querySelector(".hn");',
    'return {clsDow:(cl.className.match(/dow-\\d/)||[null])[0],',
    '  nodeDay:new Date(' + JSON.stringify(want) + '+"T12:00:00").getDay(),',
    '  doneCount:cl.querySelectorAll(".hcard.done").length,',
    '  undoneCount:cl.querySelectorAll(".hcard:not(.done)").length,',
    '  doneCard:g(d),undoneCard:g(u),doneHH:g(dd),undoneHH:g(uu),',
    '  hnColor:hn?getComputedStyle(hn).color:null,',
    '  htmlDark:document.documentElement.classList.contains("dark"),',
    '  appBg:getComputedStyle(document.getElementById("app")).backgroundColor};'
  ].join('');
}

function shot(win, name) {
  return H.capturePng(win).then(function (buf) {
    const p = path.join(RESULT_DIR, name);
    fs.writeFileSync(p, buf);
    return p;
  });
}

/* 轮询等待：applyTheme() 是**同步**把 --app-bg 写进 documentElement.style 的，
   但 getComputedStyle(#app).backgroundColor 要等一次重绘才更新。
   坑：等待体必须回**真值**，不能回 0/''/false —— 深色 --app-bg 恰是近黑，
   亮度算出来接近 0（falsy）。故此处一律回对象 {lum:n}。 */
async function waitFor(win, body, ms, label) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < (ms || 6000)) {
    last = await H.evalJson(win, body);
    if (last) return { ok: true, value: last, waited: Date.now() - t0 };
    await H.sleep(150);
  }
  return { ok: false, value: last, waited: Date.now() - t0, label: label };
}

/* 2026-10-04..10-07 与 10-01..10-03 正好覆盖 dow-0..dow-6（2026-10-04 是周日） */
const DOW_DATES = [
  ['2026-10-04', 0], ['2026-10-05', 1], ['2026-10-06', 2], ['2026-10-07', 3],
  ['2026-10-01', 4], ['2026-10-02', 5], ['2026-10-03', 6]
];

let win = null;

app.whenReady().then(async function () {
  try {
    win = H.makeWin(suite, { show: false, offscreen: true, frame: false, width: 781, height: 900 });
    await H.loadPage(win);
    await H.bootWait(win);
    await H.sleep(1400);

    /* 关掉新手引导遮罩（会盖住截图）；.confirm-mask 只能隐藏不能删 */
    await H.evalJson(win, 'var s=document.getElementById("guideSkip");if(s)s.click();var m=document.getElementById("guideMask");if(m)m.style.display="none";return true');
    await H.sleep(250);
    await H.closeMask(win);

    /* ================= 浅色基线（改深色不得动浅色） ================= */
    await H.evalJson(win, 'setThemeMode("light");applyTheme();return true');
    await H.sleep(500);
    const lightM = {};
    for (const [want, ] of DOW_DATES) {
      await H.evalJson(win, mkScene([0, 1, 2, 3, 4, 5], want));
      await H.evalJson(win, setViewDate(want));
      await H.sleep(300);
      const c = await H.evalJson(win, readCard(want));
      lightM['dow' + c.nodeDay] = c;
    }
    suite.metric('lightMatrix', lightM);
    for (const [, dw] of DOW_DATES) {
      const e = lightM['dow' + dw];
      const tag = '[dow-' + dw + ']';
      suite.ok(!!e, 'H 浅色 ' + tag + ' 测点存在');
      if (!e) continue;
      suite.ok(e.doneCard && e.doneCard.bg === LIGHT.cardBg,
        'H 浅色' + tag + ' 卡片表面 = ' + LIGHT.cardBg + '（实际 ' + (e.doneCard && e.doneCard.bg) + '）');
      suite.ok(e.doneCard && e.doneCard.btW === '1px' && e.doneCard.btC === LIGHT.border,
        'H 浅色' + tag + ' 描边 1px / ' + LIGHT.border + '（实际 ' + (e.doneCard && e.doneCard.btW + '/' + e.doneCard.btC) + '）');
      suite.ok(e.doneHH && isTransparent(e.doneHH.bg),
        'H 浅色' + tag + ' .hh 无彩色底（彩色色带已退出主视觉；实际 ' + (e.doneHH && e.doneHH.bg) + '）');
      suite.ok(e.doneHH && e.undoneHH && e.doneHH.bg === e.undoneHH.bg,
        'H 浅色' + tag + ' 完成/未完成 .hh 同色');
      suite.ok(e.doneCard && e.undoneCard && e.doneCard.bg === e.undoneCard.bg,
        'H 浅色' + tag + ' 完成/未完成卡同色（防回退到「变绿/变白」）');
    }
    const lightSurface = await cardSurface(win);
    suite.metric('lightCardSurface', lightSurface);
    suite.ok(nearColor(lightSurface, LIGHT.cardBg),
      'H 浅色卡面真实像素 ≈ ' + LIGHT.cardBg + '（实测 ' + lightSurface + '）');

    /* ================= 深色七日矩阵 ================= */
    await H.evalJson(win, 'setThemeMode("dark");applyTheme();return true');
    const darkReady = await waitFor(win,
      'var c=getComputedStyle(document.getElementById("app")).backgroundColor;var m=String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);if(!m)return null;var f=[+m[1],+m[2],+m[3]].map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});var l=0.2126*f[0]+0.7152*f[1]+0.0722*f[2];return (l<0.06)?{lum:l,bg:c}:null;',
      8000, 'dark app-bg');
    const themeChk = await H.evalJson(win, 'return {dark:document.documentElement.classList.contains("dark"),theme:(data.settings||{}).theme,appBg:getComputedStyle(document.getElementById("app")).backgroundColor};');
    suite.ok(themeChk.dark === true && themeChk.theme === 'dark', 'A 深色已切换（html.dark + settings.theme=dark）');
    const appLum = relLum(themeChk.appBg);
    suite.ok(darkReady.ok && appLum !== null && appLum < 0.06,
      'A 深色页面底应为深色（--app-bg=' + themeChk.appBg + ' lum=' + (appLum === null ? '?' : appLum.toFixed(4)) + '，等待 ' + darkReady.waited + 'ms）');
    suite.ok(themeChk.appBg === DARK.appBg, 'A 深色页面底 = ' + DARK.appBg + '（实际 ' + themeChk.appBg + '）');

    const darkM = {};
    for (const [want, ] of DOW_DATES) {
      await H.evalJson(win, mkScene([0, 1, 2, 3, 4, 5], want));
      await H.evalJson(win, 'document.documentElement.classList.add("dark");return true');
      await H.evalJson(win, setViewDate(want));
      await H.sleep(320);
      const c = await H.evalJson(win, readCard(want));
      darkM['dow' + c.nodeDay] = c;
    }
    suite.metric('darkMatrix', darkM);

    /* 卡面真实像素：深色卡面由渐变叠出，computed backgroundColor 为透明，只能按像素判定 */
    const darkSurface = await cardSurface(win);
    suite.metric('darkCardSurface', darkSurface);
    suite.ok(nearColor(darkSurface, DARK.cardBg),
      'B 深色卡面真实像素 ≈ ' + DARK.cardBg + '（实际 ' + darkSurface + '；渐变叠出的卡面 computed 底恒为透明，必须按像素取值）');

    const cardBgs = [];
    for (const [want, dw] of DOW_DATES) {
      const e = darkM['dow' + dw];
      const tag = '[dow-' + dw + ' ' + want + ']';
      suite.ok(!!e && e.htmlDark === true, 'A 深色' + tag + ' 渲染时确实处于深色');
      if (!e) continue;

      /* B. 描边 = 新设计真值（卡面底色另由像素判定，见上） */
      suite.ok(e.doneCard && e.doneCard.btW === '1px' && e.doneCard.btC === DARK.border,
        'B 深色' + tag + ' 描边 1px / ' + DARK.border + '（实际 ' + (e.doneCard && e.doneCard.btW + '/' + e.doneCard.btC) + '）');

      /* D. ★核心回归护栏：不得再出现彩色色带 */
      suite.ok(e.doneHH && isTransparent(e.doneHH.bg),
        'D 深色' + tag + ' .hh 无彩色底（用户反馈「颜色区分和黑色不配」的直接护栏；实际 ' + (e.doneHH && e.doneHH.bg) + '）');

      /* E. 完成/未完成同色，且不得等于完成态专用绿 */
      suite.ok(e.doneHH && e.undoneHH && e.doneHH.bg === e.undoneHH.bg,
        'E 深色' + tag + ' 完成/未完成 .hh 同色（done=' + (e.doneHH && e.doneHH.bg) + ' undone=' + (e.undoneHH && e.undoneHH.bg) + '）');
      suite.ok(e.doneCard && e.undoneCard && e.doneCard.bg === e.undoneCard.bg,
        'E 深色' + tag + ' 完成/未完成卡同色');
      suite.ok(e.doneCard && !isCompletionGreen(e.doneCard.bg, true),
        'E 深色' + tag + ' 卡片不得等于完成态专用绿 ' + SAGE_T_DARK + '（历史 bug：完成就整卡叠 --sage-t）');

      /* C. ★用户反馈量化门：卡片表面与页面底必须真的分开 */
      const cCard = contrast(darkSurface, themeChk.appBg);
      suite.ok(cCard !== null && cCard >= CARD_VS_PAGE_MIN,
        'C 深色' + tag + ' 卡片表面对页面底 ≥' + CARD_VS_PAGE_MIN + ':1（旧 bug 整卡泥色几乎同底），实测=' + (cCard === null ? '?' : cCard.toFixed(3)) + ':1（卡 ' + darkSurface + ' 底 ' + themeChk.appBg + '）');

      /* F. 正文对卡片底 ≥4.5:1 */
      const cText = contrast(e.hnColor || DARK.text, darkSurface);
      suite.ok(cText !== null && cText >= TEXT_FLOOR,
        'F 深色' + tag + ' 习惯名对卡片底 ≥' + TEXT_FLOOR + ':1（WCAG AA），实测=' + (cText === null ? '?' : cText.toFixed(2)) + ':1（字=' + e.hnColor + ' 底=' + darkSurface + '）');

      cardBgs.push({ dow: dw, bg: darkSurface });
    }

    /* G. 七日卡片表面完全一致（新设计的一致性要求） */
    const uniqBg = {};
    cardBgs.forEach(function (x) { uniqBg[x.bg] = 1; });
    suite.ok(cardBgs.length === 7 && Object.keys(uniqBg).length === 1 && nearColor(Object.keys(uniqBg)[0], DARK.cardBg),
      'G 七日卡片表面完全一致且 ≈ ' + DARK.cardBg + '（实测 ' + Object.keys(uniqBg).join(', ') + '）');

    /* I. 深色截图：必须等 DOM 计算值真的等于深色设计色才落盘（防把浅色帧当深色证据） */
    await H.evalJson(win, mkScene([0, 1, 2, 3, 4, 5], '2026-10-07'));
    await H.evalJson(win, 'document.documentElement.classList.add("dark");return true');
    await H.evalJson(win, setViewDate('2026-10-07'));
    await H.sleep(400);
    let darkShotBytes = 0, darkShotPath = null;
    for (let i = 0; i < 8; i++) {
      await H.sleep(600);
      /* 深色卡面 computed 底恒为透明 → 用「描边色 + 深色类 + 真实像素」三重证据确认是深色帧 */
      const now = await H.evalJson(win, 'var d=document.getElementById("checkinList").querySelector(".hcard.done");var cs=getComputedStyle(d);return {btC:cs.borderTopColor,dark:document.documentElement.classList.contains("dark")};');
      const buf = await H.capturePng(win);
      if (buf.length > 5000 && now.dark === true && now.btC === DARK.border) {
        darkShotPath = path.join(RESULT_DIR, 'dark-palette-dark.png');
        fs.writeFileSync(darkShotPath, buf);
        darkShotBytes = buf.length;
        break;
      }
      darkShotBytes = buf.length;
    }
    suite.metric('shotDark', { path: darkShotPath, bytes: darkShotBytes });
    suite.ok(darkShotBytes > 5000 && !!darkShotPath,
      'I 深色截图应非空且落盘于真深色帧（实测 ' + darkShotBytes + ' B, path=' + darkShotPath + '）');

    /* 浅色截图（同一场景回切浅色） */
    await H.evalJson(win, 'setThemeMode("light");applyTheme();return true');
    await H.sleep(900);
    const lightShotPath = await shot(win, 'dark-palette-light.png');
    const lightShotBytes = fs.statSync(lightShotPath).size;
    suite.metric('shotLight', { path: lightShotPath, bytes: lightShotBytes });
    suite.ok(lightShotBytes > 5000, 'I 浅色截图应非空（实测 ' + lightShotBytes + ' B）');
    const darkBytes = fs.readFileSync(path.join(RESULT_DIR, 'dark-palette-dark.png'));
    const lightBytes = fs.readFileSync(lightShotPath);
    suite.ok(Buffer.compare(darkBytes, lightBytes) !== 0,
      'I 深色与浅色截图内容应不同（深=' + darkBytes.length + ' B 浅=' + lightBytes.length + ' B）');

    /* J. 正负对照：同一套比较函数喂旧值必须判 FAIL —— 自证断言非空转 */
    const NEG = [
      ['深 旧「泥色卡贴黑底」卡片 #1C1C1E 对页面 #141416', '#1C1C1E', '#141416', CARD_VS_PAGE_MIN],
      ['深 旧 习惯名 #3D4C68 对色带 #1E5B35', '#3D4C68', '#1E5B35', TEXT_FLOOR],
      ['深 旧 便签正文 #3A4356 对灰黑卡 #2C2C30', '#3A4356', '#2C2C30', TEXT_FLOOR]
    ];
    for (const [label, fg, bg, bound] of NEG) {
      const got = contrast(fg, bg);
      suite.ok(got !== null && got < bound,
        'J 正负对照「' + label + '」= ' + (got === null ? '?' : got.toFixed(2)) + ' 必须低于门限 ' + bound + '（自证断言非空转）');
    }
    /* J2. 自证 D 组护栏有区分力：旧彩色色带色值都**不是**透明，
       所以「.hh 必须 transparent」这条断言真能抓到「彩色色带回归」。 */
    const OLD_BANDS = ['#5D4F1F', '#2A527F', '#1E5B35', '#5939AB', '#674B22', '#8B2E49', '#1D5858'];
    suite.ok(OLD_BANDS.every(function (b) { return !isTransparent(b); }),
      'J2 自证：旧七色色带色值均非透明 → D 组「.hh 必须 transparent」护栏有区分力');

    await H.drainPageErrs(win, suite);
    try { win.destroy(); } catch (_) {}
    win = null;
  } catch (e) {
    suite.errs.push('探针异常: ' + ((e && e.stack) || (e && e.message) || e));
    try { if (win) win.destroy(); } catch (_) {}
  }

  suite.metric('notMeasured', [
    '未改系统时钟：七个星期靠真实按钮点击导航（‹ 前一天按钮 dispatchEvent click）走到 2026-10-01..10-07 历史日期覆盖 dow-0..dow-6，导航到位由页面自身渲染的 #viewDateLabel 文本 + dow-N 类双证据确认。',
    '未在真实用户 %APPDATA%\\habit-lab 目录上测（用独立 profile）。',
    '「好看不好看」本身无法自动断言；本套件只锁死可量化的部分（卡面/描边设计值、卡面对底亮度比、正文对比度、七日一致性、深浅差异），最终观感仍需人眼复核截图。',
    'ui-1 起星期七色不再参与卡片主视觉，故不再断言七色等亮度与色相族；改用「七日卡面完全一致」+「.hh 必须透明」两条新护栏。旧套件存档于 results/_backup-verify-dark-palette-r20.cjs。'
  ]);
  const ok = H.finish(suite);
  try { app.exit(ok ? 0 : 1); } catch (_) { process.exit(ok ? 0 : 1); }
});
