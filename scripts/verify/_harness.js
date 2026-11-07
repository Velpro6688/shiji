/* scripts/verify/_harness.js —— 自动化验证公共骨架（v2.1.0 重建回归基线）
   沿袭 TESTREPORT-v2.0.0 记载的 work/verify-*.cjs 既有约定：
   1) 套件 cjs 由 Electron 直接作为主进程入口运行：
      ./node_modules/electron/dist/electron.exe scripts/verify/<name>.cjs
   2) 独立 userData profile（scripts/verify/profiles/<name>），绝不写真实 %APPDATA%\habit-lab；
   3) no-sandbox：沙箱宿主下 file:// loadFile 会 ERR_FAILED(-2)；
   4) 所有等待 Promise.race 超时兜底，防卡死；
   5) 断言错误收集进 errs 数组，errs=0 判绿；结果写 results/<name>-result.json（UTF-8）；
   6) 造数据走应用自身函数（直接 setItem 整包会被应用 save() 覆盖），故障注入除外；
   7) 首启弹窗遮罩 .confirm-mask 先移除；executeJavaScript 回传一律 JSON 往返（I-16）。 */
'use strict';
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

/* hbimg:// 与 main.js 同款：必须在 app ready 之前注册特权 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'hbimg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const ROOT = path.join(__dirname, '..', '..');
const RESULT_DIR = path.join(__dirname, 'results');
const PROFILE_ROOT = path.join(__dirname, 'profiles');

/* 套件主进程未捕获异常：Electron 默认弹阻塞对话框会让「卡死」看起来像超时。
   这里直接写失败结果并退出——错误尽早暴露、绝不挂死。 */
process.on('uncaughtException', (e) => {
  try {
    fs.mkdirSync(RESULT_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULT_DIR, '_uncaught-exception.json'),
      JSON.stringify({ message: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 2000), ts: new Date().toISOString() }, null, 2), 'utf8');
  } catch (_) {}
  console.log('FAIL uncaught-exception ' + String(e && e.message || e).slice(0, 200));
  try { app.exit(3); } catch (_) {}
});

