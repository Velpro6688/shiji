// HabitCheck · 无边框便签壳 (Electron main process)
// 加载本地 habit.html?view=memo&shell=1，使用 frame:false 真正无系统标题栏
// 窗口控制：页面自绘按钮经 preload (window.hbShell) → IPC 到这里


const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, protocol, nativeTheme, Notification, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
/* 开机自启的纯判定（去引号比较 / 该不该写注册表 / 显式关闭优先）单独可测，见 startup-decide.js */
const { sameExePath, decideStartupWrite, decideWantEnabled, isEphemeralExe } = require('./startup-decide.js');

// userData 固定为 %APPDATA%\habit-lab：package.json 加 productName（中文名）后
// Electron 默认会把 userData 切到 %APPDATA%\时迹，导致老用户打卡数据"消失"。
// 这里显式钉死旧路径，productName 只影响 confirm 弹窗标题等显示层，不影响数据目录。
app.setPath('userData', path.join(app.getPath('appData'), 'habit-lab'));



const DEV_ENV_OK = !app.isPackaged;



if (DEV_ENV_OK && process.env.HB_USERDATA) {
  try { app.setPath('userData', process.env.HB_USERDATA); } catch (_) {}
}

// Windows 通知需要应用归属，否则页面里的 new Notification() 可能被系统静默丢弃
// （设置里的「提醒」看似开着却从不弹）。ID 与 package.json 的 appId 保持一致。
if (process.platform === 'win32') app.setAppUserModelId('com.habitlab.desktop');

// hbimg:// 自定义协议：便签图片落盘文件（<数据根>/images/<id>.<ext>）的渲染通道。
 
// 无法加载、裁剪的 canvas 会被跨源污染；protocol.handle 由 store.attachProtocol 在 ready 后挂载。
protocol.registerSchemesAsPrivileged([
  { scheme: 'hbimg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
const LOG_FILE = path.join(app.getPath('userData'), 'app.log');


let logTrimPending = false;
function log(msg){
  try{
    /* 消息里可能带渲染层可控内容（例如便签 id、页面标题）：
       压掉换行防止伪造日志行，并限长避免单条撑爆文件。 */
    const safe=String(msg).replace(/[\r\n]+/g,' ').slice(0,500);
    const line='['+new Date().toISOString()+'] '+safe+'\n';
    fs.appendFile(LOG_FILE,line,function(){});
    if(!logTrimPending){
      logTrimPending=true;
      fs.stat(LOG_FILE,function(e,st){
        logTrimPending=false;
        try{
          if(!e && st && st.size>1024*1024){
            fs.readFile(LOG_FILE,'utf8',function(e2,content){
              if(!e2) fs.writeFile(LOG_FILE,content.slice(content.length/2),function(){});
            });
          }
        }catch(_){ }
      });
    }
  }catch(_){ }
}


const GEOM_TRACE_ON = (() => {
  try {
    return (DEV_ENV_OK && process.env.HB_GEOM_TRACE === '1')
      || fs.existsSync(path.join(app.getPath('userData'), 'geom-trace.flag'));
  } catch (_) { return false; }
})();
let geomTraceN = 0;


const NUDGE_OFF = DEV_ENV_OK && process.env.HB_NO_NUDGE === '1';
let nudgeOffLogged = false;



const NUDGE_COOLDOWN_MS = 1200;
let nudgeCooldownUntil = 0;
function nudgeGateOpen() { return Date.now() >= nudgeCooldownUntil; }
function nudgeArmGate() { nudgeCooldownUntil = Date.now() + NUDGE_COOLDOWN_MS; }





function clampXYIntoScreen(x, y, width, height) {
  try {
    const db = screen.getDisplayMatching({x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)}).bounds;
    const M = 8;   /* ≥8px：与微移贴边跳过阈值一致，彻底离开 DWM 隐形边框重算带 */
    return {
      x: Math.round(Math.max(db.x + M - width, Math.min(db.x + db.width - M, x))),
      y: Math.round(Math.max(db.y + M - height, Math.min(db.y + db.height - M, y)))
    };
  } catch (_) { return { x: Math.round(x), y: Math.round(y) }; }
}
function b0w(w){ try{ return w.getBounds().width }catch(_){ return 400 } }
function b0h(w){ try{ return w.getBounds().height }catch(_){ return 600 } }

/* ★ v2.2.2 拖动冻结基准的【可信尺寸缓存】（probe-dragdrift 物理取证定案）：
   150% 缩放下拖动跨物理取整边界时，OS 会把窗口物理矩形向外重新贴合，
   setPosition / setBounds(实时宽高) 都净增 +1px/几步（物理 GetWindowRect 实证：
   setPosition 40 步 362x522→373x549）；而 getBounds 的 DIP 换算还会「说谎」
   ——物理没变、读数 +1——下一会话若拿镜头读数当基准就会把谎言物化成真实增长
   （实证：镜头基线三会话物理 362x522→363x524）。
   终版设计=拖动每步 setBounds 显式重申冻结基准 w0/h0，基准取自本缓存：
   缓存只在【我方显式写入尺寸】时更新（包装 setBounds/setSize 自动记录），
   永不从 getBounds 回读 → 物化链路被切断。实证：缓存基线四会话 100 步
   真实光标拖动，物理矩形全程 362x522 分毫不差。 */
const trustedSizeByWC = new Map();   /* key=webContents.id → {w,h} */


function trustedW(w) {
  try { const t = trustedSizeByWC.get(w.webContents.id); if (t && t.w > 50) return t.w; } catch (_) {}
  return b0w(w);
}
function trustedH(w) {
  try { const t = trustedSizeByWC.get(w.webContents.id); if (t && t.h > 50) return t.h; } catch (_) {}
  return b0h(w);
}
function attachSizeCache(w) {
  try {
    const id = w.webContents.id;
    const origSB = w.setBounds.bind(w);
    const origSS = w.setSize.bind(w);
    w.setBounds = function (o) {
      try {
        if (o && Number.isFinite(o.width) && Number.isFinite(o.height) && o.width > 0 && o.height > 0) {
          trustedSizeByWC.set(id, { w: Math.round(o.width), h: Math.round(o.height) });
        }
      } catch (_) {}
      return origSB(o);
    };
    w.setSize = function (ww, hh) {
      try {
        if (Number.isFinite(ww) && Number.isFinite(hh) && ww > 0 && hh > 0) {
          trustedSizeByWC.set(id, { w: Math.round(ww), h: Math.round(hh) });
        }
      } catch (_) {}
      return origSS(ww, hh);
    };
  } catch (_) {}
}

function performNudge(w) {
  try {
    if (w.isDestroyed()) return;
    const b = w.getBounds();
    const db = screen.getDisplayMatching(b).bounds;
    

    const M = 8;
    const nearEdge = (b.y - db.y < M) || ((db.y + db.height) - (b.y + b.height) < M) ||
                     (b.x - db.x < M) || ((db.x + db.width) - (b.x + b.width) < M);
    if (nearEdge) return;
    nudgeArmGate();
    

    const tw0 = trustedW(w), th0 = trustedH(w);
    win_setBoundsSafe(w, b.x, b.y + 1, tw0, th0);
    setTimeout(() => {
      try { if (!w.isDestroyed()) win_setBoundsSafe(w, b.x, b.y, tw0, th0); } catch (_) {}
    }, 16);
  } catch (_) {}
}
function win_setBoundsSafe(w, x, y, width, height) {
  try { w.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }); } catch (_) {}
}

function attachGeomTrace(w, tag) {
  if (!GEOM_TRACE_ON || !w || typeof w !== 'object') return;
  ['setBounds', 'setSize', 'setContentSize', 'setPosition', 'setMinimumSize',
   'setMaximumSize', 'center', 'maximize', 'unmaximize'].forEach((name) => {
    const orig = w[name];
    if (typeof orig !== 'function') return;
    w[name] = function (...args) {
      if (geomTraceN < 600) {
        geomTraceN++;
        let st = '';
        try {
          st = String(new Error().stack || '')
            .split('\n').slice(1, 5)
            .map((s) => s.trim().replace(/^at\s+/, '').replace(__dirname, '.'))
            .join(' | ').slice(0, 190);
        } catch (_) {}
        let cur = '';
        try { const b = w.getBounds(); cur = b.width + 'x' + b.height; } catch (_) {}
        try {
          log('[geom] ' + tag + '.' + name + '(' + JSON.stringify(args) +
              ') lock=' + (winLocked ? 1 : 0) + ' cur=' + cur + ' <= ' + st);
        } catch (_) {}
      }
      return orig.apply(this, args);
    };
  });
}

/* 主进程异常兜底：原来启动路径上任何一处抛出（托盘空图、无显示器时
   screen.getPrimaryDisplay()、注册表自愈…）都会让 create() 不执行 ——
   进程活着、没窗没托盘，之后每次双击又被单实例锁立刻 quit，用户只能强杀。
   这里记日志并保持进程存活，让后面的 createTray/create 仍有机会执行。 */


let uncaughtTimes = [];
process.on('uncaughtException', (e) => {
  try { log('uncaughtException: ' + ((e && e.stack) || (e && e.message) || e)); } catch (_) {}
  console.error('[uncaughtException]', e);
  try {
    const now = Date.now();
    uncaughtTimes = uncaughtTimes.filter(function (t) { return now - t < 60000; });
    uncaughtTimes.push(now);
    if (uncaughtTimes.length >= 3) {
      log('uncaughtException 60s 内达 3 次，判定系统性故障，执行 relaunch 重启');
      app.relaunch();
      app.exit(1);
    }
  } catch (_) {}
});


process.on('unhandledRejection', (reason) => {
  try { log('unhandledRejection: ' + ((reason && reason.stack) || (reason && reason.message) || reason)); } catch (_) {}
  console.error('[unhandledRejection]', reason);
});
// 显示名固定为中文（原生 confirm/alert 弹窗标题取此名，原来显示 package.json 的 name: habit-lab）
app.setName('时迹');

// 启动即「正常界面」：顶栏/打卡/切页/按钮全部可见可点（不锁定）。
// 历史坑：曾用 #lock 让启动即锁定态，但锁定态会隐藏所有按钮，用户误判"点不了按钮"——已移除。
// 主页面 habit.html 与 main.js 同目录，用 loadFile 加载（相对路径，项目整体移到哪都不失效）。
const HTML_FILE = 'habit.html';
const DEF_W = 520;
const DEF_H = 720;


const APP_BUILD = '2026-11-07-v1.0.0';

/* —— 主进程数据层（v2.1 存储架构）——
   业务数据唯一落盘点：data.json + images/ + auto-backup/（详见 store.js 头注）。
   渲染层不再写 localStorage；旧键 wb_workspace_habit_v1 只作迁移源，只读、永不删除。
   broadcast：数据变更实时推给所有窗口（主窗/编辑窗共用，替代旧 storage 事件）。 */
const { createStore } = require('./store');
const { createReminders } = require('./reminders');

 
let remindTimer = null;


let showWindow;
let fromMainWindow;


function safeRemindCheck(why) {
  try { reminders.check(); }
  catch (e) { try { log('[remind] check 失败(' + why + '): ' + ((e && e.message) || e)); } catch (_) {} }
  

  try { safeCarryoverCheck(why); }
  catch (e) { try { log('[remind] carryover 失败(' + why + '): ' + ((e && e.message) || e)); } catch (_) {} }
}


