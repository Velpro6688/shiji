'use strict';
/* scripts/verify/verify-r21-contrast.cjs
 * ============================================================================
 * r21 永久回归：深色/浅色文字对比度收敛 + 未适配颜色回填 + 开关 on/off 状态可辨
 *
 * 背景（用户两条反馈）：
 *   ①「深色模式下，字体颜色也得适配一下，有些字体太深色了，看不清」
 *   ②「还有UI方面太生硬了，有些颜色的没改过来都不适配」
 * 独立探针（scripts/verify/_verify-darktext-independent.cjs）实测：深色 12 条低对比
 * （最低 1.00:1）+ 浅色多条（最低 1.05:1）。本轮修完，本套件把它固化成永久门。
 *
 * 五组断言：
 *   A 令牌层：themePalette 注入到 <html> 的 4+4 个灰色令牌必须等于设计值；
 *             --text-1 是护栏（r21 未动，防误伤）。
 *   B 逐控件最终色：15 个控件的 computedColor / backgroundColor 必须等于设计值
 *             （这组抓的是「CSS 层被更特异的旧规则压回去」这类静默失效）。
 *   C 对比度下限（★核心）：走**像素法**量真实底色（本项目深色卡片是 backgroundImage
 *             渐变叠出来的，实测底 ≠ CSS 理论底：#1C1C1E 的卡实测 #29292B），
 *             再配 computed 前景色算 WCAG 比值。正文 4.5:1。
 *   D 正负对照：同一套比较函数喂「r21 之前的旧值」必须判 FAIL —— 自证断言非空转。
 *   E 深浅截图内容不同（防「切了主题但拿到上一帧」的假通过）。
 *
 * 另含一处**本轮回归的守卫**：深色 .mi-toggle 的 on/off 必须视觉可辨。
 *   首版写成 html.dark .mi-toggle{...!important}（(0,2,0)，源序在 :1709 之后）把
 *   .mi-toggle.on 的蓝色一起覆盖 → 深色下 on/off 逐像素相同。现用 :not(.on) 防复发。
 *
 * 运行（本机全局设了 ELECTRON_RUN_AS_NODE=1，会让 electron 退化成纯 Node 静默崩溃）：
 *   unset ELECTRON_RUN_AS_NODE
 *   rm -f scripts/verify/results/verify-r21-contrast-result.json
 *   ./node_modules/electron/dist/electron.exe scripts/verify/verify-r21-contrast.cjs
 * ============================================================================
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '_harness.js'));

/* ---------------------------------------------------------------- 设计真值 */
/* ui-1/ui-2 设计真值：与 docs/UI与交互优化-2026-10-10.md §3.2 的令牌表逐值对应
   （主文字 #1D1D1F / #F5F5F7，次级 #626269 / #B6B6BF，辅助 #6B6B73 / #A7A7B0）。 */
const TOK = {
  light: {
    '--text-1': '#1D1D1F', '--text-2': '#626269', '--text-3': '#6B6B73',
    '--ink-soft': '#626269', '--ink-mute': '#6B6B73'
  },
  dark: {
    '--text-1': '#F5F5F7', '--text-2': '#B6B6BF', '--text-3': '#A7A7B0',
    '--ink-soft': '#B6B6BF', '--ink-mute': '#A7A7B0'
  }
};

/* 逐控件最终色：[selector, 属性, light 期望, dark 期望]
   dark 期望为 null = 与浅色同值（有意统一到品牌色）*/
const CTRL = [
  /* .sec-title .st-em 在今日/我的两页各有一处（一为主色图标、一为次级图标），
     页面内实例顺序不稳定 → 不锁单一 hex，改由下方「设计允许集合」断言 + C 组对比度下限把关。 */
  ['#page-today > .sec-title .st-em', 'color', null, null],
  ['#page-today > .sec-title .st-em', 'backgroundColor', null, '#2C2C30'],
  ['#page-mine .sec-title .st-em', 'color', null, null],
  ['.tabbar .tab.on', 'color', '#0051D5', '#5AC8FA'],
  ['.tabbar .tab.on', 'backgroundColor', null, '#2C2C30'],
  ['.cup-row .info', 'color', '#626269', '#B6B6BF'],
  ['.stat-mini span', 'color', '#626269', '#B6B6BF'],
  /* ⚠ 期望值口径：.heat-lb{color:var(--ink-soft)} / .heat-lb.head{color:var(--ink-mute)}，
     所以深色 .heat-lb:not(.head) 拿到的是 --ink-soft=#B6B6BF，**不是** #A7A7B0（那是 --ink-mute）。 */
  ['.heat-lb:not(.head)', 'color', '#626269', '#B6B6BF'],
  ['.heat-lb.head', 'color', '#6B6B73', '#A7A7B0'],
  ['.heat-date .heat-week', 'color', '#6B6B73', '#A7A7B0'],
  ['.heat-day', 'color', null, '#B6B6BF'],
  ['.memo-list-empty', 'color', '#6B6B73', '#A7A7B0'],
  ['.badge .bd', 'color', '#6B6B73', '#A7A7B0'],
  ['.badge .bn', 'color', null, '#F5F5F7'],
  ['.mood-pick .mn', 'color', '#6B6B73', '#A7A7B0'],
  ['.mi-s', 'color', '#6B6B73', '#B6B6BF'],
  ['.stat-mini.a .sm-ico', 'color', null, null], /* 图标：两主题都是语义蓝，只记录不锁 */
  ['#page-mine .p-stat span', 'color', '#626269', '#B6B6BF'],
  ['#page-mine .p-stat b', 'color', null, null],
  ['.st-add', 'color', '#FFFFFF', '#FFFFFF'],
  ['.cup-row .mini-btn', 'color', '#0051D5', '#5AC8FA'],
  ['.tabbar .tab:not(.on)', 'color', '#626269', '#B6B6BF'],
  ['.ri-tags .rtag-group', 'color', null, '#A7A7B0']
];

