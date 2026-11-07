// HabitCheck · preload bridge
// 把窗口控制能力通过 contextBridge 暴露给页面 (window.hbShell)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hbShell', {
  nudge: () => ipcRenderer.invoke('hb-nudge'),
  getStartup: () => ipcRenderer.invoke('hb-startup-get'),
  setStartup: enabled => ipcRenderer.invoke('hb-startup-set', enabled),
  beginWindowDrag: () => ipcRenderer.send('hb-window-drag-start'),
  moveWindowDrag: (dx, dy) => ipcRenderer.send('hb-window-drag-move', { dx, dy }),
  endWindowDrag: () => ipcRenderer.send('hb-window-drag-end'),
  beginWindowResize: dir => ipcRenderer.send('hb-window-resize-start', { dir }),
  moveWindowResize: (dir, dx, dy) => ipcRenderer.send('hb-window-resize-move', { dir, dx, dy }),
  endWindowResize: () => ipcRenderer.send('hb-window-resize-end'),
  minimize: () => ipcRenderer.invoke('hb-minimize'),
  close: () => ipcRenderer.invoke('hb-close'),
  /* size 可带 x/y：启动「自动贴回上次便签」时用来还原用户记忆的屏幕位置（问题 5） */
  setLocked: (locked, size) => ipcRenderer.invoke('hb-set-locked', !!locked, size ? { width: size.width, height: size.height, x: size.x, y: size.y } : null),
  setTopmost: enabled => ipcRenderer.invoke('hb-set-topmost', !!enabled),
  fitLockedContent: height => ipcRenderer.send('hb-fit-locked-content', { height }),
  fitSelf: height => ipcRenderer.send('hb-sticky-fit-self', height),
  

  winSize: () => ipcRenderer.invoke('hb-win-size'),
   
  

  editorOpen: noteId => ipcRenderer.invoke('hb-editor-open', String(noteId == null ? '' : noteId)),
  editorBack: target => ipcRenderer.invoke('hb-editor-back', typeof target === 'string' ? target : ''),   /* target：回主窗后要落的页面 id（3.1.0 贴纸待办卡「打开待办」） */
  pinNote: noteId => ipcRenderer.invoke('hb-pin-note', String(noteId)),
  /* —— v2.1 数据层（store.js 主进程持锁，localStorage 只作迁移源） ——
     load/migrate 用 sendSync：仅 boot 各一次、主进程内存直出，保证既有同步启动流程零改动；
     写路径全部走异步 IPC，按「字段属主」提交（主窗/编辑窗各自拥有字段见 habit.html save()）。 */
  dataLoadSync: () => ipcRenderer.sendSync('hb-data:load-sync'),
  dataMigrateSync: raw => ipcRenderer.sendSync('hb-data:migrate-sync', String(raw == null ? '' : raw)),
  dataSave: (token, fields) => ipcRenderer.send('hb-data:save', String(token || ''), fields),
  dataCommit: (token, fields) => ipcRenderer.invoke('hb-data:commit', String(token || ''), fields),
  onSaveState: cb => {
    const h = (_e, value) => cb(value);
    ipcRenderer.on('hb-data-save-state', h);
    return () => ipcRenderer.removeListener('hb-data-save-state', h);
  },
   
  dataSaveSync: (token, fields) => ipcRenderer.sendSync('hb-data:save-sync', String(token || ''), fields),
  dataNoteOrder: (token, list) => ipcRenderer.invoke('hb-data:note-order-commit', String(token || ''), list),
  writeImage: dataUrl => ipcRenderer.invoke('hb-data:write-image', dataUrl),
  readImage: ref => ipcRenderer.invoke('hb-data:read-image', ref),
  exportDoc: () => ipcRenderer.invoke('hb-data:export-doc'),
  importDoc: (token, fields) => ipcRenderer.invoke('hb-data:import-doc', String(token || ''), fields),
   
  corruptList: () => ipcRenderer.invoke('hb-data:corrupt-list').then(function (s) {
    try { var v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (_) { return []; }
  }),
  corruptRestore: file => ipcRenderer.invoke('hb-data:corrupt-restore', String(file || '')),
  backupNow: () => ipcRenderer.invoke('hb-data:backup-now'),
  backupStatus: () => ipcRenderer.invoke('hb-data:backup-status'),
  backupHistory: () => ipcRenderer.invoke('hb-data:backup-history').then(s => { try { return JSON.parse(s); } catch (_) { return []; } }),   /* handler 异常返回 undefined 时不再抛 SyntaxError，降级为空列表提示 */
  backupPreview: name => ipcRenderer.invoke('hb-data:backup-preview',String(name||'')),
  backupRestore: (name,token) => ipcRenderer.invoke('hb-data:backup-restore',String(name||''),String(token||'')),
  openDataDir: () => ipcRenderer.invoke('hb-open-data-dir'),
  copyDiagnostics: () => ipcRenderer.invoke('hb-copy-diagnostics'),
  configGet: () => ipcRenderer.invoke('hb-config:get'),
  configSet: patch => ipcRenderer.invoke('hb-config:set', patch),
  setDataRoot: patch => ipcRenderer.invoke('hb-data:set-root', patch),
  purgeOldRoot: () => ipcRenderer.invoke('hb-data:purge-old-root'),
  pickDir: () => ipcRenderer.invoke('hb-data:pick-dir'),
   
  getTheme: () => ipcRenderer.invoke('hb-get-theme'),
  onThemeChanged: cb => {
    const h = (_e, p) => { try { cb(p); } catch (_) {} };
    ipcRenderer.on('hb-theme-changed', h);
    return () => ipcRenderer.removeListener('hb-theme-changed', h);
  },
  /* 主进程数据变更广播：payload={scopes:[...], gen}；返回退订函数 */
  onDataChanged: cb => {
    const h = (_e, p) => { try { cb(p); } catch (_) {} };
    ipcRenderer.on('hb-data-changed', h);
    return () => ipcRenderer.removeListener('hb-data-changed', h);
  },
   
  onRemind: cb => {
    const h = (_e, n) => { try { cb(n); } catch (_) {} };
    ipcRenderer.on('hb-remind-banner', h);
    return () => ipcRenderer.removeListener('hb-remind-banner', h);
  },
  /* 主进程整档重载广播（导入/数据目录迁移后）：页面应整体刷新 */
  onDataReloaded: cb => {
    const h = () => { try { cb(); } catch (_) {} };
    ipcRenderer.on('hb-data-reloaded', h);
    return () => ipcRenderer.removeListener('hb-data-reloaded', h);
  },
  

  onDataRejected: cb => {
    const h = (_e, p) => { try { cb(p); } catch (_) {} };
    ipcRenderer.on('hb-data-rejected', h);
    return () => ipcRenderer.removeListener('hb-data-rejected', h);
  }
});