function safeCarryoverCheck(why) {
  try { if (reminders.carryoverCheck) reminders.carryoverCheck(); }
  catch (e) { try { log('[remind] carryover 失败(' + why + '): ' + ((e && e.message) || e)); } catch (_) {} }
}
function scheduleRemindCheck() {
  clearTimeout(remindTimer);
  remindTimer = setTimeout(function () { safeRemindCheck('debounce'); }, 2000);
}

async function flushWindowDrafts(freeze) {
  return Promise.all(BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !w.webContents.isDestroyed()).map(function(w){
    let timer;
    return Promise.race([
      w.webContents.executeJavaScript((freeze?'document.body.inert=true;':'')+'typeof flushRendererChanges === "function" ? flushRendererChanges() : true'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('等待窗口保存超时')), 8000); })
    ]).finally(() => clearTimeout(timer));
  }));
}
const store = createStore({
  userDataDir: app.getPath('userData'),
  portableAllowed: process.platform === 'win32' && (app.isPackaged || !!process.env.PORTABLE_EXECUTABLE_FILE || !!process.env.PORTABLE_EXECUTABLE_DIR),
  build: APP_BUILD,
  getAppVersion: () => { try { return require('./package.json').version || '2.1.0'; } catch (_) { return '2.1.0'; } },
  log,
  beforeSnapshot: flushWindowDrafts,
  

  isTrustedSender: function (event) { return fromMainWindow(event); },
  onDocChanged: function () { try { scheduleRemindCheck(); } catch (_) {} },
  broadcast: function (ch, payload) {
    try {
      BrowserWindow.getAllWindows().forEach(function (w) {
        try { if (!w.isDestroyed()) w.webContents.send(ch, payload); } catch (_) {}
      });
    } catch (_) {}
  }
});

const reminders = createReminders({
  userDataDir: app.getPath('userData'),
  log,
  getDoc: function () { try { return store._internal.peekDoc ? store._internal.peekDoc() : null; } catch (_) { return null; } },   
  

  notify: function (n) {
    try {
      /* Notification.isSupported() 在部分精简系统/无通知服务环境下为 false，直接走兜底 */
      if (Notification && typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
        log('[remind] 系统通知不可用（isSupported=false），走任务栏闪烁兜底');
        try { flashTaskbar(); } catch (_) {}
        return false;
      }
      const note = new Notification({
        title: n.title || '时迹',
        body: n.body || '',
        icon: path.join(__dirname, 'logo.ico'),
        silent: false
      });
      note.on('click', function () { try { showWindow(); } catch (_) {} });
       
      note.on('failed', function (_e, err) { try { log('[remind] notify 异步失败: ' + ((err && err.message) || err)); } catch (_) {} });
      note.show();
      return true;
    } catch (e) {
      log('[remind] notify failed: ' + ((e && e.message) || e));
      try { flashTaskbar(); } catch (_) {}    
      return false;
    }
  },
  /* 应用内横幅：主窗可见时双通道提示 */
  banner: function (n) {
    try {
      BrowserWindow.getAllWindows().forEach(function (w) {
        try { if (!w.isDestroyed()) w.webContents.send('hb-remind-banner', n); } catch (_) {}
      });
    } catch (_) {}
  }
});

let win = null;
let tray = null;
let isQuitting = false;
let manualWindowDrag = null;
let windowGestureRevision = 0;
let manualWindowResize = null;
let editorWin = null;    
let editorGen = 0;      // 编辑窗「代次」：回收即自增，用于作废挂起的 swap 兜底定时器（F3）
let pinFlowActive = false;  // 「贴桌面」流程进行中：抑制编辑窗 closed 的自动唤回（F2/F3）



function flashTaskbar() {
  try {
    if (win && !win.isDestroyed()) { win.flashFrame(true); return true; }
  } catch (_) {}
  return false;
}

// —— 桌面层小工具（desktop-layer.exe，随安装包分发，与主程序同目录）——
// 仅复用其 bottom 命令（纯 Z 序压底：摘 WS_EX_TOPMOST + SetWindowPos(HWND_BOTTOM)，
// 不换父窗、不动窗口样式，对 Electron/Chromium 零副作用）作为「失焦自动沉底」的压底原语。
// attach/detach（跨进程 SetParent 挂 Explorer WorkerW 桌面层）已废弃：
// 会让 Chromium 合成输出失效，桌面存在 Wallpaper Engine 等 DX11 壁纸宿主时
 
// 必须用 spawn（异步）：execFileSync 会阻塞主进程消息循环，导致锁定瞬间点击事件排队、
// UI 卡死无响应（用户感知为"闪退"）。
 
// 语义：锁定 = 去置顶 + 去任务栏按钮 + 禁移动 + 失焦(blur)自动压到 Z 序最底。
// 锁定时窗口若在前台则保持原位可见（用户刚点过锁定按钮，必然看得见"变成便签"）；
// 一旦切到别的窗口即沉底，从此不挡任何程序。解锁 = 恢复一切并拉回前台。
let winLocked = false;
let startupBounds = null;   // 启动时窗口 bounds：解锁贴纸后回到“刚启动时的大小+居中”   // 锁定时保存窗口位置/尺寸，解锁恢复
let winLockBlurHandler = null;


let stickyPosPinned = true;
let stickyFitSuppressed = false;
/* 把窗口钳回主屏工作区内（保留 0 边距吸附），用于「保留用户记忆位置」的贴纸尺寸变化 */
function clampWindowIntoWorkArea() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    /* v2.2.2 终版：尺寸取可信缓存（镜头 +1 会被这里物化成真实变宽） */
    const tw = trustedW(win), th = trustedH(win);
    const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - tw));
    const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - th));
    /* v2.2.2：一律 setBounds 显式带宽高——setPosition 在透明无边框窗上会被 OS 净增高度（拖动变大根因） */
    if (x !== b.x || y !== b.y) win.setBounds({ x: Math.round(x), y: Math.round(y), width: tw, height: th });
  } catch (_) {}
}



let editorWinIdle = null;   
function retireEditorWindow() {
  const w = editorWin;
  editorWin = null;
  editorGen++;              // 作废该编辑窗挂起的 swap 兜底
  if (w && !w.isDestroyed()) {
    try { if (w.isVisible()) w.hide(); } catch (_) {}
    editorWinIdle = w;       
  }
  return w;
}


const DISPOSE_MIN_MS = 600;    /* 最短保险期：低于此值不给 shell 摘条目的机会 */
const DISPOSE_POLL_MS = 120;   /* 轮询粒度：同时兜住"回收瞬间窗口又被 show 回来"的竞态 */
function disposeWindowLater(w) {
  if (!w) return;
  try { if (w.__hbDisposeScheduled) return; w.__hbDisposeScheduled = true; } catch (_) { return; }
  const started = Date.now();
  const tick = () => {
    try {
      if (!w || w.isDestroyed()) return;
      if (Date.now() - started < DISPOSE_MIN_MS) return void setTimeout(tick, DISPOSE_POLL_MS);
      /* 销毁前再确认一次不可见；若此刻又被 show 回来，藏回去并继续等保险期 */
      if (w.isVisible()) { try { w.hide(); } catch (_) {} return void setTimeout(tick, DISPOSE_POLL_MS); }
      w.destroy();
      try { log('window disposed after ' + (Date.now() - started) + 'ms'); } catch (_) {}
    } catch (_) {}
  };
  setTimeout(tick, DISPOSE_POLL_MS);
}
function killEditorWindow(reason, immediate) {
  const w = retireEditorWindow();
  if (reason) { try { log('editor window kill: ' + reason); } catch (_) {} }
  if (immediate) {
    /* 退出路径：进程即将结束，连同复用池一起销毁（随进程整体清理，无幽灵） */
    try { if (w && !w.isDestroyed()) w.destroy(); } catch (_) {}
    try { if (editorWinIdle && !editorWinIdle.isDestroyed()) editorWinIdle.destroy(); } catch (_) {}
    editorWinIdle = null;
  }
  

  return w;
}
/* 强兜底：除主窗外回收所有残留 BrowserWindow（隐藏编辑窗/贴纸窗积累→Alt+Tab 多个时迹窗） */
function destroyExtraWindows() {
  try {
    BrowserWindow.getAllWindows().forEach(function (w) {
      if (w !== win && w !== editorWinIdle && w !== editorWin && !w.isDestroyed()) {    
        try { if (w.isVisible()) w.hide(); } catch (_) {}
        disposeWindowLater(w);
      }
    });
    /* 全项目自查修正：只有已销毁或不可见的编辑窗才清引用——可见编辑窗无条件置空会孤儿化：
       再次 hb-editor-open 开出第二扇编辑窗；孤儿窗点关闭走 hb-close 判「非编辑窗」→
       隐藏主窗（用户感知应用消失）。可见编辑窗保留引用（双窗并存是用户主动状态）。 */
    try { if (!editorWin || editorWin.isDestroyed() || !editorWin.isVisible()) { editorWin = null; editorGen++; } } catch (_) { editorWin = null; editorGen++; }
  } catch (_) {}
}
/* 退出链路留痕 + 卡死兜底。用户报「托盘退出了，Alt+Tab 里还有时迹」：app.log 那一次运行
   根本没有 quit 行，说明退出请求没走到 close。这里先把每一步写日志（下次一眼看出断在哪），
   再给一个只在「窗已全关、进程还活着」时生效的硬退出——此刻渲染层早已落盘，无丢数据风险。 */
function quitApp(reason) {
  try { log('[quit] 请求退出：' + reason + ' · windows=' + BrowserWindow.getAllWindows().length); } catch (_) {}
  isQuitting = true;
  app.quit();
  setTimeout(function () {
    try {
      const alive = BrowserWindow.getAllWindows().filter(function (w) { return w && !w.isDestroyed(); });
      if (alive.length === 0 && !quitSaveInProgress && quitFlushDone) {
        log('[quit] 窗全关但进程 4s 未退，强制结束');
        app.exit(0);
      } else {
        log('[quit] 4s 后仍有 ' + alive.length + ' 个窗口未关（close 被 veto），不强制结束以免丢未落盘数据');
      }
    } catch (_) { try { app.exit(0); } catch (__) {} }
  }, 4000);
}
function onWinLockedBlur() {
  

}
function resetLockState() {
  // 渲染进程重载/崩溃恢复后页面已回到未锁定态，主进程必须同步复位，
  // 否则 blur 自动压底会继续触发、窗口永远垫底无法操作。
  winLocked = false;
  if (winLockBlurHandler && win && !win.isDestroyed()) {
    win.removeListener('blur', winLockBlurHandler);
    winLockBlurHandler = null;
  }
  if (win && !win.isDestroyed()) {
    try { win.setMovable(true); } catch (_) {}
    try { win.setSkipTaskbar(false); } catch (_) {}
  }
}
// 把便签窗口贴回主屏工作区右上角（16px 边距，不挡任务栏）。锁定收缩/内容自适应/锁定态缩放结束后统一调用。
function pinLockedTopRight() {
  if (!win || win.isDestroyed()) return;
  try {
    const wa = screen.getPrimaryDisplay().workArea;
    /* v2.2.2 终版：宽高取可信缓存——这里若用 getBounds 重申，镜头 +1 谎言会在
       每次「锁定收缩/内容自适应/缩放结束」时物化成真实变宽 */
    const tw = trustedW(win), th = trustedH(win);
    const margin = 16;
    const newX = wa.x + wa.width - tw - margin;
    const newY = wa.y + margin;
    /* v2.2.2：显式宽高 setBounds（防 setPosition 净增高度） */
    win.setBounds({ x: Math.round(newX), y: Math.round(newY), width: tw, height: th });
  } catch (_) {}
}
 