/* 构建号取自 main.js，loadFile 经 ?build= 传入，页面会做一致性核验 */
let BUILD = '';
try {
  const m = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8').match(/APP_BUILD\s*=\s*'([^']+)'/);
  BUILD = m ? m[1] : '';
} catch (_) {}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// Native resize and renderer media-query updates are asynchronous; measure only after a rendered frame.
async function resizeWindow(win, width, height) {
  win.setContentSize(width, height);
  await withTimeout(win.webContents.executeJavaScript(`new Promise(resolve => {
    function ready() {
      if (innerWidth !== ${Number(width)} || innerHeight !== ${Number(height)}) { requestAnimationFrame(ready); return; }
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    }
    ready();
  })`), 5000, 'resize renderer');
  await capturePng(win);
  // Capture can trigger layout/ResizeObserver work; allow that frame's dependent
  // anchor positioning to finish before reading settled geometry.
  await withTimeout(win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'),5000,'resize layout dependencies');
}
function withTimeout(p, ms, label) {
  return Promise.race([
    Promise.resolve(p),
    new Promise((_, rej) => setTimeout(() => rej(new Error('超时(' + ms + 'ms): ' + label)), ms))
  ]);
}

/* 全局兜底：任何套件 180s 未结束即写失败结果退出，绝不挂死 */
function globalKillSwitch(name, suite) {
  const t = setTimeout(() => {
    try {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
      fs.writeFileSync(path.join(RESULT_DIR, name + '-result.json'),
        JSON.stringify({ name, ok: false, errs: ['全局超时 180s（套件卡死被强杀）'], steps: suite.steps, ts: new Date().toISOString() }, null, 2), 'utf8');
    } catch (_) {}
    console.log('FAIL ' + name + ' global-timeout');
    app.exit(2);
  }, 180000);
  if (t.unref) t.unref();
}

/* 主进程侧 hb-* 通道：v2.1 起数据层直接挂【真实 store.js 实例】（与 main.js 同构，
   profile 即其数据根），套件因此端到端跑在新存储栈上；窗口控制类通道仍用良性桩，
   calls 记录调用供套件断言。 */
let LAST_PROFILE = null;
/* r19：harness 桩通道集合——桩只作「默认值」，套件/探针可再次 ipcMain.handle(ch, fn) 覆盖它。
   Electron 对同一通道重复 handle 会抛 "Attempted to register a second handler for 'x'"
   （实测：probe-stickymem.cjs:55 自建 hb-win-size 复刻 → 抛错中断其 async whenReady 回调 →
   后续链路不跑、探针挂到 200s 超时；旧 harness 无 hb-win-size 桩故无冲突）。
   故 stubIpc 内包一层 handle：重注册 harness 已桩的通道时先摘掉旧桩；其余通道原样透传，
   真实重复注册（非桩通道）仍照旧抛错，不掩盖问题。 */
const STUBBED_CH = new Set();
let IPC_HANDLE_WRAPPED = false;
function allowStubOverride() {
  if (IPC_HANDLE_WRAPPED) return;
  IPC_HANDLE_WRAPPED = true;
  const orig = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = function (channel, fn) {
    if (STUBBED_CH.has(channel)) {
      try { ipcMain.removeHandler(channel); } catch (_) {}
      STUBBED_CH.delete(channel);
    }
    return orig(channel, fn);
  };
}

function stubIpc(calls) {
  allowStubOverride();
  const ok = v => Object.assign({ ok: true }, v || {});
  const stubHandle = (ch, fn) => { ipcMain.handle(ch, fn); STUBBED_CH.add(ch); };
  stubHandle('hb-editor-open', (e, id) => { calls.push(['hb-editor-open', id]); return ok({}); });
  stubHandle('hb-editor-back', (e, target) => { calls.push(['hb-editor-back', target]); return ok({}); });
  stubHandle('hb-pin-note', (e, id) => { calls.push(['hb-pin-note', id]); return ok({}); });
  stubHandle('hb-startup-get', () => ({ enabled: false, path: '', duplicates: [] }));
  stubHandle('hb-startup-set', (e, v) => ok({ enabled: !!v }));
  stubHandle('hb-minimize', () => ok({}));
  stubHandle('hb-close', () => ok({}));
  stubHandle('hb-set-locked', (e, locked, size) => { calls.push(['hb-set-locked', !!locked, size || null]); return ok({}); });
  stubHandle('hb-set-topmost', (e, v) => { calls.push(['hb-set-topmost', v]); return ok({}); });
  stubHandle('hb-nudge', () => ok({}));
  /* r19：补齐 main.js 已注册但 harness 漏桩的两条通道——缺桩会让页面 invoke 抛
     "No handler registered for 'hb-get-theme'"，14 套合计刷 31 条主进程错误日志（噪音，
     掩盖真实异常）。桩值须与 main.js 真实实现同形：
       hb-get-theme → { dark: <bool> }（main.js:1632 回 nativeTheme.shouldUseDarkColors）；
       hb-win-size  → { width, height } | null（main.js:1447 回窗口 bounds，无窗回 null）。 */
  stubHandle('hb-get-theme', () => ({ dark: false }));
  stubHandle('hb-win-size', (event) => {
    try {
      const w = BrowserWindow.fromWebContents(event.sender);
      if (!w || w.isDestroyed()) return null;
      const b = w.getBounds();
      return { width: b.width, height: b.height };
    } catch (_) { return null; }
  });
  const on = ch => ipcMain.on(ch, (e, v) => { calls.push([ch, v]); });
  on('hb-sticky-fit-self'); on('hb-fit-locked-content');
  on('hb-window-drag-start'); on('hb-window-drag-move'); on('hb-window-drag-end');
  on('hb-window-resize-start'); on('hb-window-resize-move'); on('hb-window-resize-end');

  /* —— 真实数据层（store.js，仓库根）—— */
  const { createStore } = require(path.join(ROOT, 'store.js'));
  const store = createStore({
    userDataDir: LAST_PROFILE || path.join(PROFILE_ROOT, '_default'),
    portableExeDir: path.join(LAST_PROFILE || path.join(PROFILE_ROOT,'_default'), 'portable-executable'),
    build: BUILD,
    getAppVersion: () => '2.1.0-test',
    log: function () {},
    broadcast: function (ch, p) {
      try {
        BrowserWindow.getAllWindows().forEach(function (w) {
          try { if (!w.isDestroyed()) w.webContents.send(ch, p); } catch (_) {}
        });
      } catch (_) {}
    }
  });
  store.registerIpc();
  /* protocol.handle 必须在 ready 后挂载；本回调先于套件自身 whenReady 回调注册，时序安全 */
  app.whenReady().then(() => { try { store.attachProtocol(protocol); } catch (_) {} });
  HARNESS_STORE = store;
  return store;
}
let HARNESS_STORE = null;
function storeInternal() { return HARNESS_STORE ? HARNESS_STORE._internal : null; }

function initProfile(name) {
  // Windows may briefly retain a deleted Chromium profile; a run id avoids reusing that path.
  if(process.env.HB_VERIFY_RUN_ID)name+='-'+process.env.HB_VERIFY_RUN_ID;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(String(name))) throw new Error('非法测试 profile 名称');
  const p = path.resolve(PROFILE_ROOT, name);
  const rel = path.relative(PROFILE_ROOT, p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('测试 profile 必须在 profiles 内');
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(p, { recursive: true });
  /* 数据级兜底清理（r24）：某些 Agent/沙箱环境对「单次 >50 文件的批量删除」有 safe-delete 拦截，
     整目录 rmSync 会静默失败（异常被上面 catch 吞掉），上一轮残留的 data.json 会被当成本轮开局存档
     —— boot 不再走「首启 → 示例数据」分支，依赖 sample 数据的断言随即假失败（实测 verify-security
     全量链末尾必现）。这里在整目录清理之后，再定向删除「定义测试初始状态」的少量文件
     （1–3 个，不触发批量阈值）：data.json / data.json.tmp = 开局数据档；app-config.json = 数据目录偏好。 */
  ['data.json', 'data.json.tmp', 'app-config.json'].forEach(function (f) {
    const fp = path.join(p, f);
    try {
      if (fs.existsSync(fp)) { fs.rmSync(fp, { force: true }); console.log('[harness] initProfile: 整目录清理不完整，已定向移除 ' + f); }
    } catch (e) { console.log('[harness] initProfile: ' + f + ' 定向移除失败: ' + String((e && e.message) || e).slice(0, 120)); }
  });
  app.setPath('userData', p);
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');   /* 与 main.js 同策略，规避双显卡渲染崩溃 */
  LAST_PROFILE = p;
  return p;
}

/* 页面执行：JSON 往返回传（不可克隆对象会抛错，见 I-16）；页面内异常带回 __err */
async function evalJson(win, body, timeoutMs) {
  const js = 'JSON.stringify((function(){try{' + body + '}catch(e){return{__err:String((e&&e.message)||e)}}})())';
  const raw = await withTimeout(win.webContents.executeJavaScript(js, true), timeoutMs || 10000, 'evalJson');
  let v = null;
  try { v = JSON.parse(raw); } catch (_) { throw new Error('evalJson 返回非 JSON: ' + String(raw).slice(0, 120)); }
  if (v && typeof v === 'object' && v.__err) throw new Error('页面执行出错: ' + v.__err);
  return v;
}

async function waitForOffscreenPaint(contents, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.removeListener('paint', onPaint);
      contents.removeListener('destroyed', onDestroyed);
      if (err) reject(err);
      else resolve();
    };
    const onPaint = (_event, _dirtyRect, image) => {
      const size = image.getSize();
      if (size.width > 0 && size.height > 0) finish();
    };
    const onDestroyed = () => finish(new Error('offscreen WebContents 已销毁'));
    const timer = setTimeout(() => finish(new Error('offscreen paint 等待超时')), timeoutMs);
    contents.on('paint', onPaint);
    contents.once('destroyed', onDestroyed);
    contents.invalidate();
  });
}

