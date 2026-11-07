/* startup-decide.js —— 开机自启「该不该写注册表」的纯判定（无 IO、无 Electron）
   放出来单独可测：真正跑一次 heal 会写 HKCU\Run，开发态误写会把用户的自启项指向
   node_modules\electron\dist\electron.exe（等于静默弄坏开机自启），不能拿它当测试场。 */
'use strict';
const path = require('path');

/* 路径比较：大小写不敏感、分隔符归一，且能容忍注册表里带引号的值（"C:\...\时迹.exe"） */
function normExe(p) {
  try {
    let s = String(p == null ? '' : p).trim();
    const m = s.match(/^"([^"]+)"$/);
    if (m) s = m[1];
    if (!s) return '';
    return s.replace(/[\\/]/g, '\\').toLowerCase();
  } catch (_) { return ''; }
}

/* wantEnabled 的取法（与原实现逐字等价，只是搬到可测的地方）：
   marker 记着「开」→ 开；其余情形（marker 说关 / 老数据没 marker）一律以注册表是否有值为准——
   因为只要值在，登录时系统就会拉起某个 exe，此时把它指回当前程序比留着旧路径更安全。 */
function decideWantEnabled(markerEnabled, inRegistry) {
  return markerEnabled === true ? true : !!inRegistry;
}

/* 临时/构建产物位置绝不能成为开机自启目标：安装包端到端验证会装到
   %TEMP%\shiji-verify 并在那里启动一次，若照「注册表路径≠当前 exe」无脑改写，
   自启项就会指向一个马上被删掉的目录——开机拉不起来，且用户完全看不出为什么。
   便携包在 artifacts/…、开发态在 node_modules 下同理想排除。 */
function isEphemeralExe(p, env) {
  const s = normExe(p);
  if (!s) return false;                       /* 读不到路径不作判断，交给其它分支 */
  const e = env || process.env;
  const temps = [e.TEMP, e.TMP, e.LOCALAPPDATA ? path.join(e.LOCALAPPDATA, 'Temp') : '']
    .filter(Boolean).map(normExe);
  if (temps.some(t => t && (s === t || s.startsWith(t + '\\')))) return true;
  return /\\node_modules\\|\\shiji-verify\\|\\portable-staging[^\\]*\\|\\win-unpacked\\|\\temp\\/.test(s);
}

function decideStartupWrite(s) {
  s = s || {};
  if (!s.wantEnabled) return { write: false, reason: 'disabled' };          /* 用户根本没开自启：不要替他打开 */
  if (s.ephemeral) return { write: false, reason: 'ephemeral' };            /* 当前程序在临时位置：不配登记 */
  if (!s.inRegistry) return { write: true, reason: 'missing' };             /* 说开了但值不在：补写 */
  if (!s.pathMatches) return { write: true, reason: 'stale-path' };         /* 值指向别的 exe（旧安装路径）：改写为当前程序 */
  return { write: false, reason: 'ok' };
}

/* 注册表值与当前 exe 的比较：注册表里存的是带引号的路径（"C:\...\时迹.exe"），
   直接 path.resolve 会把引号当文件名的一部分 → 永远判不等，每次启动都重写一遍注册表。
   这里先去引号再归一分隔符/大小写。 */
function sameExePath(a, b) {
  const na = normExe(a), nb = normExe(b);
  return !!na && !!nb && na === nb;
}

module.exports = { normExe, sameExePath, isEphemeralExe, decideStartupWrite, decideWantEnabled };