// 不小于最小尺寸、不越工作区、且窗口永远保留一块可见区不被拖出屏外。
function clampResizeRect(x, y, w, h, dir, base) {
  const wa = screen.getDisplayMatching(base||{x:Math.round(x),y:Math.round(y),width:Math.max(1,Math.round(w)),height:Math.max(1,Math.round(h))}).workArea;
  const margin = 8;
  

  /* resizable:false 的透明窗在 Windows 上会让 getMinimumSize() 返回当前尺寸，
     若据此钳制会永远无法从左侧/顶部向内缩小。使用项目声明的固定下限。 */
  const minW = winLocked ? 200 : 320;
  const minH = winLocked ? 160 : 480;
  const maxW = wa.width - margin * 2;
  const maxH = wa.height - margin * 2;
  w = Math.max(minW, Math.min(maxW, Math.round(w)));
  h = Math.max(minH, Math.min(maxH, Math.round(h)));
  if(base&&dir&&dir.includes('w'))x=base.x+base.width-w;
  if(base&&dir&&dir.includes('n'))y=base.y+base.height-h;
  x = Math.round(x); y = Math.round(y);
  // 窗口至少留 80×40 可见，避免被一路拖出屏幕后找不回来
  x = Math.max(wa.x + margin - w + 80, Math.min(wa.x + wa.width - margin - 80, x));
  y = Math.max(wa.y + margin - h + 40, Math.min(wa.y + wa.height - margin - 40, y));
  return { x, y, width: w, height: h };
}

// 便签窗内容轻量，关闭 GPU 硬件加速：规避独显/集显切换(NVIDIA Optimus)驱动导致的渲染崩溃与花屏。
// 注意：真机（有独显）【不要】加 in-process-gpu —— 它把 GPU 合成塞进主进程，一旦渲染/合成崩 = 整个应用闪退；
// 保持独立 GPU 子进程，崩溃时由 Chromium 自动重启，不影响主窗（16:23 插图闪退即此坑，dump 见 electron+0x66b0e7f int3）。
app.disableHardwareAcceleration();
// 火绒/部分杀软对 Chromium 子进程敏感；disable-gpu 已足够软渲染，disable-software-rasterizer 会连软光栅一起禁（真机冗余）


app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// 单实例锁：重复双击 VBS 不再叠 N 个 BrowserWindow，已有的那个窗口被拉到前台
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    /* 原来这里复制了一份 showWindow 的逻辑但漏掉「主窗已不存在就重建」，
       于是 win 为 null 时二次启动会静默什么都不发生。改成直接复用。 */
    try { showWindow(); } catch (e) { try { log('second-instance showWindow failed: ' + ((e && e.message) || e)); } catch (_) {} }
  });

  showWindow = function showWindow() {
    if (!win || win.isDestroyed()) {
      create();
      return;
    }
    // 主窗唤回时回收残留编辑窗，避免 Alt+Tab 积累多个时迹窗（编辑内容已在 beforeunload 落盘）
    try { destroyExtraWindows(); } catch (_) {}
    if (win.isMinimized()) win.restore();
    try { win.setSkipTaskbar(false); } catch (_) {}
    win.show();
    win.focus();
  }

  function createTray() {
    if (tray) return;
    // 托盘图标用项目内 logo.ico（多尺寸含 16/24/32/48/64/128/256，Windows 按 DPI 自动选最适）
    let icon = nativeImage.createFromPath(path.join(__dirname, process.platform === 'darwin' ? 'logo-32.png' : 'logo.ico'));
    if (icon.isEmpty()) {
      console.error('[tray] logo.ico 加载失败，改用 logo-32.png');
      icon = nativeImage.createFromPath(path.join(__dirname, 'logo-32.png'));
    }
    /* 空图直接 new Tray() 在 Electron 里会抛：抛在 whenReady 里会让 create() 不执行，
       结果是「进程活着但没窗没托盘」，此后每次双击都被单实例锁立刻 app.quit()，
       用户看到的就是「图标点不动、任务管理器里却有一堆时迹」。 */
    if (icon.isEmpty()) {
      console.error('[tray] 无可用图标，跳过托盘（主窗口不受影响）');
      return;
    }
    tray = new Tray(icon);
    tray.setToolTip('时迹');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示窗口', click: showWindow },
      { type: 'separator' },
      { label: '退出', click: () => quitApp('tray') }
    ]));
    tray.on('click', showWindow);
  }

// —— 安全：窗口导航限制 ——
// 便签正文允许粘贴外链(a[href^=http])，若不拦截，点击会在应用无边框窗口内直接跳转，
// 页面被换成任意网页（伪装界面/钓鱼）。这里统一拦截：本地 file:// 放行，外部 http(s)
// 交给系统默认浏览器，新窗口一律拒绝。


const APP_PAGE_PATH = path.resolve(path.join(__dirname, HTML_FILE)).toLowerCase();
function isAppPageUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'file:') return false;
    let p = decodeURIComponent(u.pathname || '');
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);          // file:///C:/x → C:/x
    return path.resolve(p).toLowerCase() === APP_PAGE_PATH;
  } catch (_) { return false; }
}



function openExternalSafe(url) {
  try {
    const proto = new URL(String(url)).protocol.toLowerCase();
    if (proto !== 'https:' && proto !== 'http:' && proto !== 'mailto:') {
      log('[nav] openExternal 协议白名单拒绝: ' + String(url).slice(0, 200));
      return;
    }
    shell.openExternal(String(url));
  } catch (_) {}
}