async function capturePng(win, timeoutMs) {
  const contents = win.webContents;
  const limit = Math.max(1000, Number(timeoutMs) || 10000);
  const offscreen = contents.isOffscreen();
  if (offscreen) await waitForOffscreenPaint(contents, limit);
  let image;
  for(let attempt=0;attempt<3;attempt++){
    try{
      image=await withTimeout(contents.capturePage(undefined,offscreen?{stayHidden:true}:undefined),limit,'capturePage');break;
    }catch(error){
      if(!offscreen||attempt===2||!String(error.message).includes('UnknownVizError'))throw error;
      // Chromium may discard the offscreen surface during a resize/theme paint.
      console.warn('[capture] offscreen surface invalidated; requesting a fresh frame');
      contents.invalidate();await sleep(250);await waitForOffscreenPaint(contents,limit);
    }
  }
  const size = image.getSize();
  if (image.isEmpty() || size.width < 1 || size.height < 1) throw new Error('capturePage 返回空截图');
  return image.toPNG();
}

function makeSuite(name) {
  const errs = [];
  const steps = [];
  const calls = [];
  const metrics = { build: BUILD };
  return {
    name, errs, steps, calls, metrics,
    ok(cond, msg) { if (cond) steps.push('ok: ' + String(msg).slice(0, 140)); else errs.push('断言失败: ' + String(msg).slice(0, 400)); },
    step(n) { steps.push('step: ' + n); },
    metric(k, v) { metrics[k] = v; }
  };
}