/* C 组：对比度下限（正文 4.5:1）。selector 会取第一个可见实例 */
const FLOOR = [
  ['#page-today > .sec-title .st-em', 4.5, 4.5],
  ['.tabbar .tab.on', 4.5, 4.5],
  ['.cup-row .info', 4.5, 4.5],
  ['.stat-mini span', 4.5, 4.5],
  ['.heat-lb:not(.head)', 4.5, 4.5],
  ['.heat-day', 4.5, 4.5],
  ['.memo-list-empty', 4.5, 4.5],
  ['.badge .bd', 4.5, 4.5],
  ['.badge .bn', 4.5, 4.5],
  ['.mood-pick .mn', 4.5, 4.5],
  ['.mi-s', 4.5, 4.5],
  ['#page-mine .p-stat span', 4.5, 4.5],
  ['.heat-date .heat-week', null, 4.5] /* 浅色 8.5px 取不到字形像素，仅深色 */
];

/* D 组正负对照：r21 之前的旧组合，必须判 FAIL（< 4.5） */
const NEG = [
  ['深 旧 .cup-row .info', '#6E6E73', '#29292B', 2.53],
  ['深 旧 .badge .bn', '#0A1B3D', '#252527', 1.08],
  ['深 旧 .heat-day', '#3D4C68', '#1C1C1E', 1.97],
  ['深 旧 .p-stat span', '#6E6E73', '#3147AC', 1.56],
  ['深 旧 .sec-title .st-em', '#007AFF', '#F2F2F7', 3.60],
  ['浅 旧 --text-3', '#8E8E93', '#FFFFFF', 3.26],
  ['浅 旧 --ink-mute', '#97A0B4', '#FFFFFF', 2.62],
  ['浅 旧 .p-stat span', '#8E8E93', '#4C93F6', 1.05],
  ['浅 旧 .heat-lb', '#97A0B4', '#F8F8F8', 2.54],
  ['深 旧 .mi-toggle 轨道(可辨性)', '#3A3A3C', '#1C1C1E', 1.50]
];

