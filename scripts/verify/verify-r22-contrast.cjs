'use strict';
/* scripts/verify/verify-r22-contrast.cjs
 * ============================================================================
 * r22 永久回归：深色「融合度」+ 便签可读性 + 顶栏头像圆角 + 庆祝横幅 + 选中文字
 *
 * 背景（用户第四轮反馈，附红圈截图）：
 *   ①「深色模式下，这些地方要么太突兀，要不然就字体看不清了
 *      1. 字体颜色太深，和背景的黑色混在一起看不清字体。」
 *   ②「Logo 那里，Logo 背景有一团黑，和色块颜色对比显得太突兀了，没有融合在一起。
 *       你白色背景的时候没有这么突兀。」
 *   ③「顶层 logo 那里，你截的是圆形的 logo，外面你还要给它一个方形的框」
 *
 * r21 的独立探针为什么漏掉这些（方法学，值得记住）：
 *   a) 它只做「逐文本节点 WCAG 扫描」+「深色亮岛扫描（背景亮度≥0.45 且≥240px²）」。
 *      **近黑块压在彩色封面上属于「暗」**，不会被亮岛规则命中 —— 但人眼看到的是
 *      「彩色块上一个黑洞」，突兀感来自【与承载色块的亮度落差】，不是绝对亮度。
 *   b) 它的 seed 数据里便签页是空态（.memo-list-empty），.mn-preview/.mn-date 从未被采样。
 *
 * 本套件六组断言：
 *   A 融合度（★核心）：深色 .hi（彩色封面上的图标底盒）对承载色带 .hh 的**亮度比**
 *       必须落在 [1.15, 1.60]（实测 1.302；r22 前 2.112；浅色基准 1.014）。
 *       这是「突兀」的可量化定义：越接近 1 越融合。用**像素法**量两处真实渲染色。
 *   B 顶栏：.tb-ava 的 border-radius 必须 50%（r22 前被深色层覆盖成 14px，
 *       而内部 img 仍是 50% → 圆头像外留方形暗角 = 用户 ③）。
 *   C 顶栏胶囊：深色 .app-brand / .tb-flame 必须是半透明白面（融合纯黑底），
 *       不能是近黑实心块。
 *   D 便签（★核心）：深色 .mn-preview/.mn-title 字色 #E8E8EC、.mn-date #B0B0B8 且
 *       opacity:1；四色纸像素底各不相同且非灰黑；正文/时间戳对比度 ≥4.5:1。
 *   E 庆祝横幅：深色 .cheer-tx 必须 ≥4.5:1（旧 #1B2A52 压在深色胶囊上仅 1.04）。
 *   F 正负对照：同一套比较函数喂「r22 之前的旧值」必须判 FAIL —— 自证断言非空转。
 *   G 深浅截图内容不同（防「切了主题但拿到上一帧」的假通过）。
 *
 * 运行（本机全局设了 ELECTRON_RUN_AS_NODE=1，会让 electron 退化成纯 Node 静默崩溃）：
 *   unset ELECTRON_RUN_AS_NODE
 *   rm -f scripts/verify/results/verify-r22-contrast-result.json
 *   ./node_modules/electron/dist/electron.exe scripts/verify/verify-r22-contrast.cjs
 * ============================================================================
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '_harness.js'));

/* ---------------------------------------------------------------- 设计真值 */
/* 深色七色带（r16/r20 设计值）—— 用于 A 组的理论护栏 */


/* A 组：融合度区间（亮度比）。
 * 深色：实测 1.258~1.302（r22 前 2.094~2.116）→ 门 [1.15, 1.60]。
 * 浅色：用户认可的基准。.hi 是 #F2F2F7 中性浅灰、色带是浅彩色纸，实测 1.014~1.070
 *       → 门 ≤1.15。**必须分开**：浅色本来就更平，套用深色区间会把它误判成失败
 *       （首版就是这样错了 3 条）。 */
const FUSE_MIN = 1.15, FUSE_MAX = 1.60;
const FUSE_LIGHT_MAX = 1.15;

/* D 组：深色便签设计真值 */
const MEMO_FG = { title: '#E8E8EC', preview: '#E8E8EC', date: '#B0B0B8' };

/* L 组：打卡按钮两态设计真值（ui-1）
   light：未打卡 --ui-surface-raised #F0F0F3；已打卡 --brand #0071E3
   dark ：未打卡 --tile #202023；已打卡 --brand #0071E3 */
const LIGHT_ON = '#0071E3';
const DARK_ON = '#0071E3';
const DARK_OFF = '#202023';
/* r22 的 sameColor/contrast 只接受 **hex**（内部走 hex2rgb）；
   实测值来自 computedStyle 是 'rgb(r, g, b)' → 必须先 normRgb 转数组再比。 */
const rgbOf = s => { const c = normRgb(s); return c ? [c.r, c.g, c.b] : null; };

/* F 组正负对照：[标签, 前景, 底, 期望比值, 比较器类型]
 *   'ratio-max'  = 该比值必须**超出** A 组区间上界（即旧的「突兀」值必须被判失败）
 *   'ratio-min'  = 该比值必须**低于** 4.5（即旧的低对比值必须被判失败） */