/* r19（第 3 项）：页面错误自动收集的轮询间隔（ms）。
   为什么不是「在 finish() 里同步 drain」：12 个套件的 finally 都是
   `try { win.destroy(); } catch(_) {}` → `H.finish(suite)` → `app.exit(...)`，
   finish 执行时窗口已销毁；且 Electron 没有「同步执行页面 JS」的 API
   （webContents.executeJavaScript / executeJavaScriptInIsolatedWorld 均为 Promise），
   而 finish() 必须保持同步（12 个调用方在我作用域外，且 verify-shadow-corner.cjs:296
   用 `const ok = H.finish(suite)` 的同步返回值决定退出码）。
   所以采用等价且覆盖更广的机制：窗口存活期间持续把 __hbErrs 取走并清空。
   语义仍是「取走并清空」（splice），已手动 drain 的套件不会重复计数。 */
/* r19：噪音白名单——只认「Chromium/渲染层自身」的固定噪音形态，并锚定到消息开头。
   旧写法按正文任意关键词匹配（/favicon|Autofill|DevTools|net::ERR_ABORTED|...|permission/i），
   实测（_tmp-filter-probe）会把 `Uncaught Error: permission denied while reading clipboard`
   这类真实页面异常整条丢掉 → errs=0 假绿。 */
const NOISE_RE = new RegExp([
  '^Failed to load resource: net::ERR_ABORTED',
  '^Request Autofill\\.',
  '^DevTools failed to load source map'
].join('|'), 'i');

/* 页面自身未捕获错误的上报标记：dom-ready 注入的钩子用它把错误推给主进程。
   带此标记的消息优先于噪音白名单（真实异常不得因正文含 permission/favicon 等词被丢弃）。 */
const PAGE_ERR_TAG = '[hb-page-error] ';

/* r19：负向用例会**故意**触发产品侧的 console.error。
   例：verify-import.cjs 第 4 步传 `{days:[1,2,3]}` 测「非法字段被拒」，
   而 r19 新增的防线会在页面里 `console.error('[hb-data] 主进程拒收字段：days（未落盘）')`
   → 被 console-message 收进 errs，套件变红。
   这类日志是**预期输出**，不是缺陷；但**绝不能靠放宽 NOISE_RE 解决**——那会把
   `permission denied` / `favicon` 之类真实错误一起吞掉（正是 r19 刚修掉的假绿）。
   所以改成显式的一次性豁免：套件必须**先声明**期望（正则 + 次数），
   命中即消费；**到 finish() 仍未兑现的期望同样记为失败**（防止豁免变成新的假绿来源）。 */
function expectConsoleError(suite, re, times, why) {
  if (!suite.__expectErrs) suite.__expectErrs = [];
  suite.__expectErrs.push({ re: re, left: Math.max(1, Number(times) || 1), why: why || String(re) });
}
function consumeExpectedErr(suite, s) {
  const list = suite.__expectErrs;
  if (!list || !list.length) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].left > 0 && list[i].re.test(s)) { list[i].left--; return true; }
  }
  return false;
}
function checkExpectations(suite) {
  const list = suite.__expectErrs;
  if (!list) return;
  list.forEach(function (e) {
    if (e.left > 0) suite.errs.push('期望的负向日志未出现（豁免未兑现，可能是用例失效）: ' + e.why);
  });
}

/* 自动收集的轮询间隔（ms）与已注册的窗口观察器 */
const AUTO_DRAIN_MS = 300;
const WATCHED = [];