/* ---------------------------------------------------------------- 色彩工具 */
function hex2rgb(h) {
  const s = String(h).replace('#', '');
  const f = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
function parseRgb(s) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(String(s || ''));
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
}
function chan(v) { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(rgb) { return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]); }
function contrast(a, b) {
  const la = Array.isArray(a) ? lum(a) : lum(hex2rgb(a));
  const lb = Array.isArray(b) ? lum(b) : lum(hex2rgb(b));
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
/* CSS 自定义属性经 getPropertyValue 返回的是**原始书写串**（如 '#000000'），
   而元素 computedColor 返回 'rgb(...)' —— 两者都要能比。 */
function normRgb(v) {
  const s = String(v || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) { const a = hex2rgb(s); return { r: a[0], g: a[1], b: a[2], a: 1 }; }
  return parseRgb(s);
}
function sameColor(actual, want) {
  const a = normRgb(actual);
  if (!a) return false;
  const w = hex2rgb(want);
  return a.a > 0.99 && a.r === w[0] && a.g === w[1] && a.b === w[2];
}
function hx(rgb) { return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(); }


/* ★造景：fresh profile 下 data.habits=0 / data.days=0，.cup-row / .heat-day / .badge /
   .ri-tags .rtag-group 这些选择器根本不存在 —— C 组会以 MISS 静默跳过（等于没测）。
   按 verify-dark-palette.cjs 的 mkScene 套路造 5 个习惯 + 今天一条记录（喝水 5/8 未完成但 cup-row 存在；
   按时睡觉/早起/冥想已完成 → streak≥1 → rtag-group 出现），再走应用自己的
   syncHabits/streakCacheReset/resetViewDate/go/renderAll 通路（不用任何测试钩子）。 */
const SEED = [
  'var T=todayStr();',
  'var now=Date.now();',
  'var hs=[',
  ' {key:"water",name:"\u559d\u6c34",icon:"\uD83D\uDCA7",type:"count",target:8,unit:"\u676f",color:"#7FA0B4",size:"wide",createdAt:now,archived:false},',
  ' {key:"sleep",name:"\u6309\u65f6\u7761\u89c9",icon:"\uD83D\uDE34",type:"bool",color:"#A794C0",size:"wide",createdAt:now,archived:false},',
  ' {key:"early",name:"\u65e9\u8d77",icon:"\uD83C\uDF05",type:"bool",color:"#D69B72",size:"wide",createdAt:now,archived:false},',
  ' {key:"reading",name:"\u5b66\u4e60",icon:"\uD83D\uDCD6",type:"bool",color:"#D08D98",size:"wide",createdAt:now,archived:false},',
  ' {key:"meditation",name:"\u51a5\u60f3",icon:"\uD83E\uDDD8",type:"bool",color:"#6EB8AE",size:"wide",createdAt:now,archived:false}',
  '];',
  'data.habits=hs;',
  'data.days={};',
  'var day={};day.water=5;day.sleep=true;day.early=true;day.meditation=true;',
  'data.days[T]=day;',
  'if(!data.meta)data.meta={};',
  'syncHabits();streakCacheReset();resetViewDate();go("today");renderAll();',
  'go("mine");renderAll();go("stat");renderAll();go("today");renderAll();',
  'return {habits:data.habits.length,days:Object.keys(data.days).length,',
  '  cups:document.querySelectorAll(".cup-row").length,heat:document.querySelectorAll(".heat-day").length,',
  '  badges:document.querySelectorAll("#badgeGrid > *").length,rtag:document.querySelectorAll(".ri-tags .rtag-group").length};'
].join('');

/* ---------------------------------------------------------------- 套件 */
const suite = H.makeSuite('verify-r21-contrast');
H.globalKillSwitch(suite.name, suite);
H.initProfile('verify-r21-contrast');
H.stubIpc(suite.calls);
app.on('window-all-closed', () => {});
const SHOT_DIR = path.join(H.ROOT, 'scripts', 'verify', 'results');

/* ---- 页面侧助手（evalJson 自带 IIFE，body 必须裸 return） ---- */
const READ_TOKENS = `
  var cs=getComputedStyle(document.documentElement), out={};
  ['--text-1','--text-2','--text-3','--ink-soft','--ink-mute'].forEach(function(k){
    out[k]=cs.getPropertyValue(k).trim();
  });
  return {tok:out, dark:document.documentElement.classList.contains('dark'),
          appBg:getComputedStyle(document.getElementById('app')).backgroundColor};`;

const readCtrl = (sel, prop) => `
  var all=document.querySelectorAll(${JSON.stringify(sel)}),el=null,r=null,nz=0;
  var vw=window.innerWidth,vh=window.innerHeight;
  /* 先找完全落在视口内的（像素法采样必须落在截图里；热力图容器会横向滚动，第一格常在 x<0） */
  for(var i=0;i<all.length;i++){var b0=all[i].getBoundingClientRect();
    if(b0.width<1||b0.height<1) continue;
    nz++;
    if(b0.left>=0&&b0.top>=0&&b0.right<=vw&&b0.bottom<=vh){el=all[i];r=b0;break;}
    if(!el){el=all[i];r=b0;}}
  if(!el) return {miss:true, why:(all.length?(nz?'all-off-viewport-zero':'all-zero-rect'):'not-in-dom'), n:all.length};
  var inVp=(r.left>=0&&r.top>=0&&r.right<=window.innerWidth&&r.bottom<=window.innerHeight);
  var v=getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)});
  var nv=/backgroundColor/.test(${JSON.stringify(prop)})?getComputedStyle(el).backgroundColor:'';
  if(${JSON.stringify(prop)}==='color'){
    var n=el; var eff=null;
    while(n&&n!==document.documentElement){
      var b=getComputedStyle(n).backgroundColor;
      if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent'){eff=b;break;}
      n=n.parentElement;
    }
    return {v:v, eff:eff||getComputedStyle(document.documentElement).backgroundColor,
            rect:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
  }
  return {v:v, bg:nv, rect:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};`;

const readToggle = `
  var ids=['tgStartup','tgRestore','tgRemindPer','tgRemindSum','tgSound','tgAdmin'], rows=[];
  ids.forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    var cs=getComputedStyle(el), af=getComputedStyle(el,'::after');
    rows.push({id:id, on:el.classList.contains('on'), bg:cs.backgroundColor,
      bgi:cs.backgroundImage==='none'?'none':'grad', knobBg:af.backgroundColor});
  });
  return {rows:rows};`;

/* ---- 主题切换：必须轮询，不能固定 sleep（applyTheme 写变量是同步的，
       但 getComputedStyle 要等一次重绘；实测立即读仍是上一主题）---- */
async function setTheme(win, mode) {
  await H.evalJson(win, `if(typeof setThemeMode==='function')setThemeMode(${JSON.stringify(mode)});return 1;`);
  const wantDark = mode === 'dark';
  for (let i = 0; i < 45; i++) {
    const r = await H.evalJson(win, READ_TOKENS);
    if (r && r.dark === wantDark) {
      const black = r.appBg === 'rgb(20, 20, 22)';
      const f2 = r.appBg === 'rgb(245, 245, 247)';
      /* falsy-zero 陷阱：深色 --app-bg 恰是 rgb(0,0,0)，只能用正则判定 */
      if (wantDark ? black : f2) return r;
    }
    await H.sleep(150);
  }
  return null;
}

/* ---- goPage：真实点击底部 tab ---- */
async function goPage(win, tab) {
  await H.evalJson(win, `
    var t=document.querySelector('.tabbar .tab[data-tab='+${JSON.stringify(JSON.stringify(tab))}+']');
    if(!t){ var all=document.querySelectorAll('.tabbar .tab'); for(var i=0;i<all.length;i++){ if((all[i].textContent||'').indexOf(${JSON.stringify(tab)})<0) continue; t=all[i]; break; } }
    if(!t) return {miss:true};
    t.dispatchEvent(new MouseEvent('click',{bubbles:true})); return {ok:true};`);
  /* 轮询等页面真的显示 */
  for (let i = 0; i < 30; i++) {
    const r = await H.evalJson(win, `
      var p=document.getElementById('page-'+${JSON.stringify(tab)});
      return {on:!!(p&&(p.classList.contains('on')||p.classList.contains('active')||getComputedStyle(p).display!=='none'))};`);
    if (r && r.on) return true;
    await H.sleep(150);
  }
  return false;
}

/* ---- 像素法量真实底色：裁元素矩形 → 取众数色（底色占面积最大） ----
   返回 {buf, size, img}；img 是 NativeImage，**必须与 rect 同帧**使用
   （见 C 组循环里的同帧约束说明）。 */
async function shotPng(win) {
  for (let t = 0; t < 6; t++) {
    const img = require('electron').nativeImage.createFromBuffer(await H.capturePng(win));
    const buf = img.toPNG();
    if (buf.length > 5000) return { buf, size: img.getSize(), img };
    await H.sleep(700);
  }
  return null;
}
function nativeImageToRgba(img, rect) {
  const size = img.getSize();
  const x = Math.max(0, Math.min(rect.x, size.width - 1));
  const y = Math.max(0, Math.min(rect.y, size.height - 1));
  const w = Math.max(1, Math.min(rect.w, size.width - x));
  const h = Math.max(1, Math.min(rect.h, size.height - y));
  const bmp = img.crop({ x, y, width: w, height: h }).toBitmap(); /* BGRA */
  const px = [];
  for (let i = 0; i + 3 < bmp.length; i += 4) {
    if (bmp[i + 3] < 200) continue;
    px.push([bmp[i + 2], bmp[i + 1], bmp[i]]);
  }
  return px;
}
/* 16 级量化求众数簇（8 级会把 #FFFFFF 测成 #F8F8F8），再在簇内取原始均值 */
function modalBg(px) {
  if (!px.length) return null;
  const bins = new Map();
  for (const p of px) {
    const k = (p[0] >> 4) + ',' + (p[1] >> 4) + ',' + (p[2] >> 4);
    let e = bins.get(k);
    if (!e) { e = { n: 0, s: [0, 0, 0] }; bins.set(k, e); }
    e.n++; e.s[0] += p[0]; e.s[1] += p[1]; e.s[2] += p[2];
  }
  let best = null;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.s[0] / best.n), Math.round(best.s[1] / best.n), Math.round(best.s[2] / best.n)] : null;
}