const NEG = [
  ['深 旧 .hi 白盒(近黑 #1C1C1E) 对色带 dow-4', '#1C1C1E', '#674B22', 2.112, 'ratio-max'],
  ['深 旧 .hi 白盒 对色带 dow-0', '#1C1C1E', '#5D4F1F', 2.110, 'ratio-max'],
  ['深 旧 .hi 白盒 对色带 dow-3', '#1C1C1E', '#5939AB', 2.105, 'ratio-max'],
  ['深 旧 便签正文 #3A4356 对灰黑卡 #2C2C2E', '#3A4356', '#2C2C2E', 1.41, 'ratio-min'],
  ['深 旧 便签时间戳 ≈#353C4A 对 #2C2C2E', '#353C4A', '#2C2C2E', 1.26, 'ratio-min'],
  ['深 旧 .cheer-tx #1B2A52 对深色胶囊 #212937', '#1B2A52', '#212937', 1.04, 'ratio-min']
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
/* CSS 自定义属性经 getPropertyValue 返回原始书写串（'#000000'），
   元素 computedColor 返回 'rgb(...)' —— 两者都要能比。 */
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
/* rgba 分量比较（用于半透明面：backgroundColor 会返回 'rgba(255, 255, 255, 0.1)'） */
function sameRgba(actual, r, g, b, a) {
  const p = parseRgb(actual);
  if (!p) return false;
  return p.r === r && p.g === g && p.b === b && Math.abs(p.a - a) < 0.02;
}
function hx(rgb) { return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(); }
/* 把 CSS 颜色（可含 alpha）合成到不透明底色上，返回 [r,g,b]。
   半透明面**不能**直接拿 r/g/b 去算对比度 —— alpha 不会进通道值，
   直接算会把 rgba(255,255,255,.07) 当成纯白（21:1 假通过/假失败）。 */
function compositeOver(cssColor, base) {
  const p = parseRgb(cssColor);
  if (!p) return null;
  const a = p.a;
  return [p.r * a + base[0] * (1 - a), p.g * a + base[1] * (1 - a), p.b * a + base[2] * (1 - a)];
}

/* ★造景：fresh profile 下 data.habits=0 / data.memoNotes=0，
   .hi / .hh / .mn-preview / .mn-date 这些选择器根本不存在 ——
   断言会以 MISS 静默跳过（等于没测）。按 verify-dark-palette.cjs 的 mkScene 套路
   造 3 个习惯（各带 icon → .hi 存在）+ 今天一条记录 + 4 条便签（四色纸齐全），
   再走应用自己的 syncHabits/streakCacheReset/resetViewDate/go/renderAll/renderMemoList 通路。 */
const SEED = [
  'var T=todayStr();var now=Date.now();',
  'data.habits=[',
  ' {key:"water",name:"\u559d\u6c34",icon:"\uD83D\uDCA7",type:"count",target:8,unit:"\u676f",color:"#7FA0B4",size:"wide",createdAt:now,archived:false},',
  ' {key:"sleep",name:"\u6309\u65f6\u7761\u89c9",icon:"\uD83D\uDE34",type:"bool",color:"#A794C0",size:"wide",createdAt:now,archived:false},',
  ' {key:"early",name:"\u65e9\u8d77",icon:"\uD83C\uDF05",type:"bool",color:"#D69B72",size:"wide",createdAt:now,archived:false},',
  /* 方卡：J 组要验「.hh 圆角 === .hi 圆角」在方卡下同样成立（方卡 .hi 是 34px/10px） */
  ' {key:"run",name:"\u8fd0\u52a8",icon:"\uD83C\uDFC3",type:"bool",color:"#6FA8DC",size:"square",createdAt:now,archived:false},',
  /* 方卡 + 已完成：L 组要验「已打卡」态的**方卡**按钮同样尺寸不变、配色同族
     （用户 m08573 同时点了打卡与已打卡两种按钮） */
  ' {key:"read",name:"\u9605\u8bfb",icon:"\uD83D\uDCD6",type:"bool",color:"#8FA8DC",size:"square",createdAt:now,archived:false}',
  '];',
  'data.days={};var day={};day.water=5;day.sleep=true;day.read=true;data.days[T]=day;',
  'if(!data.settings)data.settings={};data.settings.remindPerHabit=true;data.settings.remindSummary=true;data.settings.sound=true;',
  'data.memoNotes=[',
  ' {id:"n1",ts:now-1000*60*60*2,text:"\u4e0d\u662f\u7b49\u98ce\u6765\u624d\u51fa\u53d1\uff0c\u800c\u662f\u8d77\u98ce\u65f6\u5df2\u5728\u8def\u4e0a\u3002",html:"",ord:0},',
  ' {id:"n2",ts:now-1000*60*60*26,text:"\u5b66\u4e60\u7b14\u8bb0\uff1a\u590d\u4e60\u82f1\u8bed\u5355\u8bcd 30 \u4e2a\u3002",html:"",ord:1},',
  ' {id:"n3",ts:now-1000*60*60*50,text:"\u4e70\u83dc\u6e05\u5355\uff1a\u725b\u5976\u3001\u9762\u5305\u3001\u6c34\u679c\u3001\u9e21\u86cb\u3002",html:"",ord:2},',
  ' {id:"n4",ts:now-1000*60*60*74,text:"\u8fd0\u52a8\uff1a\u6162\u8dd1 3 \u516c\u91cc\uff0c\u62c9\u4f38 10 \u5206\u949f\u3002",html:"",ord:3}',
  '];',
  'syncHabits();streakCacheReset();resetViewDate();go("today");renderAll();',
  'go("memo");renderMemoList();renderAll();',
  'go("today");renderAll();',
  'return {habits:data.habits.length,notes:data.memoNotes.length,',
  '  cards:document.querySelectorAll("#checkinList .hcard").length,',
  '  his:document.querySelectorAll("#checkinList .hi").length,',
  '  hhs:document.querySelectorAll("#checkinList .hh").length,',
  '  notesDom:document.querySelectorAll(".memo-note").length};'
].join('');

/* ---------------------------------------------------------------- 套件 */
const suite = H.makeSuite('verify-r22-contrast');
H.globalKillSwitch(suite.name, suite);
H.initProfile('verify-r22-contrast');
H.stubIpc(suite.calls);
app.on('window-all-closed', () => {});
const SHOT_DIR = path.join(H.ROOT, 'scripts', 'verify', 'results');

/* ---- 页面侧助手（evalJson 自带 IIFE，body 必须裸 return） ---- */
const READ_TOKENS = `
  var cs=getComputedStyle(document.documentElement);
  return {dark:document.documentElement.classList.contains('dark'),
          appBg:getComputedStyle(document.getElementById('app')).backgroundColor};`;

/* 取「第一个完全落在视口内」的可见实例，返回 computed 值与视口矩形。
   （像素法采样必须落在截图里；视口外的元素 rect 无效） */
const readEl = (sel, props) => `
  var all=document.querySelectorAll(${JSON.stringify(sel)}),el=null,r=null,nz=0;
  var vw=window.innerWidth,vh=window.innerHeight;
  for(var i=0;i<all.length;i++){var b0=all[i].getBoundingClientRect();
    if(b0.width<1||b0.height<1) continue;
    nz++;
    if(b0.left>=0&&b0.top>=0&&b0.right<=vw&&b0.bottom<=vh){el=all[i];r=b0;break;}
    if(!el){el=all[i];r=b0;}}
  if(!el) return {miss:true, why:(all.length?(nz?'all-off-viewport-zero':'all-zero-rect'):'not-in-dom'), n:all.length};
  el.scrollIntoView({block:'center',inline:'center'});
  var b=el.getBoundingClientRect();
  var cs=getComputedStyle(el), out={n:all.length, inVp:(b.left>=0&&b.top>=0&&b.right<=vw&&b.bottom<=vh),
    rect:{x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}};
  ${JSON.stringify(props)}.forEach(function(p){ out[p]=cs.getPropertyValue(p.replace(/[A-Z]/g,function(m){return '-'+m.toLowerCase();})); });
  try{ var af=getComputedStyle(el,'::before');
    out.beforeBg=af.backgroundColor; out.beforeShadow=af.boxShadow; out.beforeW=af.width; }catch(_){}
  return out;`;

/* ::selection 在 Chromium 里不能通过 getComputedStyle(el,'::selection') 读，
   改为直接扫描样式表规则（内联 <style> 同源，cssRules 可读）。 */
const READ_SELECTION = `
  var found=[];
  for(var i=0;i<document.styleSheets.length;i++){
    var ss=document.styleSheets[i],rules=null;
    try{ rules=ss.cssRules; }catch(_){ continue; }
    if(!rules) continue;
    for(var j=0;j<rules.length;j++){
      var r=rules[j];
      if(r.selectorText && r.selectorText.indexOf('::selection')>=0){
        found.push({sel:r.selectorText, bg:r.style.backgroundColor||'', color:r.style.color||''});
      }
    }
  }
  return {found:found};`;

/* ---- 主题切换：必须轮询，不能固定 sleep（applyTheme 写变量是同步的，
       但 getComputedStyle 要等一次重绘；实测立即读仍是上一主题）---- */
async function setTheme(win, mode) {
  await H.evalJson(win, `if(typeof setThemeMode==='function')setThemeMode(${JSON.stringify(mode)});return 1;`);
  const wantDark = mode === 'dark';
  for (let i = 0; i < 45; i++) {
    const r = await H.evalJson(win, READ_TOKENS);
    if (r && r.dark === wantDark) {
      /* falsy-zero 陷阱：深色 --app-bg 恰是 rgb(0,0,0)，只能用正则判定 */
      const black = r.appBg === 'rgb(20, 20, 22)';
      const f2 = r.appBg === 'rgb(245, 245, 247)';
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
  for (let i = 0; i < 30; i++) {
    const r = await H.evalJson(win, `
      var p=document.getElementById('page-'+${JSON.stringify(tab)});
      return {on:!!(p&&(p.classList.contains('on')||p.classList.contains('active')||getComputedStyle(p).display!=='none'))};`);
    if (r && r.on) return true;
    await H.sleep(150);
  }
  return false;
}

/* ---- 像素法量真实渲染色 ---- */
async function shotPng(win) {
  for (let t = 0; t < 6; t++) {
    const img = await win.webContents.capturePage();
    const buf = img.toPNG();
    if (buf.length > 5000) return { buf, img };
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
/* 单点取色（(2k+1)² 中位数，抗锯齿/亚像素更稳）：img 为 capturePage 结果 */

/* 三通道最大差（比欧氏距离更直观：判「同色/异色」） */


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
/* 量一个选择器的真实渲染色。
 * ★两阶段取样（本套件首版的假失败根因）：
 *   ① 先 scrollIntoView 并**睡够**（页面若有 scroll-behavior:smooth 会动画）；
 *   ② 在**新的一轮**里重新读 rect + elementFromPoint 命中校验（确认裁的这块
 *      确实属于目标元素，而不是滚走后的别的卡片/别的主题帧）；
 *   ③ 只截一次图，裁剪区域与命中校验用的是同一帧的坐标。
 * 首版把「滚动 + 读 rect」放在同一轮、又截了第二帧，于是 4 张便签里 3 张
 * 量到了 #FFFFFF（别人的像素）—— 断言因此报出产品缺陷，实际产品是对的。 */
/* ★瞬时浮层清理：主题切换的「已切换：深色主题」toast 是 fixed 定位的，
   生命周期 2.2s。它盖在页面底部时会**顶掉 elementFromPoint**，
   让本该命中卡片的采样报 hit-test-failed（假产品缺陷）。
   它是瞬时提示、不属于被测布局，采样前移除是正当的。 */
const CLEAR_TOAST = `
  var t=document.querySelectorAll('.cheer'); for(var i=0;i<t.length;i++){ if(t[i].parentNode) t[i].parentNode.removeChild(t[i]); }
  return 1;`;

async function samplePx(win, sel, inset, props, idx) {
  /* ★整体重试：页面容器是 scroll-behavior:smooth，滚动/重排本身是竞态的，
     单次失败（not-in-viewport / hit-test-failed）先重试，不要直接判产品缺陷。
     重试 5 次：实测系统负载高时（同机并发跑其它 electron 套件后）3 次仍可能
     全部撞在「深色 transition + 滚动未停稳」上，报 hit-test-failed 假缺陷。 */
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await samplePxOnce(win, sel, inset, props, idx);
    if (!r || (!r.miss && !r.pxErr)) return r;
    if (r.miss && r.why === 'not-in-dom') return r;   /* DOM 里没有 = 真问题，重试无意义 */
    await H.sleep(500);
  }
  return await samplePxOnce(win, sel, inset, props, idx);
}

async function samplePxOnce(win, sel, inset, props, idx) {
  const i = idx || 0;
  await H.evalJson(win, CLEAR_TOAST);
  /* ---- 阶段 1：滚动 + 尺寸门 ----
     ★尺寸门：切页（goPage('memo')）后 .memo-note 可能已入 DOM 但仍是 0×0
     （页面容器 flex/display 尚未生效）。此时 scrollIntoView 无意义、后续
     rect 读到 {0,0,0,0}，elementFromPoint(0,0) 命中窗口角的 .lock-corner
     → 报 hit-test-failed 假缺陷（实测负载高时 D[light]/D[dark] 随机中招）。
     这里若读到 0 尺寸就返回 pxErr，交给 samplePx 的 5 次重试兜住。 */
  const s = await H.evalJson(win, `
    var all=document.querySelectorAll(${JSON.stringify(sel)});
    var el=all[${i}]; if(!el) return {miss:true,n:all.length};
    var b0=el.getBoundingClientRect();
    if(b0.width<1||b0.height<1) return {zero:true,n:all.length,w:Math.round(b0.width),h:Math.round(b0.height)};
    el.scrollIntoView({block:'center',inline:'center'});
    return {ok:true,n:all.length};`);
  if (!s || s.miss) return { miss: true, why: 'not-in-dom', n: (s && s.n) || 0 };
  if (s.zero) return { pxErr: 'zero-size', n: s.n, rect: { x: 0, y: 0, w: s.w, h: s.h } };
  await H.sleep(450);
  /* ---- 阶段 2：新的一轮里重读 rect + 命中校验 ----
     ★必须等滚动**停稳**再读 rect。页面容器带 scroll-behavior:smooth，
     450ms 固定等待在「滚动距离大」时会读到动画中途的坐标 ——
     于是 elementFromPoint 落到邻卡上，报 hit-test-failed（实测加第 4 个习惯后
     今天页变高、便签 idx1~3 全中此坑）。改为连续两次读数一致才认为停稳。 */
  const list = JSON.stringify(props || []);
  const READ = `
    var all=document.querySelectorAll(${JSON.stringify(sel)});
    var el=all[${i}]; if(!el) return {miss:true};
    var vw=window.innerWidth,vh=window.innerHeight;
    var b=el.getBoundingClientRect();
    var cx=Math.round(b.left+b.width/2), cy=Math.round(b.top+b.height/2);
    var hit=document.elementFromPoint(cx,cy);
    /* ★入场动画门：.page.active{animation:fadeUp .34s}（from{opacity:0}）
       在切页后 ~340ms 内把整页做淡入。若在动画中途截图，色带像素是
       「带色 × 卡底」的中间混合值 —— 实测读到过 #381F27（= #8B2E49 以 ~25%
       不透明度叠在 #1C1C1E 上），对不上任何设计色，会被误判成产品回归。
       只统计「作用在**本元素或其祖先链**上」的动画：页面里可能存在与本元素
       无关的常驻动画（脉冲、呼吸点），拿全文档计数会永远等不到停稳。 */
    var chain=[], q=el;
    while(q){ chain.push(q); q=q.parentElement; }
    var anims=[];
    if(document.getAnimations){
      var all2=document.getAnimations();
      for(var j=0;j<all2.length;j++){
        var a=all2[j]; if(a.playState!=='running') continue;
        var t=a.effect&&a.effect.target?a.effect.target:null;
        if(t&&chain.indexOf(t)>=0) anims.push(a);
      }
    }
    var out={n:all.length, inVp:(b.left>=0&&b.top>=0&&b.right<=vw&&b.bottom<=vh),
      rect:{x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)},
      vw:vw, vh:vh,
      anims:anims.length, pageAnims:anims.length,
      hitOk:!!(hit&&(hit===el||el.contains(hit))),
      hitTag:hit?(hit.tagName+'.'+String(hit.className||'').split(' ')[0]):null};
    var cs=getComputedStyle(el);
    ${list}.forEach(function(p){ out[p]=cs.getPropertyValue(p.replace(/[A-Z]/g,function(m){return '-'+m.toLowerCase();})); });
    return out;`;
  let info = null, prev = null;
  for (let t = 0; t < 14; t++) {
    info = await H.evalJson(win, READ);
    if (!info || info.miss) break;
    const settled = prev && prev.rect && info.rect &&
        prev.rect.x === info.rect.x && prev.rect.y === info.rect.y;
    /* 位置停稳 + 页面上没有仍在跑的动画（fadeUp / 主题切换过渡）才算稳 */
    if (settled && info.pageAnims === 0 && info.anims === 0) break;
    prev = info;
    await H.sleep(220);
  }
  if (!info || info.miss) return { miss: true, why: 'not-in-dom', n: (info && info.n) || 0 };
  if (info.pageAnims > 0 || info.anims > 0) {
    /* 动画没停下就不采样：宁可重试，也不要把中间帧当产品缺陷 */
    return Object.assign({}, info, { pxErr: 'anim-running' });
  }
  if (!info.inVp) return Object.assign({}, info, { pxErr: 'not-in-viewport' });
  if (!info.hitOk) return Object.assign({}, info, { pxErr: 'hit-test-failed' });
  /* ---- 阶段 3：截一次图，同一帧里裁矩形 + 算全帧众数 ---- */
  const snap = await shotPng(win);
  if (!snap) return Object.assign({}, info, { pxErr: 'shot-failed' });
  const img = snap.img;
  const k = inset == null ? 2 : inset;
  const r = { x: info.rect.x + k, y: info.rect.y + k, w: Math.max(1, info.rect.w - 2 * k), h: Math.max(1, info.rect.h - 2 * k) };
  const m = modalBg(nativeImageToRgba(img, r));
  info.px = m;
  info.pxHex = m ? hx(m) : null;
  /* 全帧众数：用于区分「裁错区域」与「拿到别的主题的帧」 */
  const size = img.getSize();
  info.frameHex = hx(modalBg(nativeImageToRgba(img, { x: 0, y: 0, w: size.width, h: size.height })) || [0, 0, 0]);
  return info;
}
function fuseRatio(hiPx, bandPx) {
  if (!hiPx || !bandPx) return null;
  const la = lum(hiPx), lb = lum(bandPx);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ================================================================ 主流程 */
async function main() {
  const win = H.makeWin(suite, { show: true, width: 520, height: 760 });
  await H.loadPage(win);
  await H.bootWait(win);
  await H.sleep(1400);

  /* 隐藏引导/确认遮罩（只隐藏，绝不能 remove：#confirmMask 是静态 DOM） */
  await H.evalJson(win, `
    var g=document.getElementById('guideMask'); if(g) g.style.display='none';
    var cm=document.getElementById('confirmMask'); if(cm) cm.classList.remove('show');
    return 1;`);

  /* ★造景（A/D 组选择器必须真实存在，否则 MISS 静默跳过 = 假通过） */
  const seeded = await H.evalJson(win, SEED);
  suite.metric('seeded', JSON.stringify(seeded));
  suite.ok(!!(seeded && seeded.habits >= 5 && seeded.his >= 5 && seeded.hhs >= 5 && seeded.notesDom >= 4),
    '造景：habits=' + (seeded && seeded.habits) + ' his=' + (seeded && seeded.his) +
    ' hhs=' + (seeded && seeded.hhs) + ' notes=' + (seeded && seeded.notesDom));
  await H.sleep(900);

  const results = {};
  const fuseByMode = {};

  for (const mode of ['light', 'dark']) {
    const tag = mode;
    const tr = await setTheme(win, mode);
    suite.ok(!!tr, `${tag}：主题切换落地（轮询到 --app-bg 与类名一致）`);
    if (!tr) continue;

    /* ---------- A 融合度：.hi 对 .hh 亮度比 ---------- */
    await goPage(win, 'today');
    await H.sleep(650);
    /* 三天各测一次（走真实日期导航，覆盖不同星期色带） */
    const dayResults = [];
    for (let d = 0; d < 3; d++) {
      if (d > 0) {
        await H.evalJson(win, `if(typeof shiftViewDate==='function')shiftViewDate(-1);return 1;`);
        await H.sleep(750);
      }
      const band = await samplePx(win, '#checkinList .hh', 2, ['backgroundColor']);
      const box = await samplePx(win, '#checkinList .hi', 2, ['backgroundColor']);
      if (band.miss || box.miss) {
        suite.ok(false, `A[${tag}/d${d}] .hh/.hi 不在 DOM（band=${band.miss ? band.why : 'ok'} box=${box.miss ? box.why : 'ok'}）`);
        continue;
      }
      const rt = fuseRatio(box.px, band.px);
      /* 该帧实际显示的星期（用 .hh 的像素底反查设计色，容差放宽到最近邻） */
      const dow = await H.evalJson(win, `
        var c=document.getElementById('checkinList');
        if(!c) return {cls:null};
        var m=/(dow-[0-6])/.exec(c.className); return {cls:m?m[1]:null};`);
      const row = { dow: dow && dow.cls, bandPx: band.pxHex, hiPx: box.pxHex, ratio: rt == null ? null : +rt.toFixed(3) };
      dayResults.push(row);
      results[`${tag} .hiVsBand d${d}`] = JSON.stringify(row);
      if (rt == null) { suite.ok(false, `A[${tag}/d${d}] 像素采样失败（band=${band.pxHex} hi=${box.pxHex}）`); continue; }
      /* 深色：融合度必须落在区间内（既不能突兀，也不能糊成一团看不出是图标盒）；
         浅色：只需 ≤ 上限（它是用户认可的基准，本来就更平）。 */
      if (mode === 'dark') {
        suite.ok(rt >= FUSE_MIN && rt <= FUSE_MAX,
          `A[dark/d${d}] .hi 对色带亮度比 ∈[${FUSE_MIN},${FUSE_MAX}]（实测 ${rt.toFixed(3)}；带 ${band.pxHex} 盒 ${box.pxHex}${row.dow ? ' ' + row.dow : ''}）`);
      } else {
        suite.ok(rt <= FUSE_LIGHT_MAX,
          `A[light/d${d}] .hi 对色带亮度比 ≤${FUSE_LIGHT_MAX}（实测 ${rt.toFixed(3)}；带 ${band.pxHex} 盒 ${box.pxHex}${row.dow ? ' ' + row.dow : ''}）`);
      }
      /* 深色下 .hi 的 computed 底色必须是半透明白（不是近黑实心块） */
      if (mode === 'dark') {
        suite.ok(sameRgba(box.backgroundColor, 255, 255, 255, 0.1),
          `A[dark/d${d}] .hi 底色 = rgba(255,255,255,0.1)（实测 ${box.backgroundColor}；旧值 #1C1C1E 即「一团黑」）`);
      }
    }
    /* 回到今天 */
    await H.evalJson(win, `if(typeof resetViewDate==='function')resetViewDate();return 1;`);
    await H.sleep(650);
    fuseByMode[mode] = dayResults;

    /* 浅色是用户认可的基准：必须比深色更「平」（比值更接近 1） */
    if (mode === 'light' && dayResults.length && dayResults[0].ratio != null) {
      suite.ok(dayResults[0].ratio <= 1.15, `A[light] 浅色基准 .hiVsBand ≤1.15（实测 ${dayResults[0].ratio}）`);
    }

    /* ---------- I 卡内「近黑块」家族：拖拽手柄 + 计数格 ----------
       用户红圈还圈了 .habit-sort（8 点阵拖拽手柄）与 .cup（喝水计数格）。
       它们和 .hi 同病：深色下是 #1C1C1E 近黑实心块压在彩色封面上。
       判据同 A 组：融合度（对承载色带的亮度比）必须落进区间。 */
    {
      /* ★必须选**空**计数格：.cup 是「格子」，.cup.full 里的 .fill 是实心蓝填充
         （实测 filled 格 px=#1886FF 亮度 0.245 —— 那是设计色不是缺陷）。
         用户红圈圈的是压在彩带上的**空格子**底色发黑。 */
      for (const [name, sel] of [['habit-sort', '#checkinList .habit-sort'], ['cup', '#checkinList .cup:not(.full)']]) {
        const el = await samplePx(win, sel, 1, ['backgroundColor'], 0);
        if (el.miss || !el.px) { suite.ok(false, `I[${tag}] ${name} 采样失败（${el.miss ? el.why : el.pxErr}）`); continue; }
        results[`${tag} ${name}`] = el.pxHex + ' bg=' + el.backgroundColor;
        if (mode === 'dark') {
          /* .habit-sort 底 rgba(255,255,255,.10)（r23 起与 .hi 图标盒同参数）；
             .cup 底 rgba(255,255,255,.08) */
          const want = name === 'habit-sort' ? 0.10 : 0.08;
          suite.ok(sameRgba(el.backgroundColor, 255, 255, 255, want),
            `I[dark] .${name} 底 = rgba(255,255,255,${want})（实测 ${el.backgroundColor}；旧值 #1C1C1E 即红圈里的「一团黑」）`);
          const band = await samplePx(win, '#checkinList .hh', 2, ['backgroundColor'], 0);
          if (!band.miss && band.px) {
            const rt = fuseRatio(el.px, band.px);
            results[`${tag} ${name} vs band`] = rt == null ? null : +rt.toFixed(3);
            suite.ok(rt != null && rt <= FUSE_MAX,
              `I[dark] .${name} 对色带亮度比 ≤${FUSE_MAX}（实测 ${rt == null ? 'n/a' : rt.toFixed(3)}；盒 ${el.pxHex} 带 ${band.pxHex}）`);
          }
        } else {
          /* 浅色不变式：仍是浅色面（不能是深块） */
          const l = lum(el.px);
          suite.ok(l >= 0.45, `I[light] .${name} 仍是浅色面（实测 ${el.pxHex} 亮度 ${l.toFixed(3)}）`);
        }
      }
    }

    /* ---------- J 卡头彩带 .hh 的圆角必须贴合 .hi 图标盒 ----------
       用户 m07295：「图中画圈那里其实可以，特别是左边可以换成圆弧角贴合图标
       logo 一样的圆弧角就不会显得那么突兀，突出来两个角了」
       取证（scripts/verify/_dbg-timerhh.cjs，520x720/dpr1）：
         .hh 四角 computed 全 0px（直角矩形），.hi = 13px、卡片 = 14px；
         .hh 横向铺满卡内容宽（x 31..467，卡 16..482，insetL/R=15、insetT=17）。
       于是彩带的方角紧贴卡片圆角弧 → 用户看到的「突出来两个角」。
       判据：.hh 四角圆角必须 === .hi 圆角（宽卡 13px / 方卡 10px）且 >0。 */
    {
      const geo = await H.evalJson(win, `
        var out={wide:null,square:null};
        function one(card){
          if(!card) return null;
          var hh=card.querySelector('.hh'), hi=card.querySelector('.hi');
          if(!hh||!hi) return {miss:true};
          var hs=getComputedStyle(hh), is=getComputedStyle(hi), cs=getComputedStyle(card);
          var hr=hh.getBoundingClientRect(), cr=card.getBoundingClientRect();
          return {hhTL:hs.borderTopLeftRadius,hhTR:hs.borderTopRightRadius,
                  hhBL:hs.borderBottomLeftRadius,hhBR:hs.borderBottomRightRadius,
                  hiTL:is.borderTopLeftRadius,cardTL:cs.borderTopLeftRadius,
                  hhH:+hr.height.toFixed(1),hhW:+hr.width.toFixed(1),
                  insetL:+(hr.left-cr.left).toFixed(1),insetR:+(cr.right-hr.right).toFixed(1)};
        }
        var cards=document.querySelectorAll('#checkinList .hcard');
        for(var i=0;i<cards.length;i++){
          if(cards[i].classList.contains('square')){ if(!out.square) out.square=one(cards[i]); }
          else if(!out.wide) out.wide=one(cards[i]);
        }
        return out;`);
      results[`${tag} J radii`] = JSON.stringify(geo);
      const num = s => parseFloat(String(s || '0')) || 0;
      for (const [kind, g] of [['wide', geo && geo.wide], ['square', geo && geo.square]]) {
        if (!g || g.miss) { suite.ok(false, `J[${tag}] ${kind} 卡 .hh/.hi 不在 DOM（造景缺 ${kind} 卡？）`); continue; }
        suite.ok(num(g.hiTL) > 0, `J[${tag}] ${kind} 卡 .hi 图标盒圆角 >0（实测 ${g.hiTL}）`);
        suite.ok(num(g.cardTL) > 0, `J[${tag}] ${kind} 卡自身圆角 >0（实测 ${g.cardTL}）`);
      }
      /* ★ui-1 设计变更（本组已按新设计真值更新）：
         星期彩色色带已退出卡片主视觉 —— 这正是用户「颜色区分和黑色不配」的解法。
         旧断言是「.hh 色带四角必须与 .hi 同圆角 + 色带角被圆角切掉」；色带取消后该前提不复存在
         （旧断言若保留，只会锁死一个已经不该存在的视觉元素）。
         等价的新护栏：.hh 必须**无可绘制表面**（透明底 + 无渐变），彩色色带不得回归。
         同口径见 verify-dark-palette 的 D 组；旧套件存档于 results/_backup-verify-dark-palette-r20.cjs。 */
      const hhPaint = await H.evalJson(win, `var hh=document.querySelector('#checkinList .hh');if(!hh)return {miss:true};
        var cs=getComputedStyle(hh);
        return {bg:cs.backgroundColor,bgi:String(cs.backgroundImage).slice(0,60),radius:cs.borderTopLeftRadius};`);
      results[`${tag} J hhPaint`] = JSON.stringify(hhPaint);
      suite.ok(!hhPaint.miss && /rgba\(0, 0, 0, 0\)|transparent/.test(String(hhPaint.bg)) && hhPaint.bgi === 'none',
        `J[${tag}] .hh 无可绘制表面（彩色色带不得回归；实测 bg=${hhPaint.bg} bgi=${hhPaint.bgi}）`);
    }

    /* ---------- K 卡头小标 .hstreak + 拖拽手柄 .habit-sort 的「融合度」 ----------
       用户 m08050：「最上面那个红圈那里统计的打卡天数颜色不对没融合进这个颜色，
       太突兀了。下面的全是那个移动条，也没融合到那个色卡里，再微调一下」
       取证（_dbg-r23.cjs 几何+像素 / _dbg-r23c.cjs 三档 6x 裁剪 bake-off）：
        ① .hstreak 底来自 habit.html:914 var(--accent-t)，深色 = #1C2A3A 深藏青，
           对周五玫红带 #8B2E49 亮度比 1.793 且四角 0px 直角 → 硬边深块压彩带；
        ② .habit-sort 的真因是**几何**：habit.html:1392 方卡 right:10px 让手柄右缘
           越过 .hh 色带右缘 3px（实测 4/4 方卡全中），那 3px 压在近黑卡底上，
           同一块半透明白呈现两个色 —— 只调颜色永远修不掉。
       判据：小标 = 白.10 半透明圆角胶囊 + 白字（与 .hi 图标盒同参数）；
             手柄 = 白.10 无边环 + 方卡 right:14px 消溢出（溢出必须 ≤0）。 */
    {
      /* ★K 组只判「样式」，不判「导航状态」：A 组会把 viewDate 翻到过去三天，
         若复位不彻底，今天没完成的习惯会让 .hstreak 全是 .zero（n=0 假失败）。
         这里显式复位到今天 + 重置 streak 缓存，保证取样前提确定。 */
      await H.evalJson(win, `if(typeof resetViewDate==='function')resetViewDate();
        if(typeof streakCacheReset==='function')streakCacheReset();
        if(typeof go==='function')go('today');
        if(typeof renderAll==='function')renderAll();
        return 1;`);
      await H.sleep(700);
      const navState = await H.evalJson(win, `
        return {viewDate:(typeof viewDate!=='undefined'?viewDate:null),today:(typeof todayStr==='function'?todayStr():null),
          nStreak:document.querySelectorAll('#checkinList .hstreak:not(.zero)').length,
          nZero:document.querySelectorAll('#checkinList .hstreak.zero').length};`);
      results[`${tag} K navState`] = JSON.stringify(navState);
      /* 小标（有连续天数的那张宽卡）：底/字色/圆角 + 文字对比 */
      const st = await H.evalJson(win, `
        var all=document.querySelectorAll('#checkinList .hstreak:not(.zero)'), el=null;
        for(var i=0;i<all.length;i++){var b=all[i].getBoundingClientRect(); if(b.width>4&&b.height>4){el=all[i];break;}}
        if(!el) return {miss:true,n:all.length};
        var cs=getComputedStyle(el), b=el.getBoundingClientRect();
        return {n:all.length,bg:cs.backgroundColor,color:cs.color,radius:cs.borderTopLeftRadius,
          padL:cs.paddingLeft,fontSize:cs.fontSize,txt:el.textContent,
          rect:{x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}};`);
      if (!st || st.miss) {
        suite.ok(false, `K[${tag}] .hstreak:not(.zero) 不在 DOM（造景缺「有连续天数」的宽卡？n=${st && st.n}）`);
      } else {
        results[`${tag} K streak`] = `${st.bg} color=${st.color} r=${st.radius} ${JSON.stringify(st.rect)}`;
        suite.ok(st.radius === '7px',
          `K[${tag}] .hstreak 圆角 = 7px（实测 ${st.radius}；旧值 0px 直角 = 用户「太突兀了」）`);
        if (mode === 'dark') {
          suite.ok(sameRgba(st.bg, 255, 255, 255, 0.10),
            `K[dark] .hstreak 底 = rgba(255,255,255,0.10)（实测 ${st.bg}；旧值 var(--accent-t)=#1C2A3A 深藏青实心块压在彩带上）`);
          suite.ok(sameColor(st.color, '#FFFFFF'),
            `K[dark] .hstreak 字色 = #FFFFFF（实测 ${st.color}；沿用 --text-brand #5AC8FA 对彩带只有 3.24~3.39，不过 AA）`);
        }
        /* 文字对比：白字 vs 白.10 叠色带的**合成底**（alpha 不进通道值，必须合成） */
        const band = await samplePx(win, '#checkinList .hh', 2, ['backgroundColor']);
        if (!band.miss && band.px) {
          const base = mode === 'dark' ? st.bg : st.bg; /* 小标自身底色（半透明） */
          const eff = compositeOver(base, band.px) || band.px;
          const fg = normRgb(st.color);
          if (fg) {
            const c = contrast([fg.r, fg.g, fg.b], eff.map(Math.round));
            results[`${tag} K streak contrast`] = c.toFixed(2) + ':1 @' + hx(eff.map(Math.round));
            if (mode === 'dark') {
              suite.ok(c >= 4.5,
                `K[dark] .hstreak 文字对比 ≥4.5:1（实测 ${c.toFixed(2)}:1；字 ${st.color} 底 ${hx(eff.map(Math.round))}）`);
            }
          }
        }
      }

      /* ★空态回归护栏：无连续天数时 .hstreak.zero 内部两个插值都为空，
         元素本应 0×0。若深色规则漏写 :not(.zero)，padding:2px 7px 会把它
         撑成一个 14×4 的**空胶囊**（我在落盘时真的写出过这个回归，探针抓到）。 */
      const zero = await H.evalJson(win, `
        var el=document.querySelector('#checkinList .hstreak.zero');
        if(!el) return {miss:true};
        var b=el.getBoundingClientRect(), cs=getComputedStyle(el);
        return {w:+b.width.toFixed(1),h:+b.height.toFixed(1),padL:cs.paddingLeft,bg:cs.backgroundColor,txt:el.textContent};`);
      if (!zero || zero.miss) {
        suite.ok(false, `K[${tag}] .hstreak.zero 不在 DOM（造景缺「未完成」的宽卡？）`);
      } else {
        results[`${tag} K streak.zero`] = `${zero.w}×${zero.h} padL=${zero.padL} bg=${zero.bg}`;
        suite.ok(zero.w === 0 && zero.h === 0,
          `K[${tag}] .hstreak.zero 空态必须 0×0（实测 ${zero.w}×${zero.h}；深色规则漏 :not(.zero) 时 padding 会撑出空白胶囊）`);
      }

      /* 拖拽手柄：底 + 方卡右缘不得溢出彩带 */
      const hdl = await H.evalJson(win, `
        var out={wide:null,square:null};
        var cards=document.querySelectorAll('#checkinList .hcard');
        for(var i=0;i<cards.length;i++){
          var c=cards[i], s=c.querySelector('.habit-sort'), hh=c.querySelector('.hh');
          if(!s||!hh) continue;
          var cs=getComputedStyle(s), sb=s.getBoundingClientRect(), hb=hh.getBoundingClientRect();
          var rec={bg:cs.backgroundColor,border:cs.borderTopColor,
            overflowR:Math.round((sb.right-hb.right)*10)/10,
            sortW:Math.round(sb.width),hhW:Math.round(hb.width)};
          if(c.classList.contains('square')){ if(!out.square) out.square=rec; }
          else if(!out.wide) out.wide=rec;
        }
        return out;`);
      for (const [kind, h] of [['wide', hdl && hdl.wide], ['square', hdl && hdl.square]]) {
        if (!h) { suite.ok(false, `K[${tag}] ${kind} 卡 .habit-sort/.hh 不在 DOM`); continue; }
        results[`${tag} K handle ${kind}`] = `bg=${h.bg} overflowR=${h.overflowR}`;
        if (mode === 'dark') {
          suite.ok(sameRgba(h.bg, 255, 255, 255, 0.10),
            `K[dark] ${kind} 卡 .habit-sort 底 = rgba(255,255,255,0.10)（实测 ${h.bg}；与 .hi 图标盒同参数）`);
        }
        /* ★溢出判据：手柄右缘必须落在色带内（>0 即有 3px 压在近黑卡底上 = 用户「没融合」） */
        suite.ok(h.overflowR <= 0,
          `K[${tag}] ${kind} 卡手柄右缘不溢出彩带（实测 ${h.overflowR}px；>0 时那块压在卡底上，同一块半透明白呈现两个色 = 用户「没融合到那个色卡里」）`);
      }
    }

    /* ---------- L 打卡 / 已打卡按钮：配色必须与卡内控件族同族，几何不动 ----------
       用户 m08573：「打卡按钮也是太突兀了，右边边缘沿着色卡边缘融合进去，
                   打卡、已打卡按钮大小不变，变颜色就行」
       取证（_dbg-r24.cjs 七档 bake-off，520×720 useContentSize，周五玫红带 #8B2E49）：
         几何**早已对齐**：方卡 pillOverflowR=0 / pillOverflowL=0（右缘与 .hh 右缘齐平）、
         position:static、width:100%（=== 色带宽 207）、height:40px、radius:999px
         → 一律不改（用户明确要求「大小不变」）。
         「太突兀」的真因是**配色**：修前未打卡 = --tile #2C2C2E 近黑实底 + #3A3A3C 亮边
         （对色带亮度比 1.715），已打卡 = 饱和实心蓝渐变 #0E6FD9→#0A63C8（对色带 1.575）；
         而同一张卡上的 .hi 图标盒 / .habit-sort 手柄都是「白.10 半透明」→ 按钮不属于这张卡。
         修后（Q2 胜出）：未打卡 rgba(255,255,255,.10) —— 与 .hi/.habit-sort **逐参数相同**；
                         已打卡 rgba(10,132,255,.34) —— 保留「蓝=已完成」语义但不再是饱和实心块。
       判据：① 两模式按钮右缘都不得溢出彩带（用户「沿着色卡边缘融合进去」）；
             ② 深色两态底色逐参数锁定 + 无渐变/无描边/无阴影 + 白字对比 ≥4.5；
             ③ 浅色零改动护栏：未打卡仍是浅色面、已打卡渐变每个 stop 对白字 ≥4.5。 */
    {
      await samplePx(win, '#checkinList .hh', 2, ['backgroundColor']);
      const pills = await H.evalJson(win, `
        var out=[];
        var cards=document.querySelectorAll('#checkinList .hcard');
        for(var i=0;i<cards.length;i++){
          var c=cards[i], p=c.querySelector('.big-btn.check-pill'), hh=c.querySelector('.hh');
          if(!p||!hh) continue;
          var cs=getComputedStyle(p), pb=p.getBoundingClientRect(), hb=hh.getBoundingClientRect();
          out.push({key:c.getAttribute('data-habit-key'),square:c.classList.contains('square'),
            on:p.classList.contains('on'),disabled:!!p.disabled,
            bg:cs.backgroundColor,bgi:cs.backgroundImage,color:cs.color,
            border:cs.borderTopColor,shadow:cs.boxShadow,radius:cs.borderTopLeftRadius,
            w:Math.round(pb.width),h:Math.round(pb.height),hhW:Math.round(hb.width),
            overflowR:Math.round((pb.right-hb.right)*10)/10,
            overflowL:Math.round((pb.left-hb.left)*10)/10,
            txt:(p.textContent||'').trim()});
        }
        return {pills:out};`);
      const list = (pills && pills.pills) || [];
      results[`${tag} L pills`] = list.map(p => p.key + (p.on ? '.on' : '') + ' ' + p.bg +
        ' r=' + p.radius + ' ' + p.w + 'x' + p.h + ' oR=' + p.overflowR + ' oL=' + p.overflowL).join(' | ');
      suite.ok(list.length >= 2,
        `L[${tag}] 取到打卡按钮实例 ≥2（实测 ${list.length}；造景缺 bool 习惯？）`);
      const seen = { off: false, on: false };
      for (const p of list) {
        if (p.on) seen.on = true; else seen.off = true;
        /* ① 几何：右缘沿色带边缘（不溢出）、左缘不越界、方卡尺寸不变 */
        suite.ok(p.overflowR <= 0,
          `L[${tag}] ${p.key}${p.on ? '.on' : ''} 按钮右缘不溢出彩带（实测 ${p.overflowR}px；>0 时那几 px 压在卡底上 = 用户「右边边缘沿着色卡边缘融合进去」）`);
        /* ★overflowL 的符号约定：按钮左缘**相对色带左缘**的偏移。
           方卡 = 0（通栏）；宽卡是贴右上角的窄胶囊，左缘必然在色带**内侧**
           （实测 sleep/early +337.8/+360）→ 不变式是「≥0」，不是「≤0」。
           （首版写成 ≤0，把宽卡右对齐的正常布局误判成 4 条失败。） */
        suite.ok(p.overflowL >= 0,
          `L[${tag}] ${p.key}${p.on ? '.on' : ''} 按钮左缘落在彩带内侧（实测 ${p.overflowL}px；<0 表示按钮探出色带左缘）`);
        if (p.square) {
          suite.ok(p.w === p.hhW && p.h === 40,
            `L[${tag}] ${p.key}${p.on ? '.on' : ''} 方卡按钮尺寸不变（实测 ${p.w}×${p.h}；设计 = 色带宽 ${p.hhW} × 40px，用户要求「大小不变」）`);
        }
        if (mode === 'dark') {
          /* ★ui-1 新设计真值：未打卡 = --tile #202023（深色中性面，白字 14.9:1）；
             已打卡 = --brand #0071E3（白字 4.70:1）。两态**必须不同色** ——
             旧 cascade（html.dark .big-btn (0,2,1) !important）会把两者压成同色，
             完成态在深色下不可辨，本组即为该回归的护栏。 */
          if (p.on) {
            suite.ok(sameColor(p.bg, DARK_ON),
              `L[dark] ${p.key}.on 按钮底 = ${DARK_ON}（--brand；实测 ${p.bg}）`);
            suite.ok(sameColor(p.color, '#FFFFFF'),
              `L[dark] ${p.key}.on 字色 = #FFFFFF（实测 ${p.color}）`);
            const c = contrast([255, 255, 255], rgbOf(p.bg));
            results[`${tag} L ${p.key} txt`] = c == null ? null : c.toFixed(2) + ':1 @' + p.bg;
            suite.ok(c !== null && c >= 4.5,
              `L[dark] ${p.key}.on 白字对按钮底 ≥4.5:1（实测 ${c === null ? '?' : c.toFixed(2)}:1 @${p.bg}）`);
          } else {
            suite.ok(sameColor(p.bg, DARK_OFF),
              `L[dark] ${p.key} 未打卡按钮底 = ${DARK_OFF}（--tile 深色；实测 ${p.bg}）`);
            const c = contrast(rgbOf(p.color), rgbOf(p.bg));
            results[`${tag} L ${p.key} txt`] = c == null ? null : c.toFixed(2) + ':1 @' + p.bg;
            suite.ok(c !== null && c >= 4.5,
              `L[dark] ${p.key} 未打卡字色对按钮底 ≥4.5:1（实测 ${c === null ? '?' : c.toFixed(2)}:1 字=${p.color} 底=${p.bg}）`);
          }
          suite.ok(p.bgi === 'none',
            `L[dark] ${p.key}${p.on ? '.on' : ''} 无渐变（实测 ${String(p.bgi).slice(0, 60)}）`);
          suite.ok(p.shadow === 'none',
            `L[dark] ${p.key}${p.on ? '.on' : ''} 无阴影（实测 ${p.shadow}）`);
        } else if (!p.on) {
          /* 浅色零改动护栏：未打卡仍是浅色面（不能变成深块） */
          const b = parseRgb(p.bg);
          const l = b ? lum([b.r, b.g, b.b]) : null;
          suite.ok(l != null && l >= 0.6,
            `L[light] ${p.key} 未打卡仍是浅色面（实测 ${p.bg}${l == null ? '' : ' 亮度 ' + l.toFixed(3)}）`);
        } else {
          /* 浅色已打卡：ui-1 起为**实心品牌蓝**（不再是渐变），白字必须 ≥4.5:1 */
          suite.ok(sameColor(p.bg, LIGHT_ON),
            `L[light] ${p.key}.on 按钮底 = 品牌蓝 ${LIGHT_ON}（实测 ${p.bg}；ui-1 起为实心蓝，不再是渐变）`);
          const c = contrast([255, 255, 255], rgbOf(p.bg));
          results[`${tag} L ${p.key} txt`] = c == null ? null : c.toFixed(2) + ':1 @' + p.bg;
          suite.ok(c !== null && c >= 4.5,
            `L[light] ${p.key}.on 白字对按钮底 ≥4.5:1（实测 ${c === null ? '?' : c.toFixed(2)}:1 @${p.bg}）`);
        }
      }
      /* ★完成态与未打卡态必须**可辨**（本轮实测回归：旧 cascade 让深色两态同色） */
      {
        const onP = list.find(x => x.on), offP = list.find(x => !x.on);
        if (onP && offP) {
          suite.ok(onP.bg !== offP.bg,
            `L[${tag}] 完成态与未打卡态底色可辨（on=${onP.bg} off=${offP.bg}；同色即回归）`);
        }
      }
      /* 两态都必须被测到（否则「只测了未打卡」会静默通过） */
      suite.ok(seen.off && seen.on,
        `L[${tag}] 未打卡与已打卡两种状态都被覆盖（实测 off=${seen.off} on=${seen.on}；造景需含「已完成」与「未完成」的 bool 习惯）`);
    }

    /* ---------- B 顶栏头像圆角 ---------- */
    {
      const ava = await H.evalJson(win, readEl('#tbAva', ['borderRadius', 'backgroundColor']));
      if (ava && !ava.miss) {
        results[`${tag} #tbAva borderRadius`] = ava.borderRadius;
        suite.ok(ava.borderRadius === '50%',
          `B[${tag}] #tbAva border-radius = 50%（实测 ${ava.borderRadius}；旧值 14px → 圆头像外露方形暗角）`);
        if (mode === 'dark') {
          suite.ok(sameRgba(ava.backgroundColor, 255, 255, 255, 0.1),
            `B[dark] #tbAva 底 = rgba(255,255,255,0.1)（实测 ${ava.backgroundColor}）`);
        }
      } else {
        suite.ok(false, `B[${tag}] #tbAva 不在 DOM（${ava && ava.why}）`);
      }
      /* 内部圆形图必须同样是 50%（两者不一致才会露暗角） */
      const img = await H.evalJson(win, readEl('#tbAva img', ['borderRadius']));
      if (img && !img.miss) {
        results[`${tag} #tbAva img borderRadius`] = img.borderRadius;
        suite.ok(img.borderRadius === '50%', `B[${tag}] #tbAva img border-radius = 50%（实测 ${img.borderRadius}）`);
      }
    }

    /* ---------- C 顶栏两个胶囊：深色必须是半透明白面 ---------- */
    for (const [name, sel] of [['app-brand', '.app-brand'], ['tb-flame', '.tb-flame']]) {
      const el = await H.evalJson(win, readEl(sel, ['backgroundColor', 'backgroundImage', 'borderTopColor']));
      if (!el || el.miss) { suite.ok(false, `C[${tag}] ${name} 不在 DOM（${el && el.why}）`); continue; }
      results[`${tag} ${name} bg`] = el.backgroundColor;
      /* ★半透明必须先在承载底上合成再算对比度。
         首版直接拿 rgba(255,255,255,.07) 的三个通道当实色算，得到 21:1 假失败 —— 
         CSS 的 alpha 不会进 r/g/b，必须自己按 alpha 合成。 */
      const base = mode === 'dark' ? [0, 0, 0] : [242, 242, 247]; /* 深色 = 纯黑底；浅色 = 顶栏浅灰 */
      const eff = compositeOver(el.backgroundColor, base);
      if (mode === 'dark') {
        suite.ok(sameRgba(el.backgroundColor, 255, 255, 255, 0.07),
          `C[dark] .${name} 底 = rgba(255,255,255,0.07)（实测 ${el.backgroundColor}；旧值 #1C1C1E 即「和纯黑底不融合」）`);
        if (eff) {
          const r = contrast(eff, [0, 0, 0]);
          suite.metric(`dark ${name} vs 纯黑`, r.toFixed(3) + ':1 @' + hx(eff.map(Math.round)));
          suite.ok(r >= 1.05 && r <= 1.35,
            `C[dark] .${name} 合成后对纯黑底 1.05~1.35:1（实测 ${r.toFixed(3)}:1 @${hx(eff.map(Math.round))}）`);
        }
      } else {
        /* 浅色不变式：这两个胶囊是「浅色面」，不能是深块。
           （不要求具体是渐变：实测 .app-brand 是透明继承顶栏、.tb-flame 是纯白实底，
             两者都合理 —— 首版写死「必须渐变」是错的。） */
        if (eff) {
          const l = lum(eff);
          suite.ok(l >= 0.6, `C[light] .${name} 合成后仍是浅色面（实测 ${hx(eff.map(Math.round))} 亮度 ${l.toFixed(3)}）`);
        }
      }
    }

    /* ---------- D 便签：字色 + 四色纸 + 对比度 ---------- */
    /* 切页后等 1000ms：.page.active 的 fadeUp(.34s) + scroll-behavior:smooth 滚动
       都未停稳时采样会报 hit-test-failed（系统负载高时 750ms 不够）。 */
    await goPage(win, 'memo');
    await H.sleep(1000);
    for (const [key, sel] of [['title', '.memo-note .mn-title'], ['preview', '.memo-note .mn-preview'], ['date', '.memo-note .mn-date']]) {
      const el = await H.evalJson(win, readEl(sel, ['color', 'opacity', 'fontSize']));
      if (!el || el.miss) { suite.ok(false, `D[${tag}] ${sel} 不在 DOM（${el && el.why}）`); continue; }
      results[`${tag} ${sel} color`] = el.color + ' opacity=' + el.opacity;
      if (mode === 'dark') {
        suite.ok(sameColor(el.color, MEMO_FG[key]),
          `D[dark] ${sel} 字色 = ${MEMO_FG[key]}（实测 ${el.color}；旧值 #3A4356 压在灰黑卡上即「看不清」）`);
        if (key === 'date') {
          suite.ok(String(el.opacity) === '1',
            `D[dark] ${sel} opacity = 1（实测 ${el.opacity}；旧值 0.85 让时间戳进一步变淡）`);
        }
      }
    }
    /* 四色纸逐张像素采样：必须各不相同、且都不是灰黑（R≈G≈B） */
    {
      const papers = [];
      for (let i = 0; i < 4; i++) {
        const r = await samplePx(win, '.memo-note', 6, ['backgroundImage'], i);
        if (r.miss || !r.px) {
          papers.push({ cls: 'idx' + i, px: null, hex: null, err: r.miss ? r.why : r.pxErr });
          continue;
        }
        /* 用 computed backgroundImage 里的全部 rgb() 反查这是哪张色纸。
           ★注意：四色纸是**渐变**（如 linear-gradient(170deg,#FFF9C9,#FFF27E)），
           众数像素必然落在两个 stop 之间 —— 只跟第一个 stop 比会误判
           （首版就因此把 #FFF6A8 判成「不同族」）。改为比对渐变的**通道包络**。 */
        const stops = [...String(r.backgroundImage || '').matchAll(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)]
          .map(m => [+m[1], +m[2], +m[3]]);
        const env = stops.length ? [0, 1, 2].map(c => ({
          lo: Math.min(...stops.map(s => s[c])),
          hi: Math.max(...stops.map(s => s[c]))
        })) : null;
        papers.push({
          cls: 'idx' + i, px: r.px, hex: r.pxHex, frameHex: r.frameHex,
          env: env,
          bgi: (r.backgroundImage || '').slice(0, 70)
        });
      }
      results[`${tag} memo papers`] = papers.map(p => p.hex
        ? (p.cls + '=' + p.hex + (p.env ? '(css ' + p.env.map(e => e.lo + '~' + e.hi).join('/') + ')' : ''))
        : (p.cls + '=' + (p.err || 'null'))).join(' | ');
      const valid = papers.filter(p => p && p.px);
      suite.ok(valid.length >= 3, `D[${tag}] 便签四色纸取到 ≥3 张（实测 ${valid.length}；${papers.map(p => p.cls + ':' + (p.err || p.hex)).join(' ')}）`);
      /* 像素值必须落在该卡 CSS 渐变声明的通道包络内（防「裁到别人的像素」——
         首版就是拿白底当纸底，量出 #FFFFFF）。容差 26 覆盖抗锯齿与圆角阴影。 */
      for (const p of valid) {
        if (!p.env) continue;
        const bad = [0, 1, 2].map(c => Math.max(0, p.env[c].lo - 26 - p.px[c], p.px[c] - (p.env[c].hi + 26)));
        const worst = Math.max(...bad);
        suite.ok(worst === 0,
          `D[${tag}] ${p.cls} 像素 ${p.hex} 落在 CSS 渐变包络内（越界 ${worst}，各通道 ${p.env.map(e => e.lo + '~' + e.hi).join('/')}）`);
      }
      if (mode === 'dark') {
        /* 四张纸必须两两不同（r22 前全被 !important 压成同一个 #2C2C2E） */
        const uniq = new Set(valid.map(p => p.hex));
        suite.ok(uniq.size >= Math.min(3, valid.length),
          `D[dark] 四色纸各不相同（实测 ${uniq.size} 种：${[...uniq].join(',')}；旧值全被压成 #2C2C2E 单一灰）`);
        /* 每张纸必须有色相（max-min 通道差 ≥6），不是中性灰 */
        for (const p of valid) {
          const spread = Math.max(p.px[0], p.px[1], p.px[2]) - Math.min(p.px[0], p.px[1], p.px[2]);
          suite.ok(spread >= 6, `D[dark] 便签纸 ${p.cls} 保留色相（实测 ${p.hex} 通道差 ${spread}）`);
        }
        /* 正文/时间戳对真实纸底的对比度 ≥4.5 */
        const fgT = parseRgb((await H.evalJson(win, readEl('.memo-note .mn-preview', ['color']))).color);
        const fgD = parseRgb((await H.evalJson(win, readEl('.memo-note .mn-date', ['color']))).color);
        for (const p of valid) {
          if (fgT) {
            const r1 = contrast([fgT.r, fgT.g, fgT.b], p.px);
            results[`dark preview@${p.cls}`] = r1.toFixed(2) + '@' + p.hex;
            suite.ok(r1 >= 4.5, `D[dark] 正文 @ ${p.cls}(${p.hex}) ≥4.5:1（实测 ${r1.toFixed(2)}:1）`);
          }
          if (fgD) {
            const r2 = contrast([fgD.r, fgD.g, fgD.b], p.px);
            results[`dark date@${p.cls}`] = r2.toFixed(2) + '@' + p.hex;
            suite.ok(r2 >= 4.5, `D[dark] 时间戳 @ ${p.cls}(${p.hex}) ≥4.5:1（实测 ${r2.toFixed(2)}:1）`);
          }
        }
      } else {
        /* 浅色是用户认可的基准：四色纸必须仍是明亮的彩色纸（亮度 ≥0.5） */
        for (const p of valid) {
          const l = lum(p.px);
          suite.ok(l >= 0.5, `D[light] 便签纸 ${p.cls} 仍是亮色纸（实测 ${p.hex} 亮度 ${l.toFixed(3)}）`);
        }
      }
    }

    /* ---------- E 庆祝横幅（调用产品自身的 showCheer） ---------- */
    {
      await goPage(win, 'today');
      await H.sleep(500);
      const ok = await H.evalJson(win, `
        if(typeof showCheer!=='function')return {miss:true};
        showCheer('测试庆祝文案','✅');return {ok:true};`);
      if (ok && ok.ok) {
        await H.sleep(200);
        const c = await H.evalJson(win, `
          var el=document.querySelector('.cheer'), tx=document.querySelector('.cheer .cheer-tx');
          if(!el||!tx)return {miss:true};
          var cs=getComputedStyle(el), ts=getComputedStyle(tx);
          return {bg:cs.backgroundColor, fg:ts.color, fs:ts.fontSize};`);
        if (c && !c.miss) {
          results[`${tag} cheer`] = c.bg + ' / ' + c.fg;
          const bgp = parseRgb(c.bg), fgp = parseRgb(c.fg);
          /* 胶囊是半透明的，按纯黑底（深色）／白底（浅色）合成后算对比度 */
          const base = mode === 'dark' ? [0, 0, 0] : [255, 255, 255];
          if (bgp && fgp) {
            const a = bgp.a;
            const comp = [bgp.r * a + base[0] * (1 - a), bgp.g * a + base[1] * (1 - a), bgp.b * a + base[2] * (1 - a)];
            const r = contrast([fgp.r, fgp.g, fgp.b], comp);
            results[`${tag} cheer ratio`] = r.toFixed(2) + ' @' + hx(comp.map(Math.round));
            suite.ok(r >= 4.5, `E[${tag}] .cheer-tx 对比度 ≥4.5:1（实测 ${r.toFixed(2)}:1，字 ${hx([fgp.r, fgp.g, fgp.b])} 底 ${hx(comp.map(Math.round))}）`);
            if (mode === 'dark') {
              suite.ok(sameColor(c.fg, '#E7EBF3'),
                `E[dark] .cheer-tx = #E7EBF3（实测 ${c.fg}；旧值 #1B2A52 对深色胶囊仅 1.04:1）`);
            }
          }
        } else {
          suite.ok(false, `E[${tag}] .cheer 未渲染出来（showCheer 调用了但 DOM 里没有）`);
        }
        await H.evalJson(win, `var el=document.querySelector('.cheer');if(el)el.remove();return 1;`);
      } else {
        suite.ok(false, `E[${tag}] showCheer 不是函数（产品接口变了？）`);
      }
    }

    /* ---------- H 选中文字：::selection 规则必须存在且深色可读 ---------- */
    {
      const s = await H.evalJson(win, READ_SELECTION);
      const list = (s && s.found) || [];
      const darkRule = list.find(x => /html\.dark/.test(x.sel));
      results[`${tag} ::selection rules`] = JSON.stringify(list.map(x => x.sel));
      if (mode === 'dark') {
        suite.ok(!!darkRule, `H[dark] 存在 html.dark ::selection 规则（实测 ${list.length} 条：${list.map(x => x.sel).join(' / ')}）`);
        if (darkRule) {
          const fg = parseRgb(darkRule.color), bg = parseRgb(darkRule.bg);
          suite.ok(sameColor(darkRule.color, '#FFFFFF'), `H[dark] ::selection 字色 = #FFFFFF（实测 ${darkRule.color}；旧值 #0A1B3D 不可读）`);
          if (fg && bg) {
            const a = bg.a;
            const comp = [bg.r * a, bg.g * a, bg.b * a]; /* 叠纯黑 */
            const r = contrast([fg.r, fg.g, fg.b], comp);
            results['dark ::selection ratio'] = r.toFixed(2) + ' @' + hx(comp.map(Math.round));
            suite.ok(r >= 4.5, `H[dark] ::selection 对比度 ≥4.5:1（实测 ${r.toFixed(2)}:1）`);
          }
        }
      } else {
        suite.ok(list.length >= 1, `H[light] 存在 ::selection 规则（实测 ${list.length} 条）`);
      }
    }

    /* ---------- 截图 ---------- */
    await goPage(win, 'today');
    await H.sleep(600);
    const s = await shotPng(win);
    if (s && s.buf.length > 5000) {
      fs.writeFileSync(path.join(SHOT_DIR, 'r22-contrast-' + tag + '.png'), s.buf);
      results[`${tag} shotBytes`] = s.buf.length;
    } else {
      suite.ok(false, `截图[${tag}] 为空`);
    }
    await goPage(win, 'memo');
    await H.sleep(600);
    const s2 = await shotPng(win);
    if (s2 && s2.buf.length > 5000) {
      fs.writeFileSync(path.join(SHOT_DIR, 'r22-contrast-' + tag + '-memo.png'), s2.buf);
    }
  }

  /* ---------- F 正负对照：同一套比较函数喂旧值必须判 FAIL ---------- */
  for (const [label, fg, bg, expect, kind] of NEG) {
    const got = contrast(fg, bg);
    if (kind === 'ratio-max') {
      /* 旧的「突兀」值必须超出 A 组上界（即被 A 组判失败） */
      const rejected = got > FUSE_MAX;
      suite.ok(rejected, `F 正负对照「${label}」：${fg}@${bg} = ${got.toFixed(3)} 必须 >${FUSE_MAX}（A 组会判 FAIL）`);
    } else {
      const rejected = got < 4.5;
      suite.ok(rejected, `F 正负对照「${label}」：${fg}@${bg} = ${got.toFixed(2)} 必须 <4.5（对比度门会判 FAIL）`);
    }
    suite.ok(Math.abs(got - expect) < 0.6, `F 对照值与算据一致「${label}」：期望≈${expect} 实测 ${got.toFixed(3)}`);
  }
  /* 反向自证：新的「融合」值必须落在 A 组区间内（否则 A 组门形同虚设） */
  {
    const r = contrast('#765D38', '#674B22');
    suite.ok(r >= FUSE_MIN && r <= FUSE_MAX, `F 反向自证：新 .hi 叠色带 ${r.toFixed(3)} 必须落在 A 组区间 [${FUSE_MIN},${FUSE_MAX}]`);
  }

  /* ---------- G 深浅截图内容不同（防「切了主题但拿到上一帧」） ---------- */
  const lf = path.join(SHOT_DIR, 'r22-contrast-light.png');
  const df = path.join(SHOT_DIR, 'r22-contrast-dark.png');
  if (fs.existsSync(lf) && fs.existsSync(df)) {
    const a = fs.readFileSync(lf), b = fs.readFileSync(df);
    suite.ok(a.length !== b.length || !a.equals(b), 'G 深浅截图内容不同（未拿到同一帧）');
    suite.metric('shotBytes', 'light=' + a.length + ' dark=' + b.length);
  }

  suite.metric('fuseByMode', JSON.stringify(fuseByMode));
  suite.metric('r22Results', results);
  suite.metric('notMeasured', [
    '未真正切 OS 系统主题（system 跟随通路未覆盖）',
    '仅 520x760 单视口 / dpr=1 / zoom=1；未覆盖 1280 宽窗',
    '.hcard.square 方卡拖拽手柄的 8 点阵（本造景全 wide 卡）',
    '未覆盖引导遮罩、确认框、toast、空数据态',
    '便签「四色纸」的像素底受卡片圆角/阴影边缘影响，已用 inset=6px 规避'
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