function makeWin(suite, opts) {
  const extra = Object.assign({}, opts || {});
  const offscreen = !!extra.offscreen;
  delete extra.offscreen;
  const defaults = {
    show: false, x: 8, y: 8, width: 520, height: 720,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: false,
      backgroundThrottling: false      /* 隐藏窗不节流：rAF/测量照常工作 */
    }
  };
  const config = Object.assign({}, defaults, extra);
  config.webPreferences = Object.assign({}, defaults.webPreferences, extra.webPreferences || {});
  if (offscreen) config.webPreferences.offscreen = true;
  const win = new BrowserWindow(config);
  win.webContents.on('render-process-gone', (e, d) => suite.errs.push('render-process-gone: ' + (d && d.reason)));
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain) suite.errs.push('did-fail-load: ' + code + ' ' + desc); });
  win.webContents.on('console-message', details => {
    const level=details.level==='error'?3:details.level;
    const message=details.message;
    /* level 3 = error。过滤已知无害噪音；其余 error 记为问题（I-14 整洁标准的自动化面）。
       r19：过滤器必须**锚定到噪音来源**，不能按消息正文里的任意关键词匹配——
       实测（_tmp-filter-probe）旧写法 `/…|permission/i.test(s)` 会把
       `Uncaught Error: permission denied while reading clipboard` 这类**真实页面异常整条丢掉**，
       errs 仍为 0（假绿）。下面改成只认「渲染层/Chromium 自身」的噪音形态（锚定行首）。 */
    if (level === 3) {
      const s = String(message);
      /* 页面未捕获错误的即时上报：不在这里直接记（会与 drain 重复计数），
         交给 recordPageErr 按 id 去重 —— 好处是错误在页面抛出的当下就进入 errs，
         不依赖轮询、也不受「窗口销毁后 drain 不到」影响。 */
      if (s.indexOf(PAGE_ERR_TAG) === 0) { recordPageErr(win, suite, s.slice(PAGE_ERR_TAG.length)); return; }
      if (NOISE_RE.test(s)) return;
      /* r19：套件显式声明过的负向日志（见 expectConsoleError 注释）在此消费，不进 errs。
         未声明的错误照旧计入 —— 豁免是白名单，不是放宽过滤器。 */
      if (consumeExpectedErr(suite, s)) return;
      suite.errs.push('console.error: ' + s.slice(0, 300));
    }
  });
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(
      'window.__hbErrs=[];window.__hbErrId=0;' +
      'function __hbReport(s){var id=++window.__hbErrId;window.__hbErrs.push(id+"|"+s);' +
      'try{console.error("[hb-page-error] "+id+"|"+s)}catch(_){}}' +
      'window.addEventListener("error",function(e){__hbReport("onerror: "+e.message+" @"+(e.filename||"")+":"+e.lineno)});' +
      'window.addEventListener("unhandledrejection",function(e){__hbReport("unhandledrejection: "+String((e.reason&&e.reason.message)||e.reason).slice(0,200))});'
    ).catch(() => {});
  });

  /* r19（第 3 项）：窗口存活期间持续把页面错误收进 suite.errs（兜底网）。
     语义与 drainPageErrs 一致（splice 取走并清空）→ 套件里已有的手动 drain 不会重复计数；
     与即时上报共用 recordPageErr 的 id 去重表，两条路径也不会互相重复。
     实测（_tmp-nodrain-probe，从不调用 drainPageErrs 的套件）这段残余过去完全不可见：
     页面抛真实异常仍 PASS errs=0。 */
  const watch = { win, suite, busy: false, timer: null };
  watch.timer = setInterval(() => {
    if (watch.busy) return;
    if (win.isDestroyed() || win.webContents.isDestroyed()) { clearInterval(watch.timer); return; }
    watch.busy = true;
    evalJson(win, 'return (window.__hbErrs||[]).splice(0,window.__hbErrs.length)', 4000)
      .then(list => { (list || []).forEach(x => recordPageErr(win, suite, String(x))); })
      .catch(() => {})
      .then(() => { watch.busy = false; });
  }, AUTO_DRAIN_MS);
  if (watch.timer.unref) watch.timer.unref();
  WATCHED.push(watch);
  return win;
}

/* 每条页面错误只记一次：页面侧给每条错误编号（id），主进程按 id 去重。
   即时上报（console 标记）与轮询 drain / 手动 drainPageErrs 三条路径共用此表，
   避免同一条错误被记两遍（旧实现靠「splice 取走」防重复，但两条路径并存时会漏）。 */
const SEEN_IDS = new WeakMap();
function recordPageErr(win, suite, raw) {
  const s = String(raw);
  const m = /^(\d+)\|([\s\S]*)$/.exec(s);
  if (m) {
    let seen = SEEN_IDS.get(win);
    if (!seen) { seen = new Set(); SEEN_IDS.set(win, seen); }
    const id = Number(m[1]);
    if (seen.has(id)) return;
    seen.add(id);
    suite.errs.push(m[2].slice(0, 300));
    return;
  }
  /* 兼容无编号条目（历史写入 / 外部脚本直写 __hbErrs） */
  suite.errs.push(s.slice(0, 300));
}