/* ================================================================ 主流程 */
async function main() {
  const win = H.makeWin(suite, { show: false, offscreen: true, frame: false, width: 520, height: 760 });
  await H.loadPage(win);
  await H.bootWait(win);
  await H.sleep(1400);

  /* 隐藏引导/确认遮罩（只隐藏，绝不能 remove：#confirmMask 是静态 DOM） */
  await H.evalJson(win, `
    var g=document.getElementById('guideMask'); if(g) g.style.display='none';
    var cm=document.getElementById('confirmMask'); if(cm) cm.classList.remove('show');
    return 1;`);

  /* 造出 2 个开启态开关（新 profile 默认全 off，否则验不到 .on 分支） */
  await H.evalJson(win, `
    if(typeof data==='undefined'||!data) return {miss:true};
    data.settings=data.settings||{}; data.settings.remindPerHabit=true; data.settings.remindSummary=true; data.settings.sound=true;
    if(typeof renderAll==='function') renderAll();
    return {ok:true};`);
  await H.sleep(600);

  /* ★造景（C 组选择器必须真实存在，否则 MISS 静默跳过 = 假通过） */
  const seeded = await H.evalJson(win, SEED);
  suite.metric('seeded', JSON.stringify(seeded));
  suite.ok(!!(seeded && seeded.habits >= 5 && seeded.days >= 1 && seeded.cups >= 1 && seeded.heat >= 1 && seeded.badges >= 1),
    'C 造景：habits=' + (seeded && seeded.habits) + ' days=' + (seeded && seeded.days) + ' cups=' + (seeded && seeded.cups) +
    ' heat=' + (seeded && seeded.heat) + ' badges=' + (seeded && seeded.badges) + ' rtag=' + (seeded && seeded.rtag));
  await H.sleep(900);

  const results = {};

  for (const [mode, tag] of [['light', 'light'], ['dark', 'dark']]) {
    const tr = await setTheme(win, mode);
    suite.ok(!!tr, tag + '：主题切换落地（轮询到 --app-bg 与类名一致）');
    if (!tr) continue;

    /* --- A 令牌层 --- */
    for (const [k, want] of Object.entries(TOK[mode])) {
      const got = (tr.tok[k] || '').trim();
      const okv = sameColor(got, want);
      suite.ok(okv, `A[${tag}] 令牌 ${k} = ${want}（实测 ${got}）`);
    }

    /* --- B 逐控件最终色（先切到各页再读，避免隐藏页 rect=0） --- */
    /* today 页 */
    await goPage(win, 'today');
    await H.sleep(500);
    /* 注意：热力图 / 徽章都在 #page-stat，不在 today/mine。
       放错页会在隐藏页读到 rect=0 → all-off-viewport-zero 假失败（已踩过一次）。 */
    const todaySels = ['#page-today > .sec-title .st-em', '.cup-row .info', '.cup-row .mini-btn',
      '.ri-tags .rtag-group', '.mood-pick .mn'];
    for (const sel of todaySels) {
      const row = CTRL.find(c => c[0] === sel);
      if (!row) continue;
      const want = mode === 'light' ? row[2] : (row[3] !== undefined ? row[3] : row[2]);
      if (want === null || want === undefined) continue;
      const got = await H.evalJson(win, readCtrl(sel, 'color'));
      if (got && got.miss) { results[tag + ' ' + sel + ' color'] = 'MISS(' + got.why + ')';
        suite.ok(false, `B[${tag}] ${sel} 不在 DOM（${got.why}）`); continue; }
      results[tag + ' ' + sel + ' color'] = got.v;
      suite.ok(sameColor(got.v, want), `B[${tag}] ${sel} color = ${want}（实测 ${got.v}）`);
    }
    /* stat 页 */
    await goPage(win, 'stat');
    await H.sleep(600);
    for (const sel of ['.stat-mini span', '.heat-lb:not(.head)', '.heat-lb.head', '.heat-date .heat-week', '.heat-day', '.badge .bd', '.badge .bn']) {
      const want = (() => {
        const row = CTRL.find(c => c[0] === sel);
        if (!row) return null;
        return mode === 'light' ? row[2] : (row[3] !== undefined ? row[3] : row[2]);
      })();
      if (want === null || want === undefined) continue;
      const got = await H.evalJson(win, readCtrl(sel, 'color'));
      if (got && got.miss) { results[tag + ' ' + sel + ' color'] = 'MISS(' + got.why + ')';
        suite.ok(false, `B[${tag}] ${sel} 不在 DOM（${got.why}）`); continue; }
      results[tag + ' ' + sel + ' color'] = got.v;
      suite.ok(sameColor(got.v, want), `B[${tag}] ${sel} color = ${want}（实测 ${got.v}）`);
    }
    /* memo 页 */
    await goPage(win, 'memo');
    await H.sleep(600);
    {
      const want = mode === 'light' ? '#6B6B73' : '#A7A7B0';
      const got = await H.evalJson(win, readCtrl('.memo-list-empty', 'color'));
      if (got && !got.miss) {
        results[tag + ' .memo-list-empty color'] = got.v;
        suite.ok(sameColor(got.v, want), `B[${tag}] .memo-list-empty color = ${want}（实测 ${got.v}）`);
      }
      const st = await H.evalJson(win, readCtrl('.st-add', 'color'));
      if (st && !st.miss) {
        results[tag + ' .st-add color'] = st.v;
        suite.ok(sameColor(st.v, '#FFFFFF'), `B[${tag}] .st-add 白字（实测 ${st.v}）`);
      }
    }
    /* mine 页 */
    await goPage(win, 'mine');
    await H.sleep(600);
    for (const sel of ['.mi-s', '#page-mine .p-stat span', '.tabbar .tab:not(.on)', '.tabbar .tab.on', '#page-mine .sec-title .st-em']) {
      const row = CTRL.find(c => c[0] === sel);
      if (!row) continue;
      const want = mode === 'light' ? row[2] : (row[3] !== undefined ? row[3] : row[2]);
      if (want === null || want === undefined) continue;
      const got = await H.evalJson(win, readCtrl(sel, 'color'));
      if (got && got.miss) { results[tag + ' mine ' + sel + ' color'] = 'MISS(' + got.why + ')';
        suite.ok(false, `B[${tag}] mine ${sel} 不在 DOM（${got.why}）`); continue; }
      results[tag + ' mine ' + sel + ' color'] = got.v;
      suite.ok(sameColor(got.v, want), `B[${tag}] ${sel} color = ${want}（实测 ${got.v}）`);
    }
    /* .tab.on 深色底必须是深色（不能还是浅蓝胶囊） */
    {
      const bg = await H.evalJson(win, readCtrl('.tabbar .tab.on', 'backgroundColor'));
      if (bg && !bg.miss) {
        results[tag + ' .tab.on backgroundColor'] = bg.bg;
        if (mode === 'dark') {
          suite.ok(sameColor(bg.bg, '#2C2C30'), `B[dark] .tab.on 胶囊底 = #2C2C30（实测 ${bg.bg}；旧值浅蓝渐变即回归）`);
        } else {
          /* 浅色胶囊是 linear-gradient（backgroundImage），backgroundColor 为透明 */
          const raw = await H.evalJson(win, `var e=document.querySelector('.tabbar .tab.on');
            return e?{bgi:getComputedStyle(e).backgroundImage}:{miss:true};`);
          const hasGrad = raw && raw.bgi && /gradient/.test(raw.bgi);
          results['light .tab.on backgroundImage'] = raw && raw.bgi ? raw.bgi.slice(0, 90) : 'none';
          suite.ok(hasGrad, `B[light] .tab.on 仍是浅蓝胶囊渐变（实测 ${raw && raw.bgi ? raw.bgi.slice(0, 60) : 'none'}）`);
        }
      }
    }
    /* .sec-title .st-em 深色底必须是深色（E1：旧值被 (0,2,0) 白渐变压死） */
    {
      const bg = await H.evalJson(win, readCtrl('.sec-title .st-em', 'backgroundColor'));
      if (bg && !bg.miss) {
        results[tag + ' .sec-title .st-em backgroundColor'] = bg.bg;
        if (mode === 'dark') {
          suite.ok(sameColor(bg.bg, '#2C2C30'), `B[dark] .sec-title .st-em 底 = #2C2C30（实测 ${bg.bg}；旧值白渐变即 E1 复发）`);
        }
      }
    }

    /* --- 分区标题图标：取值必须落在设计允许集合内（主色 or 次级色） --- */
    {
      const allowed = mode === 'light' ? ['#0051D5', '#626269'] : ['#5AC8FA', '#B6B6BF'];
      for (const [sel, page] of [['#page-today > .sec-title .st-em', 'today'], ['#page-mine .sec-title .st-em', 'mine']]) {
        await goPage(win, page);
        await H.sleep(450);
        const got = await H.evalJson(win, readCtrl(sel, 'color'));
        if (got && got.miss) { results[tag + ' ' + sel + ' color'] = 'MISS(' + got.why + ')'; continue; }
        results[tag + ' ' + sel + ' color'] = got.v;
        suite.ok(allowed.some(a => sameColor(got.v, a)),
          `B[${tag}] ${sel} 属于设计允许集合 [${allowed.join(', ')}]（实测 ${got.v}）`);
      }
    }

    /* --- 开关 on/off 状态（★本轮回归守卫） --- */
    {
      const tg = await H.evalJson(win, readToggle);
      if (tg && tg.rows && tg.rows.length === 6) {
        const on = tg.rows.filter(r => r.on), off = tg.rows.filter(r => !r.on);
        suite.metric(tag + 'ToggleOn', on.map(r => r.id + ':' + r.bg).join(' | '));
        suite.metric(tag + 'ToggleOff', off.map(r => r.id + ':' + r.bg).join(' | '));
        suite.ok(on.length >= 2, `[${tag}] 造出 ≥2 个开启态开关（实测 ${on.length}）`);
        if (on.length && off.length) {
          const differ = on[0].bg !== off[0].bg || on[0].bgi !== off[0].bgi;
          suite.ok(differ, `★[${tag}] 开关 on/off 视觉状态不同（on=${on[0].bg}/${on[0].bgi} off=${off[0].bg}/${off[0].bgi}）`);
          if (mode === 'dark') {
            suite.ok(sameColor(off[0].bg, '#5A5A5E'),
              `★[dark] 关闭态轨道 = #5A5A5E（实测 ${off[0].bg}；旧值 #3A3A3C 对卡底仅 1.50，状态不可辨）`);
            suite.ok(sameColor(off[0].knobBg, '#F5F5F7'), `[dark] 圆钮 = #F5F5F7（实测 ${off[0].knobBg}）`);
            const offRgb = parseRgb(off[0].bg);
            const cr0 = normRgb(tr.appBg);
            const cardRgb = cr0 ? [cr0.r, cr0.g, cr0.b] : [0, 0, 0];
            if (offRgb) {
              const c = contrast([offRgb.r, offRgb.g, offRgb.b], cardRgb);
              suite.metric('darkToggleTrackVsApp', hx([offRgb.r, offRgb.g, offRgb.b]) + ' vs ' + tr.appBg + ' = ' + c.toFixed(2) + ':1');
              suite.ok(c >= 2.4, `[dark] 关闭态轨道对底 ≥2.4:1（实测 ${c.toFixed(2)}）`);
            }
          }
        }
      } else {
        suite.ok(false, `[${tag}] 读到 6 个开关（实测 ${tg && tg.rows ? tg.rows.length : 'n/a'}）`);
      }
    }

    /* --- C 对比度下限：像素法量真实底 --- */
    await goPage(win, 'today');
    await H.sleep(500);
    const pageOf = {
      '#page-today > .sec-title .st-em': 'today', '.tabbar .tab.on': 'today', '.cup-row .info': 'today',
      '.cup-row .mini-btn': 'today',
      '.stat-mini span': 'stat', '.heat-lb:not(.head)': 'stat', '.heat-day': 'stat', '.heat-date .heat-week': 'stat',
      '.memo-list-empty': 'memo',
      '.badge .bd': 'stat', '.badge .bn': 'stat', '.mood-pick .mn': 'today',
      '.mi-s': 'mine', '#page-mine .p-stat span': 'mine'
    };
    const byPage = {};
    for (const [sel] of FLOOR) {
      const p = pageOf[sel] || 'today';
      (byPage[p] = byPage[p] || []).push(sel);
    }
    for (const [page, sels] of Object.entries(byPage)) {
      await goPage(win, page);
      await H.sleep(650);
      const scale = (await win.webContents.capturePage()).getSize().width /
        (await H.evalJson(win, 'return {w:window.innerWidth};')).w;
      for (const sel of sels) {
        const idx = FLOOR.findIndex(f => f[0] === sel);
        const need = mode === 'light' ? FLOOR[idx][1] : FLOOR[idx][2];
        if (need === null || need === undefined) { results[tag + ' ' + sel + ' floor'] = 'SKIP(设计上不判浅色)'; continue; }
        /* 采样前把目标滚进视口（热力图横向滚动，第一格常在 x<0）。
           ★必须等滚动**停稳**：容器带 scroll-behavior:smooth，固定 sleep 在滚动距离大时
           仍在动画中途，随后读到的 rect 与像素不同帧 → 取到邻元素的底。
           实测踩坑：.mood-pick .mn 在 y=1143（视口外），滚到 y=460 后仍用旧帧像素，
           取到的是习惯卡色带上的白 10% 叠色 #96435B，误报「对比度 2.25 不合格」——
           真实底是心情卡自身的 #1C1C1E，实际 5.93:1。 */
        await H.evalJson(win, `
          var all=document.querySelectorAll(${JSON.stringify(sel)});
          for(var i=0;i<all.length;i++){
            var b=all[i].getBoundingClientRect();
            if(b.width<1||b.height<1) continue;
            if(b.left>=0&&b.top>=0&&b.right<=window.innerWidth&&b.bottom<=window.innerHeight) return {ok:true,idx:i,inVp:true};
            if(typeof all[i].scrollIntoView==='function'){ all[i].scrollIntoView({block:'center',inline:'center'}); return {ok:true,idx:i,scrolled:true}; }
            break;
          } return {ok:false};`);
        /* 轮询直到连续两次 rect 一致（停稳），最多 10 轮 × 220ms */
        let settled = null, prevRect = null;
        for (let t = 0; t < 10; t++) {
          settled = await H.evalJson(win, readCtrl(sel, 'color'));
          if (!settled || settled.miss) break;
          if (prevRect && prevRect.x === settled.rect.x && prevRect.y === settled.rect.y) break;
          prevRect = settled.rect;
          await H.sleep(220);
        }
        const info = settled;
        if (!info || info.miss) {
          results[tag + ' ' + sel + ' floor'] = 'MISS(' + ((info && info.why) || 'n/a') + ',n=' + ((info && info.n) || 0) + ')';
          suite.ok(false, `C[${tag}/${page}] ${sel} 不在 DOM（造景失败 → 对比度根本没测，不许静默跳过）`);
          continue;
        }
        /* ★同一帧：滚动停稳后**重新截图**，再用这次截图的 NativeImage 取底 */
        const snap = await shotPng(win);
        if (!snap || !snap.img) { results[tag + ' ' + sel + ' floor'] = 'NO-SHOT'; suite.ok(false, `C[${tag}/${page}] ${sel} 截图为空`); continue; }
        const nat = snap.img;
        const rect = { x: Math.round(info.rect.x * scale), y: Math.round(info.rect.y * scale), w: Math.round(info.rect.w * scale), h: Math.round(info.rect.h * scale) };
        const px = nativeImageToRgba(nat, rect);
        const bg = modalBg(px);
        const fg = parseRgb(info.v);
        if (!bg || !fg) { results[tag + ' ' + sel + ' floor'] = 'NO-PIXEL(bg=' + !!bg + ',fg=' + !!fg + ',inVp=' + info.inVp + ')'; continue; }
        const ratio = contrast([fg.r, fg.g, fg.b], bg);
        const key = `C[${tag}/${page}] ${sel}`;
        results[tag + ' ' + sel + ' floor'] = hx([fg.r, fg.g, fg.b]) + '@' + hx(bg) + '=' + ratio.toFixed(2);
        suite.ok(ratio >= need, `${key} 对比度 ≥${need}:1（实测 ${ratio.toFixed(2)}:1，字 ${hx([fg.r, fg.g, fg.b])} 底 ${hx(bg)}）`);
      }
    }

    /* --- E 截图 --- */
    await goPage(win, 'today');
    await H.sleep(500);
    const s = await shotPng(win);
    if (s && s.buf.length > 5000) {
      fs.writeFileSync(path.join(SHOT_DIR, 'r21-contrast-' + tag + '.png'), s.buf);
      results[tag + ' shotSize'] = s.buf.length;
    } else {
      suite.ok(false, `E[${tag}] 截图为空`);
    }
  }

  /* --- D 正负对照：同一套比较函数喂旧值必须判 FAIL --- */
  for (const [label, fg, bg, expect] of NEG) {
    const got = contrast(fg, bg);
    const isFail = got < 4.5;
    suite.ok(isFail, `D 正负对照「${label}」：${fg}@${bg} = ${got.toFixed(2)} 必须 <4.5（期望≈${expect}）`);
    suite.ok(Math.abs(got - expect) < 0.6, `D 对照值与算据一致：期望≈${expect} 实测 ${got.toFixed(2)}`);
  }

  /* --- E 深浅截图必须不同（防「切了主题但拿到上一帧」的假通过） --- */
  const lf = path.join(SHOT_DIR, 'r21-contrast-light.png');
  const df = path.join(SHOT_DIR, 'r21-contrast-dark.png');
  if (fs.existsSync(lf) && fs.existsSync(df)) {
    const a = fs.readFileSync(lf), b = fs.readFileSync(df);
    suite.ok(a.length !== b.length || !a.equals(b), 'E 深浅截图内容不同（未拿到同一帧）');
    suite.metric('shotBytes', 'light=' + a.length + ' dark=' + b.length);
  }

  suite.metric('r21Results', results);
  suite.metric('notMeasured', [
    '.heat-week 浅色 8.5px / .badge .bg-rem 9.5px：字号过小取不到字形像素，仅理论值',
    '锁定徽章 .badge.locked{opacity:.5}：探针口径未计入祖先 opacity',
    '未真正切 OS 系统主题（system 跟随通路未覆盖）',
    '仅 520x760 单视口 / dpr=1 / zoom=1',
    '未覆盖引导遮罩、确认框、toast、空数据态'
  ]);

  H.drainPageErrs(win, suite);
  H.finish(suite);
  try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
  try { process.exit(0); } catch (_) {}
}

app.whenReady().then(main).catch((e) => {
  suite.errs.push('套件异常: ' + ((e && e.message) || e));
  H.finish(suite);
  try { process.exit(1); } catch (_) {}
});