function guardNavigation(webContents) {
  if (!webContents) return;
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) openExternalSafe(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (isAppPageUrl(url)) return;            // 本应用页面（含 ?view=editor&shell=1 等 query）放行
    event.preventDefault();
    log('[nav] 已拦截非应用页面跳转: ' + String(url).slice(0, 200));
    if (/^https?:/i.test(url)) openExternalSafe(url);
  });
  // 被 CSP/导航拒绝后的兜底：同源重定向也拦一道
  webContents.on('will-redirect', (event, url) => {
    if (isAppPageUrl(url)) return;
    event.preventDefault();
    log('[nav] 已拦截非应用页面重定向: ' + String(url).slice(0, 200));
    if (/^https?:/i.test(url)) openExternalSafe(url);
  });
}

  /* 重载退避：原来 did-fail-load / render-process-gone 都无条件 250/300ms reload，
     一旦 habit.html 缺失或某条内容必崩，就会「透明空窗无限闪、永远打不开」，
     只能任务管理器强杀。这里限成一分钟内最多 4 次，超过就停手并给出可读的错误页。 */
  let reloadTries = 0, reloadWindowStart = Date.now();
  const RELOAD_LIMIT = 4, RELOAD_WINDOW_MS = 60000;
  function scheduleReload(delayMs, why) {
    const now = Date.now();
    if (now - reloadWindowStart > RELOAD_WINDOW_MS) { reloadWindowStart = now; reloadTries = 0; }
    reloadTries++;
    if (reloadTries > RELOAD_LIMIT) {
      log('reload aborted (' + why + ') after ' + RELOAD_LIMIT + ' tries in 60s — 停止重载以避免空窗闪屏');
      try {
        if (win && !win.isDestroyed()) {
          win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
            '<meta charset="utf-8"><title>时迹</title><div style="font:14px/1.7 system-ui;padding:28px;color:#1C2434">' +
            '<b style="font-size:16px">界面加载失败</b><p>已尝试自动重载 ' + RELOAD_LIMIT + ' 次仍失败（' + why + '）。</p>' +
            '<p>数据仍在 <code>%APPDATA%\\habit-lab</code>，未受影响。可先「显示窗口→托盘退出」后重新打开；' +
            '若反复出现，请用 <code>auto-backup\\</code> 里最近一份备份恢复，或重新安装。</p></div>'));
        }
      } catch (_) {}
      return;
    }
    setTimeout(() => { try { if (win && !win.isDestroyed()) win.webContents.reload(); } catch (_) {} }, delayMs * reloadTries);
  }

  function create() {
    // 居中在主屏
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
     
    const x = Math.round(wa.x + (wa.width - DEF_W) / 2);
    const y = Math.round(wa.y + (wa.height - DEF_H) / 2);

    win = new BrowserWindow({
      width: DEF_W,
      height: DEF_H,
      x, y,
      icon: path.join(__dirname, 'logo.ico'),  // Windows 任务栏 / Alt-Tab / 窗口标题图标
      minWidth: 320,
      minHeight: 480,
      resizable: false,   
                         //   且结束残留 hit-test → 页面“拉不动/点不了”。缩放改由页面四角/边热区 + setBounds 程序化完成（见 hb-window-resize-*）。
      frame: false,      // ★ 无系统标题栏（无 — □ ×）
      

      transparent: true, // ★ 窗口 OS 透明 + #app 28px 圆角 = 「圆弧角手机外形」，圆角外透出桌面
      thickFrame: false, // 移除 WS_THICKFRAME：单独使用即可去掉 DWM 方形投影，不破坏透明度
      backgroundColor: '#00000000', // 全透明，配合 transparent 让 OS 透出桌面
      show: true,        // ★ 立即显示窗口（创建即显示，透明窗首帧无内容 = 不可见，不闪白）
                         //   若 clearCache 卡住→loadFile 不执行→窗口永远隐形（进程活着但窗口不出来）
      alwaysOnTop: false,// 默认不置顶；用户锁住便签后可手动开（先保持普通置顶行为）
      autoHideMenuBar: true,
      title: '时迹',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    // 每次新建主窗口都恢复可移动状态；锁定便签时才会由 IPC 显式禁用移动。
    win.setMovable(true);
    startupBounds = { x, y, width: DEF_W, height: DEF_H };   // 记录启动时大小+居中位置，解锁贴纸后恢复
    win.setMenuBarVisibility(false);
    try { if (typeof win.setHasShadow === 'function') win.setHasShadow(false); } catch (_) {}
    

    win.webContents.on('did-finish-load', function () {
      try { if (typeof win.setHasShadow === 'function') win.setHasShadow(false); } catch (_) {}
      setTimeout(function () { try { if (!win.isDestroyed()) win.setHasShadow(false); } catch (_) {} }, 1200);
    });
    guardNavigation(win.webContents);   // 外链走系统浏览器，禁止窗口内跳转
    /* 把渲染层点名要留痕的诊断（[win-action] 等）搬进 app.log —— 没有这一步，
       打包版里的 console.warn 没人看得见。只认白名单前缀 + error 级，避免日志被刷爆。
       Electron 31 的签名是 (event, level:number, message, line, sourceId)，
       level：0 verbose / 1 info / 2 warning / 3 error；新版本改成对象，这里两种都吃。 */
    const TRACE_PREFIX = ['[win-action]', '[applyLock]', '[unlock]'];
    win.webContents.on('console-message', (_e, a, b) => {
      try {
        let lvl, msg;
        if (a && typeof a === 'object') { lvl = a.level; msg = String(a.message || ''); }
        else { lvl = a; msg = String(b || ''); }
        if (!msg) return;
        const numeric = typeof lvl === 'number';
        const isErr = numeric ? lvl >= 3 : lvl === 'error';
        const isTrace = TRACE_PREFIX.some(p => msg.indexOf(p) === 0);
        if (isErr || isTrace) log('[renderer] ' + msg.slice(0, 300));
      } catch (_) {}
    });
    // 正常启动进入主界面；只有锁定操作才切换到全屏便签视图。
     
    //   loadFile 永不执行 → did-finish-load 不触发 → show:false 窗口永远隐形。直接 loadFile，
    //   file:// 本地页面无 HTTP 缓存问题，clearCache 本就多余。
    win.loadFile(path.join(__dirname, HTML_FILE), { query: { shell: '1', build: APP_BUILD } });

    // 页面加载完设焦点 + 兜底显示（窗口已 show:true，此处仅确保拉前台）
    win.webContents.once('did-finish-load', () => {
      resetLockState();   // 每次页面(重新)加载都回到未锁定态：渲染崩溃自动重载后不会残留锁定
      try { win.show(); win.focus(); } catch (_) {}
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      log('did-fail-load: ' + errorCode + ' ' + errorDescription);
      console.error('[did-fail-load] ' + errorCode + ' ' + errorDescription);
      /* -3 是用户/程序主动取消导航（如切页、data: 错误页替换），不该算失败 */
      if (errorCode === -3 || errorCode === -2) return;
      scheduleReload(250, 'did-fail-load ' + errorCode);
    });
    win.webContents.on('did-finish-load', () => { reloadTries = 0; });   /* 一次成功加载就把额度还回去 */
    win.on('closed', () => {
      win = null;
      winLocked = false;
      winLockBlurHandler = null;
    });

    attachGeomTrace(win, 'win');
    attachSizeCache(win);   /* ★ 拖动冻结基准的可信尺寸来源（见 trustedSizeByWC 注释） */

    

    if (DEV_ENV_OK && process.env.HB_PROBE === '1') {
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const r = await win.webContents.executeJavaScript(`(()=>{
              const a = document.getElementById('app');
              const cs = a ? getComputedStyle(a) : null;
              const b = document.body;
              const bcs = getComputedStyle(b);
              const rc = a ? a.getBoundingClientRect() : null;
              return {
                innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio,
                outerW: outerWidth, outerH: outerHeight,
                appRadius: cs ? cs.borderRadius : '(no #app)',
                appBg: cs ? cs.backgroundColor : '',
                appOverflow: cs ? cs.overflow : '',
                appW: rc ? Math.round(rc.width) : 0, appH: rc ? Math.round(rc.height) : 0,
                appTop: rc ? Math.round(rc.top) : 0, appLeft: rc ? Math.round(rc.left) : 0,
                bodyBg: bcs.backgroundColor,
                bodyBgImg: (bcs.backgroundImage || '').slice(0, 50),
                bodyClass: b.className,
                locked: b.classList.contains('app-locked')
              };
            })()`);
            log('[probe] ' + JSON.stringify(r));
          } catch (e) { try { log('[probe] style failed: ' + ((e && e.message) || e)); } catch (_) {} }
          try {
            const img = await win.webContents.capturePage();
            const sz = img.getSize();
            const buf = img.toBitmap();     /* BGRA */
            const px = (x, y) => { const i = (y * sz.width + x) * 4; return [buf[i + 2], buf[i + 1], buf[i], buf[i + 3]]; };
            log('[probe] capture ' + sz.width + 'x' + sz.height
              + ' TL=' + JSON.stringify(px(0, 0))
              + ' T3=' + JSON.stringify(px(3, 3))
              + ' T10=' + JSON.stringify(px(10, 10))
              + ' CENTER=' + JSON.stringify(px(sz.width >> 1, sz.height >> 1)));
          } catch (e) { try { log('[probe] capture failed: ' + ((e && e.message) || e)); } catch (_) {} }
        }, 6000);
      });
    }
    // Windows 无边框窗口停止拖拽缩放时，偶尔会残留 resize 命中状态，
    // 导致后续按钮 click 被系统吞掉。轻推窗口一次可刷新 hit-test。
    

    let heightGuardBusy = false;
    win.on('resize', () => {
      if (!heightGuardBusy) {
        try {
          if (winLocked && win && !win.isDestroyed()) {
            const gb = win.getBounds();
            const gwa = screen.getPrimaryDisplay().workArea;
            if (gb.height > gwa.height) {
              heightGuardBusy = true;
              log('[height-guard] 高度 ' + gb.height + ' 超过工作区 ' + gwa.height + ' → 强制钳回');
              win.setBounds({ x: gb.x, y: gb.y, width: trustedW(win), height: gwa.height });
              setTimeout(() => { heightGuardBusy = false; }, 300);
            }
          }
        } catch (_) {}
      }
      

    });
    // 关闭窗口 = 收进托盘（托盘图标常驻，右键“退出”才真正结束进程）——用户偏好。
    // 隐藏时同步 setSkipTaskbar(true) 去掉任务栏按钮；showWindow/二次启动会恢复。
     
    //    【完全不改变 Alt+Tab 资格】—— Alt+Tab 由 WS_EX_TOOLWINDOW 决定。旧注释以为它能
    //    「缓解 Alt+Tab 幽灵缩略图」，那是错的（所以才需要外部守护进程兜底）。窗口 hide() 之后
    //    本就不可见，自然也不在 Alt+Tab 里，此处 setSkipTaskbar 只为准任务栏观感。
    win.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        try { win.setSkipTaskbar(true); } catch (_) {}
        try { win.hide(); } catch (_) {}
        return;
      }
      /* F2：退出流程 —— hide 后立即 destroy（不用 setImmediate：进程即将退出，异步回调未必跑得到） */
      try { killEditorWindow('quit', true); } catch (_) {}
    });

    // 防意外：页面失去响应时保持窗口可见
    win.on('unresponsive', () => { try { win.show(); } catch (_) {} });

    // 渲染进程崩溃兜底（插图/富文本大图可能触发 V8/渲染内核 int3 崩）：
    // 不关窗、自动重载页面恢复 —— 数据都在 localStorage，不丢。
     
    win.webContents.on('render-process-gone', (_e, details) => {
      try {
        log('render-process-gone: ' + details.reason);
        console.error('[render-process-gone] reason=' + details.reason + ' exitCode=' + details.exitCode);
        if (details.reason !== 'clean-exit') {
          scheduleReload(300, 'render-process-gone ' + details.reason);
        }
      } catch (_) {}
    });
    // 子进程（GPU/utility）崩溃同样不退出应用，交由 Chromium 内部重启
    win.webContents.on('child-process-gone', () => {});
  }

   
  // 点击便签记录页的某条便签：主窗口隐藏，弹出独立便签窗；返回/关闭时回收并按需唤回主窗。
  function createEditorWindow(noteId){
    log('editor window open: ' + noteId);
    

    const wantId = String(noteId || '');
    if(editorWin && !editorWin.isDestroyed() && editorWin.isVisible() && editorWin.__hbNoteId === wantId){
      editorWin.focus(); return;
    }
    const reuseQ = { shell: '1', view: 'editor', build: APP_BUILD };
    if(noteId) reuseQ.note = String(noteId);
    if(winLocked) reuseQ.sticky = '1';
    const reuseSrc = (editorWin && !editorWin.isDestroyed()) ? editorWin
                   : ((editorWinIdle && !editorWinIdle.isDestroyed()) ? editorWinIdle : null);
    if(reuseSrc){
      editorWinIdle = null;
      editorWin = reuseSrc;
      editorWin.__hbNoteId = wantId;
      /* 复用路径同样要刷新贴纸身份：池里那扇窗上次可能是在非贴纸态下建的 */
      try { editorWin._isSticky = !!winLocked; } catch (_) {}
      const myGen = ++editorGen;
      let swapped = false;
      const swap = () => {
        if(swapped) return; swapped = true;
        try{ log('editor reuse swap gen=' + myGen + '/' + editorGen + ' note=' + wantId); }catch(_){}
        if(myGen !== editorGen) return;
        

        try{ if(editorWin && !editorWin.isDestroyed()){ editorWin.show(); editorWin.focus(); } }catch(_){}
        try{ if(win && !win.isDestroyed() && win.isVisible()) win.hide(); }catch(_){}
        setTimeout(()=>{ try{ if(editorWin && !editorWin.isDestroyed()) editorWin.setBackgroundThrottling(true); }catch(_){} }, 1000);
      };
      const swapWhenPainted = () => {
        

        try{ log('editor reuse did-finish-load'); }catch(_){}
        setTimeout(swap, 150);
      };
      try{ editorWin.webContents.once('did-finish-load', swapWhenPainted); }catch(_){}
      

      try{ log('editor reuse: prepare load note=' + wantId); }catch(_){}
      try{ editorWin.setBackgroundThrottling(false); }catch(_){}
      try{ if(editorWin.isVisible()) editorWin.hide(); }catch(_){}
      try{ editorWin.loadFile(path.join(__dirname, HTML_FILE), { query: reuseQ }); }
      catch(e){ try{ log('editor reuse loadFile: ' + (e && e.message || e)); }catch(_){} }
      return;
    }
    // 编辑窗位置/尺寸 = 主窗当前矩形（原样复制，不钳制）——大小位置保持原样，仅无缝跳转
    let base = { x: 700, y: 180, width: 520, height: 720 };
    try{
      if(win && !win.isDestroyed()){
        const b = win.getBounds();
        base = { x: b.x, y: b.y, width: b.width, height: b.height };  // 原样复制：大小位置与主窗完全一致
      }
    }catch(_){}
    editorWin = new BrowserWindow({
      x: base.x,
      y: base.y,
      width: base.width,
      height: base.height,
      minWidth: 320,
      minHeight: 480,
      resizable: false,
      frame: false,
      

       
      // 之后才显示」时才会经历「异色直角→白色直角→圆角」的合成过渡；
      // 这里创建即显示——透明空窗此刻没有任何内容像素，等于不可见地叠在主窗上方，
      // 首帧内容画好后再隐藏主窗（did-finish-load 后 swap），全程无直角、无白闪。
      transparent: true,
      thickFrame: false, // 同主窗：去 DWM 方形投影
      shadow: false,   // 关掉 DWM 方形投影：它跟着窗口矩形走，28px 圆角外会露出浅浅的直角阴影
      backgroundColor: '#00000000',
      autoHideMenuBar: true,
      title: '便签',
      show: true,
      icon: path.join(__dirname, 'logo.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    guardNavigation(editorWin.webContents);   // 编辑窗同样限制导航
    attachGeomTrace(editorWin, 'editor');     /* 临时诊断：编辑窗也纳入几何溯源 */
    attachSizeCache(editorWin);               /* ★ 编辑窗拖动同一可信尺寸来源 */
    // 编辑窗渲染崩溃兜底：自动重载，避免空白死窗（用户感知“闪退/卡死”）
    editorWin.webContents.on('render-process-gone', (_e, details) => {
      try{
        log('editor render-process-gone: ' + details.reason);
        if (details.reason !== 'clean-exit' && editorWin && !editorWin.isDestroyed()) {
          setTimeout(() => { try{ if(editorWin && !editorWin.isDestroyed()) editorWin.webContents.reload(); }catch(_){} }, 300);
        }
      }catch(_){}
    });
    // 编辑窗加载失败兜底（主窗有 scheduleReload，编辑窗漏了）：只补载一次，防失败循环
    let editorFailReloaded = false;
    editorWin.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      try{
        if (!isMain || editorFailReloaded) return;
        editorFailReloaded = true;
        log('editor did-fail-load: ' + code + ' ' + desc + ' → 一次性补载');
        setTimeout(() => { try{ if(editorWin && !editorWin.isDestroyed()) editorWin.webContents.reload(); }catch(_){} }, 400);
      }catch(_){}
    });
    const q = { shell: '1', view: 'editor', build: APP_BUILD };
    if(noteId) q.note = String(noteId);
    if(winLocked) q.sticky = '1';   /* 告诉编辑窗"你是贴纸（极简版）"：隐藏 me-top/工具栏 */
    /* 建窗时快照"我是贴纸窗"身份：winLocked 之后会变，而 hb-editor-back 需要知道
       发起方到底是不是那张贴纸（预热/复用池里的隐藏编辑窗绝不是）。 */
    try { editorWin._isSticky = !!winLocked; } catch (_) {}
    editorWin.loadFile(path.join(__dirname, HTML_FILE), { query: q });
    const myGen = ++editorGen;   /* 本编辑窗代次：一旦被回收此值即失效，挂起的 swap 兜底随之作废 */
    let swapped = false;
    const swap = () => {
      if(swapped) return; swapped = true;
      /* F3：本编辑窗已被回收（用户已返回 / 已贴桌面）→ 绝不 hide 主窗。
         否则「打开便签后 1.5s 内返回」时，1500ms 兜底到点仍会 win.hide()，
         结果主窗也被藏起 → 进程活着却一个可见窗口都没有（用户感知为「幽灵」）。 */
      if(myGen !== editorGen) return;
      try{ if(editorWin && !editorWin.isDestroyed()) editorWin.focus(); }catch(_){}
      try{ if(win && !win.isDestroyed() && win.isVisible()) win.hide(); }catch(_){}
    };
    // 首帧内容上屏（双 rAF）后再隐藏主窗，主窗隐藏与便签内容出现同帧完成
    const swapWhenPainted = () => {
      try{
        editorWin.webContents.executeJavaScript('requestAnimationFrame(()=>requestAnimationFrame(()=>1))').then(()=>swap()).catch(()=>setTimeout(swap,120));
      }catch(_){ setTimeout(swap,120); }
      setTimeout(swap, 1500);   // 兜底：渲染异常也要完成切换
    };
    editorWin.webContents.on('did-finish-load', swapWhenPainted);
    const thisWin = editorWin;
    thisWin.on('closed', () => {
      

      if(editorWin === thisWin) editorWin = null;
      if(editorWinIdle === thisWin) editorWinIdle = null;
      // 编辑窗被直接关闭（如 Alt+F4）且主窗还藏着时，唤回主窗，避免应用"隐身"
      // 贴桌面流程除外：那条链路会自己 show 主窗，此处抢 show 会闪出未锁定的主窗
      if(!isQuitting && !pinFlowActive && win && !win.isDestroyed() && !win.isVisible()){ try{ win.show(); }catch(_){} }
    });
  }
  ipcMain.handle('hb-editor-open', (event, noteId) => {
    try{
      let from='?';
      try{ const sw=BrowserWindow.fromWebContents(event.sender); from=sw?('win:"'+sw.getTitle()+'"'):'webContents'; }catch(_){}
      log('hb-editor-open from=' + from + ' note=' + noteId);
      

      if (!fromMainWindow(event)) { log('[hb-editor-open] 非主窗发送方，忽略'); return; }
      createEditorWindow(noteId);
    }catch(e){ log('[hb-editor-open] ' + (e && e.message ? e.message : String(e))); }
  });
  ipcMain.handle('hb-editor-back', (event, target) => {
    try{
      

      let sw = null; try { sw = BrowserWindow.fromWebContents(event.sender); } catch (_) {}
      const fromStickerEditor = !!(sw && sw === editorWin && sw._isSticky);
      if (winLocked && !fromStickerEditor) {
        try { log('[hb-editor-back] 发送方非贴纸编辑窗，忽略解锁（保持贴纸形态）'); } catch (_) {}
        return { unlocked: false };
      }
      /* 3.1.0：target = 回主窗后要落的页面（贴纸待办卡「打开待办」传 'todo'）。
         只接受已知页面名字，防任意 JS 串被拼进注入代码。 */
      const tgt = (typeof target === 'string' && /^(today|stat|todo|memo|mine)$/.test(target)) ? target : '';
      /* F2：先让主窗上屏，再回收编辑窗。顺序反了会有一瞬「编辑窗没了、主窗还没出」的空档，
         观感像桌面闪一下；主窗可见后，编辑窗 closed 回调也不会再抢 show。
         回收一律走 killEditorWindow（先 hide → 下一 tick destroy），不对可见窗口裸 destroy。 */
      if(win && !win.isDestroyed()){
        win.show(); win.focus();
        /* 若主窗仍处锁定态（贴纸场景的"返回"），让渲染页触发 applyLock(false) → openMemoList 回列表；
           带 target 时先预设 _unlockTarget，解锁分支会 go(target) 落到待办页而非便签列表 */
        if(winLocked){
          const pre = tgt ? ('window._unlockTarget=' + JSON.stringify(tgt) + ';') : '';
          try{ win.webContents.executeJavaScript('try{' + pre + 'if(typeof window.handleWindowAction==="function"){window.handleWindowAction("lock",{preventDefault(){},stopPropagation(){}});}}catch(_){}'); }catch(_){}
        }else if(tgt){
          try{ win.webContents.executeJavaScript('try{if(typeof openMemoList==="function")openMemoList();if(typeof go==="function")go(' + JSON.stringify(tgt) + ');}catch(_){}'); }catch(_){}
        }
      }
      killEditorWindow('back');
    }catch(_){}
  });
  // 编辑窗点「📌 贴桌面」：关掉当前编辑窗 → 由主窗执行锁定该便签（贴纸形态：极简 + 右上角 + 记忆尺寸）
  ipcMain.handle('hb-pin-note', async (event, noteId) => {
    

    let sw0 = null; try { sw0 = BrowserWindow.fromWebContents(event.sender); } catch (_) {}
    if (!(sw0 && sw0 === editorWin)) {
      try { log('[hb-pin-note] 发送方非编辑窗，忽略'); } catch (_) {}
      return;
    }
    // 保存失败或超时，保持编辑窗口可见；隐藏窗口必须在确认落盘之后。
    let pinSaveTimer;
    try{
      await Promise.race([
        sw0.webContents.executeJavaScript('flushRendererChanges()'),
        new Promise((_,reject)=>{pinSaveTimer=setTimeout(()=>reject(new Error('等待便签保存超时')),8000);})
      ]);
      if(sw0.isDestroyed()||sw0!==editorWin)return {ok:false,message:'编辑窗口已变化，请重新操作'};
    }catch(error){
      return {ok:false,message:String(error.message||error)};
    }finally{clearTimeout(pinSaveTimer);}
    /* F2/F3：本流程中主窗会短暂不可见 → 置 pinFlowActive 抑制编辑窗 closed 的自动唤回；
       并先把编辑窗「藏起来」（不立刻销毁），等主窗以贴纸形态上屏后再回收，
       这样全程至少有一个窗口可见，也不会对可见窗口裸 destroy 而留下 Alt+Tab 幽灵条目。 */
    pinFlowActive = true;
    retireEditorWindow();   /* 返回值未用（窗口入复用池，见其内部注释） */
    try{
      // 前置锁定态标记：锁定流程中若仍触发 editorOpen，新建的编辑窗应带 ?sticky=1（贴纸形态），
      // 避免半途开出完整编辑窗与贴纸抢焦点（与 habit.html 的本地渲染修复互为兜底）。
      try{ winLocked = true; }catch(_){}
      if(win && !win.isDestroyed()){
        const js = 'window.lockStickyNoteById&&window.lockStickyNoteById(' + JSON.stringify(String(noteId || '')) + ')';
        

        try{ win.setBackgroundThrottling(false); }catch(_){}
        let p = null;
        try{ p = win.webContents.executeJavaScript(js); }catch(_){}
        try{ if(p && typeof p.catch === 'function'){ await Promise.race([p.catch(()=>{}), new Promise(r=>setTimeout(r,400))]); } }catch(_){}
        try{ await Promise.race([win.webContents.executeJavaScript('1').catch(()=>{}), new Promise(r=>setTimeout(r,200))]); }catch(_){}
        win.show();    
        setTimeout(()=>{ try{ if(win && !win.isDestroyed()) win.setBackgroundThrottling(true); }catch(_){} }, 1000);
      }
    }catch(_){
    }finally{
      pinFlowActive = false;
       
    }
  });
  // 贴纸（进度卡等形态）按自身内容自适应高度：作用于发起窗口本身（主窗锁定态 / 贴纸编辑窗通用）
  /* 窗口控制类 IPC 的发送方校验：编辑窗/复用池窗连着同一份 preload，
     原来这些 handler 不认 sender，编辑窗里一个动作就能让看不见的主窗改尺寸/置顶，
     表现为「没操作却窗口变形」。只接受来自主窗的调用。 */
  fromMainWindow = function fromMainWindow(event) {
    try {
      return !!(win && !win.isDestroyed() && event && event.sender && win.webContents && event.sender.id === win.webContents.id);
    } catch (_) { return false; }
  }

   
  let fitSelfLogN = 0;
  ipcMain.on('hb-sticky-fit-self', (event, height) => {
    if (!fromMainWindow(event)) log('[hb-sticky-fit-self] 发送方不是主窗');   /* 同上：贴纸尺寸链路先只诊断 */
    try{
      const w = BrowserWindow.fromWebContents(event.sender);
      if(!w || w.isDestroyed()) return;
      const b = w.getBounds();
      

      const wantH = Number(height);
      let h = Math.max(220, Math.round(Number.isFinite(wantH) && wantH > 0 ? wantH : b.height));
      try{
        const wa = screen.getDisplayNearestPoint({ x: b.x + Math.round(b.width / 2), y: b.y }).workArea;
        

        const roomH = Math.max(220, wa.height - Math.max(0, b.y - wa.y) - 12);
        h = Math.min(h, roomH);
      }catch(_){}
      

      if (Math.abs(h - b.height) < 8) return;
       
      if (fitSelfLogN < 60) { fitSelfLogN++; log('[fit-self] 目标h=' + h + ' 当前h=' + b.height + ' 页面上报=' + Number(height)); }
       
      w.setBounds({ x: b.x, y: b.y, width: trustedW(w), height: h });
    }catch(_){}
  });

  // —— 自动备份（v2.1 起由 store.js 主进程持有）：写盘后按真实 mtime 判定间隔、
  //    目录式备份（data.json+images/）、频率与保留份数可配置（hb-config:* IPC）。
  //    旧 hb-auto-backup（渲染层整包 JSON 上传、7 天/3 份）随存储架构升级移除；
  //    历史单文件备份 habit-backup-*.json 保留在 auto-backup/ 目录，导入备份仍可读取。

  

  const startupPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const STARTUP_VALUE = '时迹';                       /* 与 NSIS 安装器同名，统一到这一条 */
  const LEGACY_VALUES = ['electron.app.Electron', 'HabitLab', 'habit-lab', '养成实验室'];
  const STARTUP_MARKER = path.join(app.getPath('userData'), 'startup.json');
  

  const STARTUP_SHORTCUT_NAMES = [STARTUP_VALUE + '.lnk', '养成实验室.lnk', 'HabitLab.lnk', 'habit-lab.lnk'];
  function startupFolderPath() {
    try { return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'); }
    catch (_) { return null; }
  }
  function startupShortcutPaths() {
    const dir = startupFolderPath();
    if (!dir) return [];
    return STARTUP_SHORTCUT_NAMES.map((n) => path.join(dir, n));
  }
  

  let _runValues=null, _runValuesAt=0;
  async function runValues(force) {
    const now = Date.now();
    if (!force && _runValues && now - _runValuesAt < 3000) return _runValues;
    _runValuesAt = now;
    _runValues = new Set();
    try {
      const out = await execFileAsync('reg', ['query', RUN_KEY], { encoding: 'utf8', windowsHide: true });
      String(out.stdout).split(/\r?\n/).forEach(function (line) {
        /* 形如「    时迹    REG_SZ    "C:\...\时迹.exe"」，值名可能含空格 */
        const m = line.match(/^\s+(.+?)\s+REG_[A-Z_]+\s/i);
        if (m && m[1]) _runValues.add(m[1].trim());
      });
    } catch (_) { /* Run 键不存在或查询失败：按「无自启项」处理 */ }
    return _runValues;
  }
  async function regValueExists(name) {
    return (await runValues()).has(name);
  }
  async function regWriteValue(name, value) {
    try {
      await execFileAsync('reg', ['add', RUN_KEY, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true });
      await runValues(true);
      return true;
    } catch (e) { log('[startup] reg add failed: ' + (e && e.message ? e.message : String(e))); return false; }
  }
  async function regDeleteValue(name) {
    try {
      await execFileAsync('reg', ['delete', RUN_KEY, '/v', name, '/f'], { windowsHide: true });
      await runValues(true);
      return true;
    } catch (_) { await runValues(true); return true; }    /* 本来就不存在 == 目标状态已达成 */
  }
  function existingStartupShortcuts() {
    return startupShortcutPaths().filter((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  }
  

  async function quarantineStartupShortcuts() {
    const list = existingStartupShortcuts();
    if (!list.length) return [];
    const moved = [];
    for (const p of list) {
      const name = path.basename(p);
      try {
        const dir = path.join(app.getPath('userData'), 'startup-disabled');
        await fsp.mkdir(dir, { recursive: true });
        const dest = path.join(dir, name);
        try { if (fs.existsSync(dest)) await fsp.unlink(dest); } catch (_) {}
        await fsp.rename(p, dest);
        moved.push(name);
        log('[startup] quarantined duplicate shortcut: ' + p + ' -> ' + dest);
      } catch (e) {
        try { await fsp.unlink(p); moved.push(name); log('[startup] removed duplicate shortcut (rename failed): ' + p); }
        catch (e2) { log('[startup] shortcut cleanup failed: ' + p + ' ' + ((e2 && e2.message) || e2)); }
      }
    }
    return moved;
  }
  async function readStartupMarker() {
    try { const o = JSON.parse(await fsp.readFile(STARTUP_MARKER, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
    catch (_) { return {}; }
  }
  async function writeStartupMarker(obj) {
    try { await fsp.writeFile(STARTUP_MARKER, JSON.stringify(obj)); return true; } catch (_) { return false; }
  }
  function samePath(a, b) {
    try { return !!a && !!b && path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase(); }
    catch (_) { return false; }
  }
  

  async function psAutostartExists(force) {
    try {
      const out = await execFileAsync('powershell', ['-NoProfile', '-Command',
        '$k="HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";' +
        '$i=Get-Item -Path $k -ErrorAction Stop;' +
        'if($i.Property -contains "' + STARTUP_VALUE + '"){"YES"}else{"NO"}'],
        { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      return String(out.stdout).trim() === 'YES';
    } catch (_) { return await regValueExists(STARTUP_VALUE); }
  }
  /* 读注册表值实际指向的 exe 路径（PowerShell 原生 Unicode，绕开 reg query 的 GBK 乱码） */
  async function psAutostartPath() {
    try {
      const out = await execFileAsync('powershell', ['-NoProfile', '-Command',
        '$k="HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";' +
        '(Get-ItemProperty -Path $k -Name "' + STARTUP_VALUE + '" -ErrorAction Stop)."' + STARTUP_VALUE + '"'],
        { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      const m = String(out.stdout).trim().match(/"([^"]+)"/);
      return m ? m[1] : String(out.stdout).trim();
    } catch (_) { return ''; }
  }
  async function readStartupSettings() {
    if (process.platform === 'darwin') {
      if (!app.isPackaged) return { supported: false, enabled: false };
      try { return { supported: true, enabled: !!app.getLoginItemSettings().openAtLogin }; }
      catch (e) { log('[startup] read failed: ' + e.message); return { supported: false, enabled: false }; }
    }
    if (process.platform !== 'win32') return { supported: false, enabled: false };
    const marker = await readStartupMarker();
    const inRegistry = await psAutostartExists();
    const markerMatches = samePath(marker.path, startupPath);
    const duplicates = [];
    for (const n of LEGACY_VALUES) { if (await regValueExists(n)) duplicates.push('注册表项 ' + n); }
    existingStartupShortcuts().forEach(p => duplicates.push('启动文件夹 ' + path.basename(p)));
    return {
      supported: true,
      /* 只有「注册表里确实有 · 且登记的路径就是当前 exe」才算真正生效 */
      enabled: !!(inRegistry && markerMatches),
      inRegistry: inRegistry,
      registeredPath: typeof marker.path === 'string' ? marker.path : '',
      currentPath: startupPath,
       
      mismatched: !!(inRegistry && !markerMatches),
      duplicates: duplicates
    };
  }
  /* 开发态绝不能碰注册表：`electron .` 时 startupPath = node_modules\electron\dist\electron.exe，
     adopt 会把它当基准记进 marker、heal 会把用户真实的自启项重写成它——一次 `npm start` 就静默弄坏开机自启。
     显式设置 PORTABLE_EXECUTABLE_FILE 视为「按便携版语义跑」，不在拦截范围（与真实安装包同源逻辑）。 */
  function devStartupBlocked() {
    return !app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
  }
  /* 首次在新版逻辑下启动：把安装器已有的自启状态「记账」成本程序的基准状态，
     否则老用户会看到开关显示为关（虽然系统里其实是开的）。 */
  async function adoptStartupState() {
    if (process.platform !== 'win32' || devStartupBlocked()) return;
    /* 临时位置的实例不写基准 marker：否则 startup.json 记成 %TEMP%\shiji-verify\时迹.exe，
       之后开机自检会把这条当"正确路径"，与 0.7 要修的正是同一类病 */
    if (isEphemeralExe(startupPath)) { log('[startup] adopt 跳过（当前程序位于临时目录）' + startupPath); return; }
    try {
      const marker = await readStartupMarker();
      if (marker && marker.path) return;
      if (await psAutostartExists() || existingStartupShortcuts().length) {
        await writeStartupMarker({ enabled: true, path: startupPath, at: Date.now(), adopted: true });
        log('[startup] adopted existing autostart state');
      }
    } catch (_) {}
  }
  

  async function healStartupPaths() {
    if (process.platform !== 'win32') return null;
    if (devStartupBlocked()) { log('[startup] dev 实例（electron . 且未设 PORTABLE_EXECUTABLE_FILE），跳过自启登记与自愈'); return null; }
    try {
      const marker = await readStartupMarker();
      /* heal 走启动路径：先读一次值本体，非空即说明键存在（我们只会写入带引号的路径），
         读不到才再判存在性——避免为同一个键固定 spawn 两次 PowerShell。 */
      const cur = await psAutostartPath();
      const inRegistry = !!cur || await psAutostartExists();
      /* 显式关过自启（marker.enabled 为布尔）优先于注册表残留值：不能把用户关掉的自启又打开；
         老数据没有 marker 时回落到「值存在即视为开」 */
      const markerEnabled = (marker.enabled === true || marker.enabled === false) ? marker.enabled : undefined;
      const wantEnabled = decideWantEnabled(markerEnabled, inRegistry);
      for (const n of LEGACY_VALUES) { await regDeleteValue(n); }
      const d = decideStartupWrite({
        wantEnabled: wantEnabled,
        inRegistry: inRegistry,
        pathMatches: sameExePath(cur, startupPath),
        ephemeral: isEphemeralExe(startupPath),   /* 从 %TEMP%\shiji-verify 等临时位置启动：不登记、也不改写 */
      });
      if (d.write) {
        

        await regWriteValue(STARTUP_VALUE, '"' + startupPath + '"');
        if (cur) log('[startup] heal: rewrote autostart path (' + d.reason + ') ' + cur + ' -> ' + startupPath);
      } else if (d.reason === 'ephemeral') {
        log('[startup] heal: 当前程序位于临时目录，跳过自启登记 ' + startupPath);
      }
      const quarantined = await quarantineStartupShortcuts();
      const result = { enabled: wantEnabled, write: d.write, reason: d.reason, quarantined: quarantined, at: Date.now() };
      log('[startup] heal: ' + JSON.stringify(result));
      return result;
    } catch (e) {
      log('[startup] heal failed: ' + ((e && e.message) || e));
      return null;
    }
  }
  ipcMain.handle('hb-startup-get', async () => await readStartupSettings());
  

  ipcMain.handle('hb-startup-set', async (event, enabled) => {
    if (!fromMainWindow(event)) { log('[hb-startup-set] 非主窗发送方，忽略'); return await readStartupSettings(); }
    if (typeof enabled !== 'boolean') throw new TypeError('Expected a boolean startup setting');
    if (process.platform === 'darwin') {
      if (!app.isPackaged) return await readStartupSettings();
      app.setLoginItemSettings({ openAtLogin: enabled });
      return await readStartupSettings();
    }
    if (process.platform !== 'win32') return await readStartupSettings();
    if (enabled) {
      /* 写唯一事实来源（带引号，兼容含空格的安装路径） */
      const ok = await regWriteValue(STARTUP_VALUE, '"' + startupPath + '"');
       
      for (const n of LEGACY_VALUES) { await regDeleteValue(n); }
      const quarantined = await quarantineStartupShortcuts();
      /* Electron 自己那条（electron.app.Electron）也强制摘掉 */
      try { app.setLoginItemSettings({ openAtLogin: false }); } catch (_) {}
      await writeStartupMarker({ enabled: true, path: startupPath, at: Date.now(), wroteRegistry: ok });
      log('[startup] enabled -> ' + startupPath + (ok ? '' : ' (registry write FAILED)') + ' | quarantined=' + JSON.stringify(quarantined));
    } else {
      await regDeleteValue(STARTUP_VALUE);
      for (const n of LEGACY_VALUES) { await regDeleteValue(n); }
      const quarantined = await quarantineStartupShortcuts();
      try { app.setLoginItemSettings({ openAtLogin: false }); } catch (_) {}
      await writeStartupMarker({ enabled: false, path: startupPath, at: Date.now() });
      log('[startup] disabled | quarantined=' + JSON.stringify(quarantined));
    }
    return await readStartupSettings();
  });

  // —— 窗口控制 IPC ——
  // 最小化正常留在 Windows 任务栏；托盘图标始终保留。
  ipcMain.handle('hb-minimize', (event) => {
    if (!fromMainWindow(event)) { log('[hb-minimize] 非主窗发送方，忽略'); return false; }
    try {
      if (win && !win.isDestroyed()) {
        /* 贴纸态与「收进托盘」都会 setSkipTaskbar(true)；那时再最小化 = 任务栏没按钮、
           Alt+Tab 里却留一张缩略图的幽灵条目（用户截图那个「时迹」小条）。
           按钮的标题是「最小化到任务栏」，那就必须真的有任务栏按钮。 */
        try { win.setSkipTaskbar(false); } catch (_) {}
        win.minimize();
      }
    } catch (e) { log('[hb-minimize] ' + (e && e.message ? e.message : String(e))); }
  });
  ipcMain.handle('hb-open-data-dir',async event=>{
    if(!win||event.sender!==win.webContents)return {ok:false,message:'仅主窗口可打开数据目录'};
    const message=await shell.openPath(store._internal.loadConfig().root);
    return {ok:!message,message};
  });
  ipcMain.handle('hb-copy-diagnostics',event=>{
    if(!win||event.sender!==win.webContents)return {ok:false,message:'仅主窗口可复制诊断'};
    const doc=store._internal.peekDoc()||{},status=store._internal.backupStatus();
    const diagnostic={appVersion:app.getVersion(),build:APP_BUILD,electron:process.versions.electron,chrome:process.versions.chrome,platform:process.platform,arch:process.arch,osRelease:require('os').release(),dataVersion:doc.meta&&doc.meta.version,portable:status.portable,records:Object.keys(doc.days||{}).length,habits:(doc.habits||[]).length,notes:(doc.memoNotes||[]).length,backups:status.count,displays:screen.getAllDisplays().map(d=>({scaleFactor:d.scaleFactor,width:d.size.width,height:d.size.height})),windows:BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),width:w.getBounds().width,height:w.getBounds().height})),notificationsSupported:Notification.isSupported()};
    clipboard.writeText(JSON.stringify(diagnostic,null,2));return {ok:true};
  });
  // 页面关闭按钮：发送者感知。
  // 主窗关闭 = 收进托盘（hide() 后不可见即已不在 Alt+Tab；setSkipTaskbar 仅去任务栏按钮，两者互不影响）；
  // 贴纸/编辑窗关闭 = 回收自身。
  // 真正退出仅通过托盘右键“退出”（isQuitting=true → app.quit()）。
  ipcMain.handle('hb-close', (event) => {
    try {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (senderWin && editorWin && !editorWin.isDestroyed() && senderWin.id === editorWin.id) {
        editorWin.close();
      } else if (win && !win.isDestroyed()) {
        try { win.setSkipTaskbar(true); } catch (_) {}
        win.hide();
      }
    } catch (e) { log('[hb-close] ' + (e && e.message ? e.message : String(e))); }
  });
  // 锁定便签：普通窗口 + 失焦自动沉底（不再挂桌面 WorkerW 层，杜绝跨进程合成闪退）。
  // 锁定 = 去置顶 + 去任务栏按钮；窗口当前在前台则保持原位展示便签形态。
   
  //   1) 不再 setMovable(false)——Windows 下会连原生拖区一起禁掉，导致锁定便签拖不动；
  //      改为保留可移动，拖动由页面四边热区指针事件 + hb-window-drag IPC 控制（与顶部拖拽同方案）。
   
  //      现失焦不动作；最小化/隐藏仍由托盘恢复。
  // desktop-layer.exe 缺失时静默降级为「去置顶普通窗口」（无压底但绝不闪退）。
  ipcMain.handle('hb-set-locked', (_event, locked, size) => {
    log('set-locked: ' + !!locked);
    

    try {
      const sw = BrowserWindow.fromWebContents(_event.sender);
      log('[hb-set-locked] 发送方 ' + (sw ? ('win:"' + sw.getTitle() + '"' + (sw === win ? '=主窗' : (sw === editorWin ? '=编辑窗' : '=其它')) + ' sticky=' + !!sw._isSticky) : '未知') + ' locked=' + !!locked);
    } catch (_) {}
    if (!win || win.isDestroyed()) return false;
    const isLocked = !!locked;
    try {
      try { win.setAlwaysOnTop(false); } catch (_) {}
      if (isLocked) {
        winLocked = true;
        /* 关键：锁定前先回收已存在的编辑窗——否则随后 openNote→editorOpen 会「复用」旧编辑窗
           （无 ?sticky=1 → 贴纸不极简、按钮不显示、位置不跳右上），必须重建为贴纸形态窗口。
           F2：走 killEditorWindow（先 hide 再 destroy），不对可见窗口裸 destroy。 */
        try { killEditorWindow('set-locked'); } catch (_) {}
        try { win.setSkipTaskbar(true); } catch (_) {}   // 只去任务栏按钮；Alt+Tab 由编辑窗的 WS_EX_TOOLWINDOW 负责
        // 贴纸尺寸 = 用户上次手动拉伸的记忆（页面拉伸结束写 localStorage → 锁定时随 IPC 带上来）；
         
        // 仅在「未锁定→锁定」时捕获原窗尺寸；重复锁定不得把贴纸尺寸存成恢复目标（否则解锁后窗口扁的）
        let sw = 360, sh = 580, sx = null, sy = null;
        /* 问题 6：下限跟随锁定态最小尺寸（200×160），否则用户缩到 200×160 后记忆尺寸会被丢弃 */
        if (size && size.width >= 200 && size.width <= 3000 && size.height >= 160 && size.height <= 3000) {
          sw = Math.round(size.width); sh = Math.round(size.height);
        }
        

        if (size && Number.isFinite(Number(size.x)) && Number.isFinite(Number(size.y))) {
          sx = Math.round(Number(size.x)); sy = Math.round(Number(size.y));
        }
        /* 问题 6：锁定态最小尺寸下调到 200×160（原 320×220 让用户「缩到一定大小就缩不动」） */
        try { win.setMinimumSize(200, 160); win.setSize(sw, sh); } catch (_) {}
        stickyFitSuppressed = false;                  /* 进入锁定：重置「手动拉伸过」标记 */
        stickyPosPinned = (sx === null || sy === null);/* 有记忆坐标 → 不随尺寸变化重贴右上角 */
        if (sx !== null && sy !== null) {
          try {
            const wa2 = screen.getPrimaryDisplay().workArea;
            const sc2 = screen.getPrimaryDisplay().bounds;
            /* v2.2.2：除工作区钳制外，再保证底/右边不贴死屏幕边缘（防 DWM 长高） */
            const sx2 = Math.max(sc2.x + 2 - sw, Math.min(sc2.x + sc2.width - 2, sx));
            const sy2 = Math.max(sc2.y + 2 - sh, Math.min(sc2.y + sc2.height - 2, sy));
            /* v2.2.2：显式宽高 setBounds（防 setPosition 净增高度） */
            win.setBounds({
              x: Math.max(wa2.x, Math.min(sx2, wa2.x + wa2.width - sw)),
              y: Math.max(wa2.y, Math.min(sy2, wa2.y + wa2.height - sh)),
              width: sw, height: sh
            });
          } catch (_) { pinLockedTopRight(); }
        } else {
          // 锁定后自动跳到桌面右上角（保留 16px 边距，不挡任务栏/便签图标）
           
          // 避免“闪一下/缩小一下”的可见过渡。
          pinLockedTopRight();
        }
        // 锁定收尾再兜一次（此刻主窗已就位可见），确保 Alt+Tab 里只剩主窗这一条
        try { killEditorWindow('set-locked-final'); } catch (_) {}
        if (!winLockBlurHandler) {
          winLockBlurHandler = onWinLockedBlur;
          win.on('blur', winLockBlurHandler);
        }
      } else {
        winLocked = false;
        if (winLockBlurHandler) {
          win.removeListener('blur', winLockBlurHandler);
          winLockBlurHandler = null;
        }
        try { win.setMovable(true); } catch (_) {}
        try { win.setSkipTaskbar(false); } catch (_) {}
        // 解锁恢复为「刚启动时的窗口大小 + 居中」（用户明确要求，而非锁定时尺寸）
        try { win.setMinimumSize(320, 480); } catch (_) {}
         
        stickyFitSuppressed = false;
        stickyPosPinned = true;
        try {
          if (startupBounds && startupBounds.width >= 320 && startupBounds.height >= 220) {
            win.setSize(startupBounds.width, startupBounds.height);
            win.center();
          } else { win.center(); }
        } catch (_) {}
        // sanity：若恢复后高度异常偏扁（<420，如误存了贴纸尺寸），回退默认主窗高度，避免“解锁后窗口扁的”
        try {
          const b = win.getBounds();
          if (b.height < 420) { win.setBounds({ x: b.x, y: b.y, width: Math.max(430, trustedW(win)), height: 720 }); }
        } catch (_) {}
        try { if (win.isMinimized()) win.restore(); } catch (_) {}
        try { destroyExtraWindows(); } catch (_) {}
        try { win.show(); win.focus(); } catch (_) {}
      }
      return {
        locked: isLocked,
        mode: isLocked ? 'bottom-layer' : 'normal',
        alwaysOnTop: false,
        movable: typeof win.isMovable === 'function' ? win.isMovable() : !isLocked,
        skipTaskbar: typeof win.isSkipTaskbar === 'function' ? win.isSkipTaskbar() : isLocked
      };
    } catch (_) { return false; }
  });
  ipcMain.handle('hb-set-topmost', (_event, enabled) => {
    

    if (!fromMainWindow(_event)) { log('[hb-set-topmost] 非主窗发送方，拒绝（enabled=' + enabled + '）'); return false; }
    try { if (win && !win.isDestroyed()) { win.setAlwaysOnTop(!!enabled); return !!enabled; } } catch (_) {}
    return false;
  });
  

  ipcMain.handle('hb-win-size', (event) => {
    try {
      const w = BrowserWindow.fromWebContents(event.sender);
      if (!w || w.isDestroyed()) return null;
      const b = w.getBounds();
      return { width: b.width, height: b.height };
    } catch (_) { return null; }
  });
  // 无边框窗拖拽后的鼠标捕获复位：Windows 下 drag 区拖完窗口可能残留捕获，
  // 表现为"接下来点按钮 click 被吞"。把窗口位移 1px 再移回，强制重新 hit-test（视觉无感）。
  ipcMain.handle('hb-nudge', (event) => {
    if (NUDGE_OFF) {   /* 临时对照实验：禁用微移，看增长是否停止 */
      if (!nudgeOffLogged) { nudgeOffLogged = true; log('[nudge] IPC 微移已禁用（HB_NO_NUDGE=1）'); }
      return;
    }
     
    const w = BrowserWindow.fromWebContents(event.sender) || win;
    if (!w || w.isDestroyed()) return;
    if (!nudgeGateOpen()) return;   /* ★ 同 resize 侧：闸门关闭期内不做微移（否则两侧互相接力成自激循环） */
    try {
      performNudge(w);
    } catch (_) {}
  });
  // 锁定后由渲染进程测出 memo 真实内容高度，传过来把窗口高度贴底自适应（短内容不留白、长内容不裁切）。
  // 受屏幕工作区限制，避免小屏被压到屏幕外。
  ipcMain.on('hb-fit-locked-content', (_event, payload) => {
     
    if (!fromMainWindow(_event)) { log('[hb-fit-locked-content] 非主窗发送方，拒绝'); return; }
    if (!win || win.isDestroyed() || !winLocked) return;
    

    if (manualWindowResize) return;
    if (stickyFitSuppressed) return;
    const h = Number(payload && payload.height);
    if (!Number.isFinite(h) || h <= 0) return;
    try {
      const wa = screen.getPrimaryDisplay().workArea;
      const margin = 16;
      const maxH = wa.height - margin * 2;
      const minH = 160;   /* 问题 6：与 clampResizeRect 锁定态下限一致，允许缩到很小的便签 */
      const targetH = Math.max(minH, Math.min(maxH, Math.round(h)));
      const b = win.getBounds();
      // 阈值 8px：尺寸已一致则不再 resize（杜绝可见二次缩放/闪烁），但允许收敛复测微调
      if (Math.abs(targetH - b.height) >= 8) {
        /* v2.2.2 终版：宽度取可信缓存——形态切换反复触发本链路，镜头宽度谎言会被物化成真实变宽 */
        win.setSize(trustedW(win), targetH);
        // 高度变了：默认重新贴右上角；若本次是「启动自动贴回用户记忆位置」则保留 x/y 只做工作区钳制
        if (stickyPosPinned) pinLockedTopRight();
        else clampWindowIntoWorkArea();
      }
    } catch (_) {}
  });
  // 不使用 -webkit-app-region:drag：该原生命中区在 Windows 缩放窗口后可能吞掉点击。
  // 页面只把非交互顶栏区域的拖动坐标传来，主进程据此移动窗口。
  // 锁定态走同一 IPC：四边 lock-edge 热区用指针事件手动移动窗口（不依赖 setMovable）。
  ipcMain.on('hb-window-drag-start', event => {
    if (!win || win.isDestroyed()) return;
    // 移除 !win.isMovable() 守卫：锁定便签 setMovable(false) 后仍可拖（页面热区手动移动）
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || w.isDestroyed()) return;
    const revision=++windowGestureRevision;
    manualWindowResize=null;
    const p = w.getPosition();
    const c = screen.getCursorScreenPoint();
    

    const b = w.getBounds();
    const tb = trustedSizeByWC.get(event.sender.id);   /* ★ 基准优先取可信缓存，绝不回读镜头 */
    manualWindowDrag = { senderId: event.sender.id, revision, startX: p[0], startY: p[1], cursorX: c.x, cursorY: c.y,
                         w0: (tb && tb.w > 50) ? tb.w : b.width,
                         h0: (tb && tb.h > 50) ? tb.h : b.height,
                         lastX: p[0], lastY: p[1] };
  });
  ipcMain.on('hb-window-drag-move', (event, point) => {
     
    if (!manualWindowDrag || manualWindowDrag.senderId !== event.sender.id) return;
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || w.isDestroyed()) return;
    const c = screen.getCursorScreenPoint();
    try {
      const x = manualWindowDrag.startX + c.x - manualWindowDrag.cursorX;
      const y = manualWindowDrag.startY + c.y - manualWindowDrag.cursorY;
      /* ★ v2.2.2 终版：拖动每步都显式重申冻结尺寸 w0/h0（见 drag-start 注释）。
         钳制也用 w0/h0 而非实时尺寸，右/下边界余量按基准计算不随漂移变化。 */
      const safe = clampXYIntoScreen(x, y, manualWindowDrag.w0, manualWindowDrag.h0);
      w.setBounds({ x: safe.x, y: safe.y, width: manualWindowDrag.w0, height: manualWindowDrag.h0 });
      manualWindowDrag.lastX = safe.x;
      manualWindowDrag.lastY = safe.y;
    } catch (_) {}
  });
  ipcMain.on('hb-window-drag-end', event => {
    if (!manualWindowDrag || manualWindowDrag.senderId === event.sender.id) {
      

      try {
        const s = manualWindowDrag;
        if (s && typeof s.w0 === 'number') {
          const w2 = BrowserWindow.getAllWindows().find(x => x.webContents && x.webContents.id === s.senderId);
          if (w2 && !w2.isDestroyed()) {
            w2.setBounds({ x: s.lastX, y: s.lastY, width: s.w0, height: s.h0 });
            let tries = 0;
            const vt = setInterval(() => {
              tries++;
              try {
                if (w2.isDestroyed() || tries > 6 || windowGestureRevision!==s.revision ||
                    (manualWindowDrag && manualWindowDrag !== s)) { clearInterval(vt); return; }
                const b = w2.getBounds();
                if (b.width === s.w0 && b.height === s.h0) { clearInterval(vt); return; }
                w2.setBounds({ x: s.lastX, y: s.lastY, width: s.w0, height: s.h0 });
              } catch (_) { clearInterval(vt); }
            }, 160);
          }
        }
      } catch (_) {}
      manualWindowDrag = null;
    }
  });
   
  // 页面四角(.lock-corner)与未锁定态左右下边(.resize-edge)热区把 方向dir + 帧位移 发来，
  // 这里按“固定对边”原则改矩形并钳制（最小尺寸/不出屏），setBounds 不经 OS 活缩放 → 无方形闪烁。
  // dir ∈ n/s/e/w/ne/nw/se/sw；锁定态缩放结束自动贴回右上角（与 Round5 行为一致）。
  ipcMain.on('hb-window-resize-start', event => {
    if (!win || win.isDestroyed()) return;
    const w=BrowserWindow.fromWebContents(event.sender);
    if(!w||w.isDestroyed())return;
    windowGestureRevision++;
    manualWindowDrag=null;
    manualWindowResize = { senderId: event.sender.id };
    

    if (winLocked && event.sender === win.webContents) {
      stickyFitSuppressed = true;
      stickyPosPinned = false;
    }
  });
  ipcMain.on('hb-window-resize-move', (event, payload) => {
    if (!manualWindowResize || manualWindowResize.senderId !== event.sender.id) return;
     
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || w.isDestroyed()) return;
    const dir = String(payload && payload.dir || 'se');
    let dx = Number(payload && payload.dx), dy = Number(payload && payload.dy);
    if (!Number.isFinite(dx)) dx = 0;
    if (!Number.isFinite(dy)) dy = 0;
    if (!dx && !dy) return;
    try {
      const b = w.getBounds();
      

      const tw = trustedW(w), th = trustedH(w);
      let nx = b.x, ny = b.y, nw = tw, nh = th;
      if (dir.indexOf('e') >= 0) nw += dx;
      if (dir.indexOf('s') >= 0) nh += dy;
      if (dir.indexOf('w') >= 0) { nw -= dx; nx += dx; }
      if (dir.indexOf('n') >= 0) { nh -= dy; ny += dy; }
      w.setBounds(clampResizeRect(nx, ny, nw, nh,dir,{x:b.x,y:b.y,width:tw,height:th}));
    } catch (_) {}
  });
  ipcMain.on('hb-window-resize-end', event => {
    if (!manualWindowResize || manualWindowResize.senderId === event.sender.id) manualWindowResize = null;
    if (!win || win.isDestroyed()) return;
    // 锁定贴纸：缩放松手后只把窗口钳制回工作区内，不再无条件贴回右上角。
     
     
    if (winLocked && event.sender===win.webContents) {
      try {
        const b = win.getBounds();
        const wa = screen.getDisplayMatching(b).workArea;
        const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width));
        const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height));
        /* v2.2.2：显式宽高 setBounds（防 setPosition 净增高度）；尺寸取可信缓存（镜头 +1 物化防线） */
        if (x !== b.x || y !== b.y) win.setBounds({ x: Math.round(x), y: Math.round(y), width: trustedW(win), height: trustedH(win) });
      } catch (_) {}
    }
  });

  app.whenReady().then(() => {
    

    try {
      const { session } = require('electron');
      const ses = session.defaultSession;
      if (ses) {
        ses.setPermissionRequestHandler(function (wc, perm, cb) { log('[perm] 拒绝权限请求: ' + perm); cb(false); });
        ses.setPermissionCheckHandler(function () { return false; });
      }
    } catch (e) { log('permission handler 挂载失败: ' + ((e && e.message) || e)); }
    /* 启动横幅：每次启动都写一行 build + exe 路径，用来核验「新启动的确实是新版、且是安装目录那一份」 */
    log('=== 时迹 start · build ' + APP_BUILD + ' · exe=' + process.execPath + ' · userData=' + app.getPath('userData') + ' ===');
    /* 数据层必须先于任何窗口挂好 IPC/协议：主窗 loadFile 后页面 boot 第一步就 sendSync 读档 */
    try { store.attachProtocol(protocol); } catch (e) { log('store.attachProtocol 失败: ' + ((e && e.message) || e)); }
    try { store.registerIpc(); } catch (e) { log('store.registerIpc 失败: ' + ((e && e.message) || e)); }
     
    ipcMain.handle('hb-get-theme', () => ({ dark: nativeTheme.shouldUseDarkColors }));
    try {
      nativeTheme.on('updated', () => {
        try {
          BrowserWindow.getAllWindows().forEach(w => { try { if (!w.isDestroyed()) w.webContents.send('hb-theme-changed', { dark: nativeTheme.shouldUseDarkColors }); } catch (_) {} });
        } catch (_) {}
      });
    } catch (e) { log('nativeTheme watch 失败: ' + ((e && e.message) || e)); }
    /* 孤儿图片延迟回收（仅清理未被引用且 mtime>7 天的文件，刚写入/未保存的天然安全） */
    setTimeout(function () { try { store._internal.gcImages(); } catch (_) {} }, 8000);
    

    setTimeout(function () { safeRemindCheck('startup'); }, 10000);
    setInterval(function () { safeRemindCheck('interval30s'); }, 30000);
    safeCarryoverCheck('startup');   
    

    try {
      const { powerMonitor } = require('electron');
      powerMonitor.on('resume', function () {
        try { log('[remind] resume：唤醒后补查'); } catch (_) {}
        safeCarryoverCheck('resume');
        safeRemindCheck('resume');
      });
    } catch (e) { log('powerMonitor watch 失败: ' + ((e && e.message) || e)); }
    /* 四步各自兜底：自启状态/注册表自愈/托盘任一抛错，都不能连累主窗口创建 */
    (async function () {
      try { await adoptStartupState(); } catch (e) { log('adoptStartupState 失败: ' + ((e && e.message) || e)); }   /* 问题 8：登记自启基准，避免开关显示与真实情况不符 */
      try { await healStartupPaths(); } catch (e) { log('healStartupPaths 失败: ' + ((e && e.message) || e)); }     /* F5：自启通路收敛到 HKCU\Run\时迹 */
      try { createTray(); } catch (e) { log('createTray 失败: ' + ((e && e.message) || e)); }
      try { create(); } catch (e) { log('create 失败: ' + ((e && e.stack) || e)); }
      app.on('activate', showWindow);
    })();
  });
}