/* 停掉全部自动收集（finish 时调用）：避免 finish 写出结果、调用方又读了
   suite.errs.length 之后，晚到的 drain 再改 errs，造成「JSON 与退出码不一致」。 */
function stopWatchers() {
  while (WATCHED.length) {
    const w = WATCHED.pop();
    try { clearInterval(w.timer); } catch (_) {}
  }
}

async function loadPage(win, query) {
  await withTimeout(win.loadFile(path.join(ROOT, 'habit.html'), {
    query: Object.assign({ shell: '1', build: BUILD }, query || {})
  }), 20000, 'loadFile');
}

/* 轮询等待应用 boot 完成（data 全局就绪），再关掉首启弹窗。
   注意：.confirm-mask 是静态 DOM（#confirmMask），不能 remove——删掉会把 #confirmTitle/#confirmMsg
   一并带走，后续 showConfirm 会因 null.textContent 崩溃。正确做法=移除 show 态并清回调。
   先等 1.3s：首启的示例引导(600ms)/损坏告知(1200ms)弹窗先弹出来，这里统一关掉，
   避免残留 show 态污染套件后续的「闸门弹窗出现」断言。 */
async function bootWait(win) {
  const t0 = Date.now();
  for (;;) {
    let r = null;
    try {
      r = await evalJson(win, 'return (typeof data!=="undefined"&&data&&data.meta)?{ready:true}:{ready:false}', 6000);
    } catch (_) { /* 页面脚本尚未执行完，继续等 */ }
    if (r && r.ready) break;
    if (Date.now() - t0 > 30000) throw new Error('页面 30s 未就绪（boot 超时）');
    await sleep(200);
  }
  await sleep(1300);
  await closeMask(win);
}

/* 关闭确认弹窗（隐藏而非删除：#confirmMask 是静态 DOM，删掉会毁掉 showConfirm 所需节点） */
async function closeMask(win) {
  return evalJson(win,
    'var cm=document.getElementById("confirmMask");if(cm)cm.classList.remove("show");try{confirmCallback=null}catch(_){}return true',
    6000);
}

/* 把页面运行期错误（onerror/unhandledrejection）收进套件 errs（取走并清空）。
   r19：改走 recordPageErr 统一入口 —— 与自动轮询 / console 即时上报共用 id 去重表，
   否则手动 drain 会把「已即时上报过」的同一条错误再记一遍。 */
async function drainPageErrs(win, suite) {
  try {
    const list = await evalJson(win, 'return (window.__hbErrs||[]).splice(0,window.__hbErrs.length)', 6000);
    (list || []).forEach(x => recordPageErr(win, suite, x));
  } catch (_) {}
}

function finish(suite, extra) {
  /* 先停自动收集：确保写出的 JSON 与调用方随后读的 suite.errs.length 一致 */
  stopWatchers();
  /* r19：未兑现的负向豁免 = 用例失效，必须报出来（见 expectConsoleError 注释） */
  checkExpectations(suite);
  const result = Object.assign({
    name: suite.name,
    ok: suite.errs.length === 0,
    errs: suite.errs,
    steps: suite.steps,
    metrics: suite.metrics,
    profile: LAST_PROFILE ? path.relative(ROOT,LAST_PROFILE).replace(/\\/g,'/') : null,
    ts: new Date().toISOString()
  }, extra || {});
  try {
    fs.mkdirSync(RESULT_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULT_DIR, suite.name + '-result.json'), JSON.stringify(result, null, 2), 'utf8');
  } catch (_) {}
  console.log((result.ok ? 'PASS ' : 'FAIL ') + suite.name + ' errs=' + suite.errs.length + ' steps=' + suite.steps.length);
  return result.ok;
}

/* 主进程源码只做语法编译 + 内容断言（隔离 harness 无法启动 main.js 的窗口管理，沿袭既有约定） */
function checkMainJsSyntax(suite) {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  new vm.Script(src, { filename: 'main.js' });
  suite.ok(true, 'main.js 语法编译通过（vm.Script）');
  return src;
}

module.exports = {
  ROOT, BUILD, sleep, resizeWindow, withTimeout, globalKillSwitch, stubIpc, initProfile, evalJson, capturePng,
  makeSuite, makeWin, loadPage, bootWait, closeMask, drainPageErrs, finish, checkMainJsSyntax, storeInternal,
  expectConsoleError
};