let quitFlushDone = false;
let quitSaveInProgress = false;
app.on('before-quit', (e) => {
  isQuitting = true;
  if (!quitFlushDone && store.drainWrites) {
    e.preventDefault();
    if (quitSaveInProgress) return;
    quitSaveInProgress = true;
    Promise.resolve()
      .then(function(){return flushWindowDrafts(true);})
      .then(function () { return store.drainWrites(); })
      .then(function () { quitFlushDone = true; quitSaveInProgress = false; log('[quit] drainWrites 完成，正式退出'); app.quit(); })
      .catch(function(error){
        isQuitting = false; quitSaveInProgress = false;
        log('[quit] 保存失败，已取消退出：' + error.message);
        BrowserWindow.getAllWindows().forEach(function(w){if(!w.isDestroyed())w.webContents.executeJavaScript('document.body.inert=false').catch(()=>{});});
        if (win && !win.isDestroyed()) { win.show(); win.webContents.send('hb-data-save-state', { state:'error', message:error.message }); }
        const { dialog } = require('electron');
        dialog.showMessageBox({type:'error',title:'未能保存',message:'退出已取消，尚有内容未保存。',detail:error.message,buttons:['返回应用']});
      });
    return;
  }
  try { log('[quit] before-quit'); } catch (_) {}
});
app.on('will-quit', () => { try { log('[quit] will-quit'); } catch (_) {} });
app.on('window-all-closed', () => app.quit());
