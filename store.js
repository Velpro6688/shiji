

'use strict';
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const backupHistory = require('./backup-history');

const DATA_VERSION = 2;
const IMG_MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };


const HBIMG_PREFIX = 'hbimg://';
const DEFAULT_CONFIG = { dataDir: '', portable: false, backupIntervalDays: 1, backupKeep: 7 };

/* 顺序迁移表：from<=ver<to 逐级执行。必须幂等（重复执行结果一致），失败不覆盖原数据。 */
const MIGRATIONS = [
  {
    from: 1, to: 2,
    fn(doc) {
      /* v1（localStorage 整包）→ v2：只补结构必需（meta/days）+ 版本号落档。
         habits/profile/settings/memo 的缺省补齐交给渲染层 fillDocDefaults——
         它保留了 habitsCleared 语义（用户删光习惯不得复活），迁移层不得越权。
         图片抽取（dataURL→images/）不放在迁移步骤里：它可能耗时，改为落档后
         后台分块自愈（见 extractInlineImages），且天然幂等。 */
      if (!doc.meta || typeof doc.meta !== 'object') doc.meta = {};
      if (!doc.days || typeof doc.days !== 'object') doc.days = {};
      doc.meta.version = 2;
      return doc;
    }
  }
];

function runMigrations(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  let ver = (doc.meta && Number(doc.meta.version)) || 1;
  for (const m of MIGRATIONS) {
    if (ver >= m.from && ver < m.to) { try { m.fn(doc); } catch (_) { return null; } ver = m.to; }
  }
  return doc;
}

function createStore(opts) {
  const userDataDir = opts.userDataDir;
  const log = opts.log || function () {};
  const getAppVersion = opts.getAppVersion || (() => '2.2.2');
  const broadcast = opts.broadcast || function () {};
  

  const isTrustedSender = typeof opts.isTrustedSender === 'function' ? opts.isTrustedSender : function () { return true; };

  let startupNotice = '';
  let config = loadConfig();
  let root = resolveRoot();
  let previousRoot = null;   /* 上一次的数据根：目录迁移后供「清理旧目录」精准定位，绝不误删当前根 */
  let doc = null;              // 内存唯一存档
  let gen = 0;                 // 变更代次（广播用）
  let writeTimer = null;
  let writing = false;
  let writeFailCount = 0;let writePending = false;
  let lastWriteError = null;
  let rootMoving = false;
  let rootTransition = Promise.resolve();
  const deferredMutations = [];

  /* ─────────────── 配置与根目录 ─────────────── */
  function configFile() { return path.join(userDataDir, 'app-config.json'); }
  function loadConfig() {
    try {
      const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
      return Object.assign({}, DEFAULT_CONFIG, (c && typeof c === 'object') ? c : {});
    } catch (_) { return Object.assign({}, DEFAULT_CONFIG); }
  }
  function saveConfig(strict) {
    try { atomicWrite(configFile(), JSON.stringify(config, null, 2)); } catch (e) { log('[store] config write failed: ' + e.message); if (strict) throw e; }
  }
  function writableTest(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, '.hb-write-test'); fs.writeFileSync(p, 'ok'); fs.unlinkSync(p); return true; } catch (_) { return false; }
  }
  function resolveRoot() {
    if (config.portable) {
      try {
        const exeDir = portableDirectory();
        if (!exeDir) throw new Error('开发环境不使用便携数据目录');
        const pdir = path.join(exeDir, 'data');
        if (writableTest(pdir)) {
          /* An empty stable portable root may safely inherit the original profile.
             Never replace an existing portable document or delete the source. */
          const source = path.join(userDataDir, 'data.json'), target = path.join(pdir, 'data.json');
          if (path.resolve(pdir)!==path.resolve(userDataDir)&&!fs.existsSync(target)&&fs.existsSync(source)) {
            const bytes = fs.readFileSync(source), original = JSON.parse(bytes);
            if (!original || !original.days || Array.isArray(original.days)) throw new Error('原存档格式异常');
            const sourceImages = path.join(userDataDir,'images'), targetImages = path.join(pdir,'images');
            if (fs.existsSync(sourceImages)) {
              fs.mkdirSync(targetImages,{recursive:true});
              for (const file of fs.readdirSync(sourceImages)) {
                const a=path.join(sourceImages,file),b=path.join(targetImages,file);
                if (!fs.statSync(a).isFile()) continue;
                if (fs.existsSync(b)&&!fs.readFileSync(a).equals(fs.readFileSync(b))) throw new Error('便携目录存在不同的图片');
                fs.copyFileSync(a,b);
              }
              verifyImages(sourceImages,targetImages);
            }
            if (fs.existsSync(path.join(userDataDir,'auto-backup'))) fs.cpSync(path.join(userDataDir,'auto-backup'),path.join(pdir,'auto-backup'),{recursive:true});
            atomicWrite(target,bytes);
            startupNotice='已从原数据目录接续记录，原存档仍完整保留。';
            log('[store] adopted original profile into stable portable root');
          }
          return pdir;
        }
        log('[store] portable dir not writable, fallback to userData');
      } catch (_) {}
    }
    if (config.dataDir && writableTest(config.dataDir)) return config.dataDir;
    return userDataDir;
  }
  function p(rel) { return path.join(root, rel); }
  function portableDirectory() {
    if (opts.portableAllowed === false) return null;
    return opts.portableExeDir || process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath);
  }

  /* ─────────────── 原子写 ─────────────── */
  function atomicWrite(file, content) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  }
  

  async function atomicWriteAsync(file, content) {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, content);
    await fsp.rename(tmp, file);
  }

  /* ─────────────── 存档读写 ─────────────── */
  function dataFile() { return p('data.json'); }
  function readDocFromDisk() {
    try {
      if (!fs.existsSync(dataFile())) return { status: 'empty' };
      const parsed = runMigrations(JSON.parse(fs.readFileSync(dataFile(), 'utf8')));
      if (!parsed || typeof parsed !== 'object' || !parsed.days) return { status: 'corrupt' };
      return { status: 'ok', doc: parsed };
    } catch (_) { return { status: 'corrupt' }; }
  }
  function ensureDoc() {
    if (doc) return doc;
    const r = readDocFromDisk();
    if (r.status === 'ok') { doc = r.doc; }
    else {
      doc = { meta: { version: DATA_VERSION }, days: {}, habits: [], profile: {}, settings: {}, memo: {}, memoNotes: [], todos: [] };
      if (r.status === 'corrupt') {
        /* 存档损坏：原文另存副本（沿用 _corrupt 兜底模式），以空档启动 */
        try { fs.renameSync(dataFile(), p('data-corrupt-' + tsStamp() + '.json')); } catch (_) {}
        doc.meta.corruptRecovered = true;
      }
      doc.meta.version = DATA_VERSION;
      scheduleWrite(0);
    }
    /* 旧档/恢复档缺 todos 时补齐形状（fillDocDefaults 渲染层同款兜底）；必须在 if/else 落定 doc 之后 */
    if (!Array.isArray(doc.todos)) doc.todos = [];
    doc.meta.version = DATA_VERSION;
    return doc;
  }
  function scheduleWrite(delay) {
    writePending = true;
    if (writeTimer) return;
    writeTimer = setTimeout(function () {
      writeTimer = null;
      flushNow();
    }, delay === undefined ? 250 : delay);
  }
  let inFlush = false;
  

  let writeChain = Promise.resolve();
  function flushNow() {
    /* 重入保护：maybeAutoBackup→backupNow 等路径不得在 flush 过程中再次进入（否则 writePending
       被错误置回 true，多出无谓重写轮）。重入请求只做标记，由末尾统一补一轮。 */
    if (writing || inFlush) { writePending = true; return writeChain; }
    if (!doc) return writeChain;
    inFlush = true;
    writing = true;
    writePending = false;
    writeChain = writeChain.then(async function () {
      try {
        if (doc) { doc.meta.version = DATA_VERSION; await atomicWriteAsync(dataFile(), JSON.stringify(doc)); }
        writeFailCount = 0;
        lastWriteError = null;
        broadcast('hb-data-save-state', { state: 'saved', revision: gen });
        maybeAutoBackup();
      } catch (e) {
        

        writeFailCount = (writeFailCount || 0) + 1;
        writePending = true;   /* 失败必须补轮，否则本次变更静默丢失 */
        lastWriteError = e;
        broadcast('hb-data-save-state', { state: 'error', message: String(e.message || e) });
        log('[store] data.json write failed x' + writeFailCount + ': ' + e.message);
      } finally {
        writing = false;
        inFlush = false;
        if (writePending && !writeTimer) {
          const delay = Math.min(5000, 50 * Math.pow(2, Math.min(writeFailCount || 0, 7)));
          scheduleWrite(delay);
        }
      }
    });
    return writeChain;
  }
  /* 排空写链：返回的 Promise 在「当前已排队的写全部落盘」后 resolve。
     退出拦截/备份/切根/恢复前的统一闸门。 */
  async function drainWrites() {
    let failures = 0;
    do {
      if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
      if (!writing && writePending) flushNow();
      await writeChain;
      if (lastWriteError) {
        if (++failures >= 3) throw lastWriteError;
        await new Promise(resolve => setTimeout(resolve, 50 * failures));
      }
    } while (writePending || writing || writeTimer);
    return { ok: true, revision: gen };
  }
  /* 旧签名保持同步返回 writePending（verify-backup2 等脚本依赖）：
     定时器立即触发 + 链排空在本 tick 排上，writePending 同步语义不变；
     落盘完成的保证走 drainWrites()（async 调用方）或退出前的 before-quit 拦截。 */
  function flush() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    if (writePending && !writing) flushNow();
    return writePending;
  }

  /* 渲染层提交：按字段属主合并。scope 合并 = 顶层字段整体替换（与旧协议语义一致）。
     合并完成后把变更字段原样广播给各窗口（发起方按 token 忽略），免二次拉取。 */
  

  function fieldSane(k, v) {
    if (v === null || v === undefined) return false;
    switch (k) {
      case 'days': return !!(v && typeof v === 'object' && !Array.isArray(v)) && Object.keys(v).length <= 20000;
      case 'habits': return Array.isArray(v) && v.length <= 500;
      case 'memoNotes': return Array.isArray(v) && v.length <= 2000;
      case 'todos': return Array.isArray(v) && v.length <= 2000;
      case 'settings': case 'profile': case 'meta': return !!(v && typeof v === 'object' && !Array.isArray(v));
      case 'memo': return (typeof v === 'object' && !Array.isArray(v)) || typeof v === 'string';
      default: return true;
    }
  }
  const noteLastWriter=new Map();
  function applyFields(token, fields) {
    if (rootMoving) {
      const snapshot = JSON.parse(JSON.stringify(fields || {}));
      deferredMutations.push(() => applyFields(token, snapshot));
      return [];
    }
    const d = ensureDoc();
    const scopes = [];
    const rejected = [];
    const noteConflicts=[];
    if(fields&&fields.noteChanges!==undefined){
      if(!Array.isArray(fields.noteChanges)||fields.noteChanges.length>2000)throw new Error('便签变更格式无效');
      const content=n=>JSON.stringify([n.html||'',n.text||'',n.title||'']);
      const notes=JSON.parse(JSON.stringify(d.memoNotes||[]));
      for(const change of fields.noteChanges){
        if(!change||typeof change.id!=='string'||change.id.length>100||(change.base!==null&&typeof change.base!=='string')||(change.note!==null&&(!change.note||change.note.id!==change.id)))throw new Error('便签变更无效');
        const index=notes.findIndex(n=>n.id===change.id),current=notes[index];
        const matches=change.base===(current?content(current):null)||!!(current&&token&&noteLastWriter.get(change.id)===token);
        if(!matches&&change.note){
          if(current&&content(current)===content(change.note))continue;
          const title=(change.note.title||'便签')+'（冲突副本）';
          const existing=notes.find(n=>n._conflictOf===change.id&&n._conflictBase===change.base&&content(n)===content({...change.note,title}));
          const copy=existing||{...change.note,id:change.id.slice(0,60)+'-conflict-'+Date.now()+'-'+noteConflicts.length,title,_conflictOf:change.id,_conflictBase:change.base};
          if(!existing)notes.unshift(copy);noteConflicts.push({id:change.id,copyId:copy.id,original:current||null});
        }else if(!matches){throw new Error('便签已被其他窗口修改，请刷新后重新确认删除');}
        else if(change.note){
          const note={...change.note};
          if(current){note.ord=current.ord;note.pin=current.pin;notes[index]=note;}else notes.unshift(note);
        }else if(index>=0){notes.splice(index,1);}
      }
      if(notes.length>2000)throw new Error('便签数量已达上限，请先导出备份');
      if(fields.noteChanges.length){d.memoNotes=notes;fields.noteChanges.forEach(c=>{if(c.note)noteLastWriter.set(c.id,token);else noteLastWriter.delete(c.id);});noteConflicts.forEach(c=>{noteLastWriter.delete(c.id);noteLastWriter.set(c.copyId,token);});scopes.push('memoNotes');}
    }
    for (const k of ['days', 'habits', 'settings', 'profile', 'meta', 'memo', 'memoNotes', 'todos']) {
      if (fields && Object.prototype.hasOwnProperty.call(fields, k)) {
        if (!fieldSane(k, fields[k])) {
          try { opts.log('[store] 拒绝非法字段 ' + k + '（未落盘，已回报渲染层）'); } catch (_) {}
          rejected.push(k);
          continue;
        }
        d[k] = fields[k];
        if(k==='memoNotes')noteLastWriter.clear();
        if (!scopes.includes(k)) scopes.push(k);
      }
    }
    d.meta.version = DATA_VERSION;
    if (rejected.length) {
      /* 让用户看得见：渲染层收到后弹可见提示，而不是「已保存」的假象 */
      broadcast('hb-data-rejected', { token: token || '', fields: rejected });
    }
    if (scopes.length) {
      gen++;
      scheduleWrite();
      /* 便签字段带 dataURL 图片（导入/旧数据）→ 后台抽取自愈 */
      if (scopes.includes('memo') || scopes.includes('memoNotes')) scheduleExtraction();
       
      if (opts.onDocChanged) { try { opts.onDocChanged(scopes); } catch (_) {} }
      broadcast('hb-data-changed', { token: token || '', scopes, fields: Object.fromEntries(scopes.map(k => [k, d[k]])) });
    }
    /* 返回值保持数组语义（既有调用方/测试按 scopes 用），另挂 rejected 属性供 IPC 回报 */
    scopes.rejected = rejected;
    scopes.noteConflicts=noteConflicts;
    return scopes;
  }
  /* 便签顺序：按 id 只合并 ord/pin，绝不覆盖正文（沿用旧 persistNoteOrder 语义） */
  function applyNoteOrder(token, list) {
    if (rootMoving) { const copy = JSON.parse(JSON.stringify(list || [])); deferredMutations.push(() => applyNoteOrder(token, copy)); return; }
    if (!Array.isArray(list)) return;
    const d = ensureDoc();
    if (!Array.isArray(d.memoNotes)) d.memoNotes = [];
    const map = {};
    list.forEach(function (it) { if (it && it.id) map[it.id] = it; });
    let changed = false;
    d.memoNotes.forEach(function (n) {
      const o = map[n.id];
      if (!o) return;
      if (typeof o.ord === 'number' && isFinite(o.ord) && o.ord !== n.ord) { n.ord = o.ord; changed = true; }
      const pin = !!o.pin;
      if (pin !== !!n.pin) { if (pin) n.pin = true; else delete n.pin; changed = true; }
    });
    if (changed) { gen++; scheduleWrite(); broadcast('hb-data-changed', { token: token || '', scopes: ['memoNotes'], fields: { memoNotes: d.memoNotes } }); }
  }

  /* ─────────────── 迁移（渲染层发起：主进程读不到渲染层 localStorage） ─────────────── */
  function migrateLegacy(raw) {
    if (typeof raw !== 'string' || raw.length < 2) return { ok: false, message: 'empty legacy payload' };
    if (fs.existsSync(dataFile())) {
      /* 已有新存档：不覆盖用户数据，直接返回现有档（幂等保护） */
      const r = readDocFromDisk();
      return { ok: r.status === 'ok', doc: r.doc, existed: true };
    }
    try {
      /* 1) 原文副本先行——任何后续失败都不丢 */
      atomicWrite(p('legacy-backup-v1.json'), raw);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      /* 2) 迁移到当前版本并落档 */
      const migrated = runMigrations(parsed);
      if (!migrated) throw new Error('migration failed');
      if (fs.existsSync(p('legacy-backup-v1.json')) === false) throw new Error('legacy copy missing');
      doc = migrated;
      doc.meta.version = DATA_VERSION;
      atomicWrite(dataFile(), JSON.stringify(doc));
      log('[store] legacy localStorage migrated to ' + dataFile());
      /* 3) 图片抽取走后台自愈，不阻塞本次迁移应答 */
      scheduleExtraction();
      maybeAutoBackup();
      return { ok: true, doc: doc };
    } catch (e) {
      /* 迁移失败：原文已另存 legacy-backup-v1.json；再留一份带时间戳的损坏副本。
         不创建 data.json（下次启动会自动重试迁移），渲染层走 corruptRecovered 模式。 */
      try { fs.writeFileSync(p('legacy-backup-v1-corrupt-' + tsStamp() + '.json'), raw); } catch (_) {}
      log('[store] legacy migration failed: ' + e.message);
      return { ok: false, message: String(e.message || e) };
    }
  }

  /* ─────────────── 图片：落盘 / 回读 / 抽取 / GC ─────────────── */
  function imagesDir() { const d = p('images'); try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} return d; }
  function writeImage(dataUrl) {
    if (typeof dataUrl !== 'string') return { ok: false };
    const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp|bmp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { ok: false, message: 'unsupported image' };
    try {
      const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const ext = IMG_MIME_EXT[m[1]] || 'png';
      fs.writeFileSync(path.join(imagesDir(), id + '.' + ext), Buffer.from(m[2], 'base64'));
      return { ok: true, ref: 'hbimg://' + id };
    } catch (e) { log('[store] writeImage failed: ' + e.message); return { ok: false }; }
  }
  function readImage(ref) {
    const id = String(ref || '').replace(/^hbimg:\/\//, '');
    if (!/^[A-Za-z0-9]+$/.test(id)) return { ok: false };
    const dir = imagesDir();
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.replace(/\.[a-z]+$/, '') !== id) continue;
        const buf = fs.readFileSync(path.join(dir, f));
        const ext = (f.split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
        return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') };
      }
    } catch (_) {}
    return { ok: false };
  }
  /* dataURL→文件 抽取：幂等自愈。启动/导入/含 dataURL 的便签字段落盘后分块执行。 */
  let extracting = false, extractAgain = false;
  function scheduleExtraction() {
    if (extracting) { extractAgain = true; return; }
    extracting = true;
    setImmediate(function () {
      try { extractInlineImages(); } catch (e) { log('[store] extract failed: ' + e.message); }
      extracting = false;
      if (extractAgain) { extractAgain = false; scheduleExtraction(); }
    });
  }
  function extractInlineImages() {
    if (rootMoving) { deferredMutations.push(() => extractInlineImages()); return 0; }
    const d = doc;
    if (!d) return 0;
    const re = /(<img\s[^>]*?src\s*=\s*)(["'])data:image\/(png|jpe?g|gif|webp|bmp);base64,([A-Za-z0-9+/=]{100,})\2/gi;
    let total = 0;
    const targets = [];
    if (d.memo && typeof d.memo.html === 'string') targets.push(d.memo);
    if (Array.isArray(d.memoNotes)) d.memoNotes.forEach(function (n) { if (n && typeof n.html === 'string') targets.push(n); });
    for (const t of targets) {
      t.html = t.html.replace(re, function (whole, pre, q, kind, b64) {
        const w = writeImage('data:image/' + kind + ';base64,' + b64);
        if (w.ok) { total++; return pre + q + w.ref + q + ' crossorigin="anonymous"'; }
        return whole;
      });
      if (total > 0 && total % 20 === 0) flushNow();   // 分块落盘，防长事务
    }
    if (total) { log('[store] extracted ' + total + ' inline image(s) to images/'); scheduleWrite(); }
    return total;
  }
  /* 孤儿图片延迟回收：只清理「未被引用 且 mtime 超 7 天」的文件——刚写入/未保存的图天然安全 */
  function gcImages() {
    if (rootMoving) return 0;
    const d = doc;
    if (!d) return 0;
    const refs = new Set();
    

    const scan = function (s) {
      if (typeof s !== 'string') return;
      const m = s.match(/hbimg:\/\/([A-Za-z0-9]+)/g);
      if (m) m.forEach(function (x) { refs.add(x.slice(HBIMG_PREFIX.length)); });
    };
    if (d.memo) scan(d.memo.html);
    if (Array.isArray(d.memoNotes)) d.memoNotes.forEach(function (n) { scan(n && n.html); });
    

    try {
      for (const f of corruptArchives()) {
        try { scan(fs.readFileSync(path.join(root, f), 'utf8')); } catch (_) {}
      }
    } catch (_) {}
    let removed = 0;
    try {
      const dir = imagesDir();
      const cutoff = Date.now() - 7 * 864e5;
      for (const f of fs.readdirSync(dir)) {
        const id = f.replace(/\.[a-z]+$/, '');
        if (refs.has(id)) continue;
        try { if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) { fs.unlinkSync(path.join(dir, f)); removed++; } } catch (_) {}
      }
    } catch (_) {}
    if (removed) log('[store] gc removed ' + removed + ' orphan image(s)');
    return removed;
  }

  /* ─────────────── hbimg:// 协议（app ready 后由 main.js 挂载） ─────────────── */
  function attachProtocol(electronProtocol) {
    try {
      electronProtocol.handle('hbimg', function (req) {
        const m = String(req.url || '').match(/^hbimg:\/\/([A-Za-z0-9]+)/);
        if (!m) return new Response('', { status: 404 });
        const id = m[1];
        const dir = imagesDir();
        let files = [];
        try { files = fs.readdirSync(dir).filter(function (f) { return f.replace(/\.[a-z]+$/, '') === id; }); } catch (_) {}
        if (!files.length) return new Response('', { status: 404 });
        const ext = (files[0].split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
        /* ACAO:*：file:// 页面（origin=null）经 <img crossorigin="anonymous"> 加载，
           保证裁剪等 canvas drawImage 不被跨源污染 */
        return new Response(fs.readFileSync(path.join(dir, files[0])), {
          headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=31536000, immutable' }   
        });
      });
      log('[store] hbimg:// protocol attached');
    } catch (e) { log('[store] protocol attach failed: ' + e.message); }
  }

  /* ─────────────── 自动备份（主进程持有：写盘后按真实 mtime 判定） ─────────────── */
  function backupDir() { const d = p('auto-backup'); try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} return d; }
  function backupList() {
    try {
      /* 兼容两种命名：habit-backup-YYYYMMDD-HHMMSS-vX（初版）与 ...-HHMMSS-mmm-vX（含毫秒，防同秒互覆盖） */
      return fs.readdirSync(backupDir())
        .filter(function (n) { return /^habit-backup-\d{8}-\d{6}(-\d{3})?-v/.test(n); })
        .sort().reverse();
    } catch (_) { return []; }
  }
  function backupNow() {
    try {
      /* 注意：这里【不】调 flush()——flushNow→maybeAutoBackup→backupNow 会重入。
         需要先落盘的调用方（IPC 立即备份/导入/迁目录）自行先 flush()。 */
      const name = 'habit-backup-' + tsStamp() + '-' + String(Date.now() % 1000).padStart(3, '0') + '-v' + String(getAppVersion()).replace(/[^0-9.]/g, '');
      let dest = path.join(backupDir(), name);
      if (fs.existsSync(dest)) dest += '-' + crypto.randomBytes(4).toString('hex');
      const staging = path.join(backupDir(), '.incomplete-' + path.basename(dest));
      fs.mkdirSync(staging, { recursive: true });
      fs.copyFileSync(dataFile(), path.join(staging, 'data.json'));
      fs.cpSync(imagesDir(), path.join(staging, 'images'), { recursive: true });
      verifyImages(imagesDir(), path.join(staging, 'images'));
      fs.writeFileSync(path.join(staging,'manifest.json'),JSON.stringify(backupHistory.manifest(staging)));
      fs.writeFileSync(path.join(staging, 'info.json'), JSON.stringify({ appVersion: getAppVersion(), build: opts.build || '', createdAt: new Date().toISOString() }, null, 2), 'utf8');
      fs.renameSync(staging, dest);
      pruneBackups();
      log('[store] backup created: ' + name);
      return { ok: true, dir: dest, name: path.basename(dest) };
    } catch (e) { log('[store] backup failed: ' + e.message); return { ok: false, message: String(e.message || e) }; }
  }
  function verifyImages(src, dest) {
    for (const file of fs.readdirSync(src)) {
      const a = path.join(src, file), b = path.join(dest, file);
      if (!fs.statSync(a).isFile()) continue;
      if (!fs.existsSync(b) || !fs.readFileSync(a).equals(fs.readFileSync(b))) throw new Error('图片复制校验失败：' + file);
    }
  }
  function pruneBackups() {
    const keep = Math.max(1, Number(config.backupKeep) || DEFAULT_CONFIG.backupKeep);
    const list = backupList();
    for (let i = keep; i < list.length; i++) {
      try { fs.rmSync(path.join(backupDir(), list[i]), { recursive: true, force: true }); } catch (_) {}
    }
  }
  function backupStatus() {
    let lastAt = 0, count = 0;
    try {
      const list = backupList();
      count = list.length;
      if (count) lastAt = fs.statSync(path.join(backupDir(), list[0])).mtimeMs;
    } catch (_) {}
    return { ok: true, lastAt: lastAt, count: count, intervalDays: Number(config.backupIntervalDays) || 1, keep: Number(config.backupKeep) || 7, root: root, portable: !!config.portable, dataDir: config.dataDir || '' };
  }
  function listBackupHistory(){
    return backupList().map(name=>{try{return backupHistory.inspect(backupDir(),name).row;}catch(error){return {name,ok:false,integrity:error.message};}});
  }
  function previewBackup(name){
    try{
      const found=backupHistory.inspect(backupDir(),String(name||''));
      if(!found.row.ok)throw new Error(found.row.integrity);
      const current=ensureDoc(),before=backupHistory.summary(current),after=backupHistory.summary(found.doc);
      if(current.meta&&current.meta.activeTimer&&!current.meta.activeTimer.paused)return {ok:false,message:'请先暂停或结束专注，再预览恢复备份'};
      const currentHash=backupHistory.hash(JSON.stringify(current));
      return {ok:true,backup:found.row,before,after,currentHash,token:backupHistory.hash(found.row.fingerprint+currentHash)};
    }catch(error){return {ok:false,message:error.message};}
  }
  async function restoreBackup(name,token){
    if(rootMoving)return {ok:false,message:'正在处理数据，请稍后重试'};
    rootMoving=true;
    rootTransition=(async()=>{
      try{
        await drainWrites();
        const preview=previewBackup(name);
        if(!preview.ok)return preview;
        if(preview.token!==token)return {ok:false,stale:true,message:'存档或备份在预览后发生变化，请重新预览'};
        const found=backupHistory.inspect(backupDir(),name);
        // Read selected files before the safety snapshot can rotate its source.
        const images=found.current.images.map(f=>({name:f.name,bytes:fs.readFileSync(path.join(found.dir,'images',f.name))}));
        const restored=runMigrations(found.doc);
        if(!restored)throw new Error('备份版本无法恢复');
        const safety=backupNow();if(!safety.ok)return safety;
        for(const item of images)await atomicWriteAsync(path.join(imagesDir(),item.name),item.bytes);
        await atomicWriteAsync(dataFile(),JSON.stringify(restored));
        doc=restored;gen++;
        broadcast('hb-data-changed',{token:'',scopes:Object.keys(restored),fields:restored});
        scheduleExtraction();
        return {ok:true,safetyBackup:safety.name};
      }catch(error){return {ok:false,message:error.message};}
      finally{rootMoving=false;while(deferredMutations.length)deferredMutations.shift()();await drainWrites();}
    })();
    return rootTransition;
  }
  function maybeAutoBackup() {
    try {
      const st = backupStatus();
      const intervalMs = Math.max(1, Number(st.intervalDays)) * 864e5;
      if (st.lastAt && Date.now() - st.lastAt < intervalMs) return;
      backupNow();
    } catch (_) {}
  }

  /* ─────────────── 导入（整包替换）与导出回填 ─────────────── */
  

  function corruptArchives() {
    try {
      return fs.readdirSync(root).filter(function (f) { return /^data-corrupt-\d{8}-\d{6}(-\d{3})?/.test(f); }).sort().reverse();   
    } catch (_) { return []; }
  }
  function listCorruptArchives() {
    return corruptArchives().map(function (f) {
      let summary = { file: f, days: -1, habits: -1, ok: false };
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
        const doc = runMigrations(parsed);
        if (doc && typeof doc === 'object' && doc.days) {
          summary.ok = true;
          summary.days = Object.keys(doc.days).length;
          summary.habits = Array.isArray(doc.habits) ? doc.habits.filter(function (h) { return h && !h.deleted; }).length : -1;
        }
      } catch (_) {}
      return summary;
    });
  }
  async function restoreCorruptArchive(file) {
    try {
      /* 恢复窗口期与 importDoc/setDataRoot 同款 rootMoving：期间到达的 commit 暂存重放而非直接应用——
         否则两次 await drainWrites 之间落进来的提交会拿到 {ok:true} 却被随后的整档覆盖吞掉（全项目自查发现）。 */
      if (rootMoving) return { ok: false, message: '正在处理数据，请稍后重试' };
      rootMoving = true;
      try {
        return await restoreCorruptArchiveInner(file);
      } finally {
        rootMoving = false;
        while(deferredMutations.length)deferredMutations.shift()();
      }
    } catch (e) { return { ok: false, message: String(e.message || e) }; }
  }
  async function restoreCorruptArchiveInner(file) {
    try {
      

      await drainWrites();
      if (!/^data-corrupt-\d{8}-\d{6}(-\d{3})?/.test(String(file))) return { ok: false, message: '非法存档名' };   
      const fp = path.join(root, file);
      if (!fs.existsSync(fp)) return { ok: false, message: '存档不存在' };
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const restored = runMigrations(parsed);
      if (!restored || typeof restored !== 'object' || !restored.days) return { ok: false, message: '存档仍无法解析' };
      ensureDoc();
      await drainWrites();
      const backup = backupNow();
      if (!backup.ok) return backup;
      restored.meta.version = DATA_VERSION;
      if (!Array.isArray(restored.todos)) restored.todos = [];   /* 旧存档无 todos：恢复落盘前补齐形状 */
      atomicWrite(dataFile(), JSON.stringify(restored));
      doc = null;
      ensureDoc();
      gen++;
       
      broadcast('hb-data-changed', { token: '', scopes: ['days', 'habits', 'settings', 'profile', 'meta', 'memo', 'memoNotes', 'todos'], fields: { days: restored.days, habits: restored.habits, settings: restored.settings, profile: restored.profile, meta: restored.meta, memo: restored.memo, memoNotes: restored.memoNotes, todos: restored.todos } });
      scheduleExtraction();    
      log('[store] corrupt archive restored: ' + file);
      /* 恢复整档同样喂提醒调度（与 importDoc 同口径） */
      if (opts.onDocChanged) { try { opts.onDocChanged(['days', 'habits', 'settings', 'profile', 'meta', 'memo', 'memoNotes', 'todos']); } catch (_) {} }
      return { ok: true, days: Object.keys((doc && doc.days) || {}).length };
    } catch (e) { return { ok: false, message: String(e.message || e) }; }
  }
  /* 导出前把 hbimg:// 引用回填为 dataURL，保证备份文件自包含可换机 */
  function exportDoc() {
    const d = ensureDoc();
    const copy = JSON.parse(JSON.stringify(d));
    const inline = function (html) {
      if (typeof html !== 'string') return html;
      return html.replace(/(<img\s[^>]*?src\s*=\s*)(["'])hbimg:\/\/([A-Za-z0-9]+)\2/gi, function (whole, pre, q, id) {
        const r = readImage(id);
        return r.ok ? pre + q + r.dataUrl + q : whole;
      });
    };
    if (copy.memo && copy.memo.html) copy.memo.html = inline(copy.memo.html);
    if (Array.isArray(copy.memoNotes)) copy.memoNotes.forEach(function (n) { if (n) n.html = inline(n.html); });
    return { ok: true, doc: copy };
  }
  async function importDoc(token, fields) {
    if (rootMoving) return { ok: false, message: '正在处理数据，请稍后重试' };
    /* 3.1.0 前的备份缺非关键字段时显式补缺省（fillDocDefaults 同口径）——否则 fieldSane 对 undefined
       拒收会把整个导入挡下。days/habits/meta 仍必填：结构完整性由它们兜底。 */
    if (fields) {
      if (!Array.isArray(fields.todos)) fields.todos = [];
      if (!fields.memo || typeof fields.memo !== 'object') fields.memo = { html: '', text: '' };
      if (!Array.isArray(fields.memoNotes)) fields.memoNotes = [];
      if (!fields.profile || typeof fields.profile !== 'object') fields.profile = { name: '用户', avatar: '☕' };
      if (!fields.settings || typeof fields.settings !== 'object') fields.settings = { remindPerHabit: true, remindSummary: true, sound: true };
    }
    const keys = ['days','habits','settings','profile','meta','memo','memoNotes','todos'];
    if (keys.some(k => !fieldSane(k, fields && fields[k]))) return { ok:false, message:'导入内容超出限制或格式无效，原数据未改变' };
    rootMoving = true;
    rootTransition = (async function(){
      try {
        await drainWrites();
        const backup = backupNow();
        if (!backup.ok) return backup;
        const replacement = Object.fromEntries(keys.map(k => [k, fields[k]]));
        replacement.meta.version = DATA_VERSION;
        await atomicWriteAsync(dataFile(), JSON.stringify(replacement));
        doc = replacement; gen++;
        broadcast('hb-data-changed', {token:token,scopes:keys,fields:replacement});
         
        if (opts.onDocChanged) { try { opts.onDocChanged(keys); } catch (_) {} }
        scheduleExtraction();
        return {ok:true};
      } catch(error) { return {ok:false,message:error.message}; }
      finally {
        rootMoving = false;
        while(deferredMutations.length)deferredMutations.shift()();
      }
    })();
    return rootTransition;
  }

   
  function setDataRoot(patch) {
    if (rootMoving) return Promise.resolve({ ok: false, message: '正在迁移数据，请稍后重试' });
    rootMoving = true;
    rootTransition = moveDataRoot(patch).finally(async function () {
      rootMoving = false;
      while (deferredMutations.length) deferredMutations.shift()();
      await drainWrites();
    }).catch(error => ({ ok: false, message: String(error.message || error) }));
    return rootTransition;
  }
  async function moveDataRoot(patch) {
    try {
      const wantPortable = patch && patch.portable !== undefined ? !!patch.portable : config.portable;
      const wantDir = patch && patch.dataDir !== undefined ? String(patch.dataDir || '') : config.dataDir;
      const newRoot = (function () {
        if (wantPortable) { const base = portableDirectory(); if(!base)return null; const d = path.join(base, 'data'); return writableTest(d) ? d : null; }
        if (wantDir) return writableTest(wantDir) ? wantDir : null;
        return userDataDir;
      })();
      if (!newRoot) return { ok: false, message: '目标目录不可写' };
      const relative = path.relative(root, newRoot);
      if (/^(images|auto-backup)([\\/]|$)/i.test(relative)) return { ok: false, message: '不能迁移到图片或备份子目录' };
      if (newRoot === root) { config.portable = wantPortable; config.dataDir = wantDir; saveConfig(); root = resolveRoot(); return { ok: true, root: root, moved: false }; }
      await drainWrites();
      const targetFile = path.join(newRoot, 'data.json');
      const conflicting = fs.existsSync(targetFile) && (!fs.existsSync(dataFile()) || !fs.readFileSync(targetFile).equals(fs.readFileSync(dataFile())));
      if (conflicting && !(patch && patch.replaceExisting === true)) return { ok: false, conflict: true, root:newRoot, message: '目标目录已有另一份存档。可取消，或先保留两侧备份再迁移。' };
      /* 迁移前强制立即备份到当前根 */
      const backup = backupNow();
      if (!backup.ok) return backup;
      let targetBackup = '';
      if (conflicting) {
        targetBackup = path.join(userDataDir,'migration-safety',tsStamp()+'-'+crypto.randomBytes(4).toString('hex'));
        await fsp.mkdir(targetBackup,{recursive:true});
        await fsp.copyFile(targetFile,path.join(targetBackup,'data.json'));
        const oldImages=path.join(newRoot,'images');
        if (fs.existsSync(oldImages)) { await fsp.cp(oldImages,path.join(targetBackup,'images'),{recursive:true});verifyImages(oldImages,path.join(targetBackup,'images')); }
        await fsp.writeFile(path.join(targetBackup,'info.json'),JSON.stringify({source:newRoot,createdAt:new Date().toISOString()}));
      }
      await fsp.mkdir(newRoot, { recursive: true });
      if (fs.existsSync(dataFile())) await fsp.copyFile(dataFile(), path.join(newRoot, 'data.json'));
      

      if (fs.existsSync(p('images'))) {
        let imagesOk = true;
        try {
          const srcDir = p('images'), dstDir = path.join(newRoot, 'images');
          await fsp.mkdir(dstDir, { recursive: true });
          const srcFiles = fs.readdirSync(srcDir).filter(function (f) { return fs.statSync(path.join(srcDir, f)).isFile(); });
          for (const f of srcFiles) await fsp.copyFile(path.join(srcDir, f), path.join(dstDir, f));
          const doneN = fs.readdirSync(dstDir).filter(function (f) { return fs.statSync(path.join(dstDir, f)).isFile(); }).length;
          if (doneN < srcFiles.length) imagesOk = false;
          verifyImages(srcDir, dstDir);
        } catch (_) { imagesOk = false; }
        if (!imagesOk) return { ok: false, message: '图片复制不完整，已中止迁移（原目录未动，可清理目标目录后重试）' };
      }
      if (fs.existsSync(p('auto-backup'))) await fsp.cp(p('auto-backup'), path.join(newRoot, 'auto-backup'), { recursive: true });
      for (const f of ['legacy-backup-v1.json']) {
        try { if (fs.existsSync(p(f))) await fsp.copyFile(p(f), path.join(newRoot, f)); } catch (_) {}
      }
      /* 校验：新根 data.json 必须可解析且含 days，否则不切换 */
      try { const check = JSON.parse(fs.readFileSync(path.join(newRoot, 'data.json'), 'utf8')); if (!check || !check.days) throw new Error('verify failed'); } catch (e) { return { ok: false, message: '新目录校验失败: ' + e.message }; }
      const oldConfig = Object.assign({}, config);
      config.portable = wantPortable; config.dataDir = wantDir;
      try { saveConfig(true); } catch (error) { config = oldConfig; throw error; }
      const oldRoot = root;
      root = newRoot;
      previousRoot = oldRoot;
      /* doc remains authoritative; edits queued during copying replay after the root switches. */
      log('[store] data root moved: ' + oldRoot + ' -> ' + newRoot);
      /* 不广播 reload：渲染层要先走「清理旧目录」确认流，由渲染层自行刷新 */
      return { ok: true, root: root, moved: true, oldRoot: oldRoot, targetBackup:targetBackup };
    } catch (e) { return { ok: false, message: String(e.message || e) }; }
  }
  /* 旧根清理：仅删数据文件（app.log/startup.json/app-config.json 在 userData，永不动） */
  async function purgeDir(dir) {
    let removed = 0;
    for (const rel of ['data.json', 'images', 'auto-backup', 'legacy-backup-v1.json']) {
      try {
        const fp = path.join(dir, rel);
        if (!fs.existsSync(fp)) continue;
        await fsp.rm(fp, { recursive: true, force: true });
        removed++;
      } catch (_) {}
    }
    return removed;
  }
  async function purgeOldRoot() {
    /* 只清「上一次迁移前的根」（setDataRoot 记录的 previousRoot），与当前根不同才动手 */
    const old = previousRoot;
    if (!old || path.resolve(old) === path.resolve(root)) return { ok: false, message: '无旧数据目录' };
    const n = await purgeDir(old);
    previousRoot = null;
    log('[store] purged old root ' + old + ' (' + n + ' items)');
    return { ok: true, removed: n };
  }

  function tsStamp() {
    const d = new Date();
    const p2 = function (n) { return String(n).padStart(2, '0'); };
    return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }

  /* ─────────────── IPC 注册（sendSync 仅用于 boot 读/迁移两处） ─────────────── */
  function registerIpc(ipcMain, ipcMainOnChannels) {
    const { ipcMain: ipc, dialog } = require('electron');
    ipc.on('hb-data:load-sync', function (e) {
      /* 无内存档且磁盘无 data.json → 返回 empty（渲染层据此走 示例数据/旧键迁移 流程，
         绝不提前物化空档——否则首启示例与迁移分支都会被空档短路） */
      if (!doc && !fs.existsSync(dataFile())) {
        e.returnValue = { status: 'empty', doc: null, root: root };
        return;
      }
      const d = ensureDoc();
      e.returnValue = { status: (d.meta && d.meta.corruptRecovered) ? 'corrupt-recovered' : 'ok', doc: d, root: root, notice: startupNotice };
    });
    ipc.on('hb-data:migrate-sync', function (e, raw) {
      const r = migrateLegacy(raw);
      e.returnValue = r;
    });
    /* fire-and-forget 通道同样要拦异常：applyFields 对畸形 noteChanges 会 throw（store.js:289 一带），
       裸抛进 uncaughtException，60s 内 3 次即 relaunch（main.js 兜底）→ 在途写入随重启丢失。
       commit/save-sync 都有 try/catch，唯独这里漏了（全项目自查发现）。 */
    ipc.on('hb-data:save', function (e, token, fields) {
      try { applyFields(token, fields); }
      catch (error) { try { opts.log('[store] hb-data:save 应用失败: ' + (error && error.message || error)); } catch (_) {} }
    });
    ipc.handle('hb-data:commit', async function (e, token, fields) {
      try {
        await rootTransition;
        const scopes = applyFields(token, fields);
        if (scopes.rejected && scopes.rejected.length) return { ok: false, rejected: scopes.rejected, message: '部分字段格式无效未保存，其余已保存' };
        const result=await drainWrites();
        if(fields&&fields.noteChanges)result.noteConflicts=scopes.noteConflicts;
        return result;
      } catch (error) { return { ok: false, message: String(error.message || error) }; }
    });
    /* 死通道已删（hb-data:note-order）：preload 只有 note-order-commit 一条排序通路，此 send 版无任何调用方（全项目自查确认）。 */
    ipc.handle('hb-data:note-order-commit', async function (e, token, list) {
      try {
        await rootTransition;
        if (!Array.isArray(list)) return { ok: false, message: '便签顺序格式无效，未保存' };
        applyNoteOrder(token, list);
        return await drainWrites();
      } catch (error) { return { ok: false, message: String(error.message || error) }; }
    });
    ipc.handle('hb-data:write-image', async function (e, dataUrl) { await rootTransition; return writeImage(dataUrl); });
    ipc.handle('hb-data:read-image', function (e, ref) { return readImage(ref); });
    ipc.handle('hb-data:export-doc', async function () { if (opts.beforeSnapshot) await opts.beforeSnapshot(); await rootTransition; return exportDoc(); });
    ipc.handle('hb-data:import-doc', async function(e, token, fields){
      if (!isTrustedSender(e)) return {ok:false,message:'非法发送方'};
      if (opts.beforeSnapshot) await opts.beforeSnapshot();
      return importDoc(token, fields);
    });
    

    ipc.handle('hb-data:corrupt-list', function () { return JSON.stringify(listCorruptArchives()); });
    ipc.handle('hb-data:backup-history',()=>JSON.stringify(listBackupHistory()));
    ipc.handle('hb-data:backup-preview',async(e,name)=>{if(!isTrustedSender(e))return {ok:false};if(opts.beforeSnapshot)await opts.beforeSnapshot();await drainWrites();return previewBackup(name);});
    ipc.handle('hb-data:backup-restore',async(e,name,token)=>{if(!isTrustedSender(e))return {ok:false};if(opts.beforeSnapshot)await opts.beforeSnapshot();return restoreBackup(String(name||''),String(token||''));});
    ipc.handle('hb-data:corrupt-restore', function (e, file) {
      

      if (!isTrustedSender(e)) { log('[store] hb-data:corrupt-restore 非可信发送方，忽略'); return { ok: false, message: 'untrusted sender' }; }
      return restoreCorruptArchive(String(file || ''));
    });
    

    ipc.on('hb-data:save-sync', function (e, token, fields) {
      try {
        const scopes = applyFields(token, fields);
        /* 显式带上 rejected：structured clone 不会保留数组上的自定义属性，
           渲染层要靠它判断「这次保存有没有字段被拒」（关窗前兜底保存尤其重要）。 */
        e.returnValue = { ok: true, scopes: scopes, rejected: (scopes && scopes.rejected) || [] };
      }
      catch (err) { try { e.returnValue = { ok: false, message: String(err.message || err) }; } catch (_) {} }
    });
    ipc.handle('hb-data:backup-now', async function () { try { if (opts.beforeSnapshot) await opts.beforeSnapshot(); await rootTransition; await drainWrites(); return backupNow(); } catch (e) { return { ok: false, message: e.message }; } });
    ipc.handle('hb-data:backup-status', function () { return backupStatus(); });
    ipc.handle('hb-config:get', function () { return Object.assign({}, config, { root: root }); });
    ipc.handle('hb-config:set', function (e, patch) {
      if (patch && Number(patch.backupIntervalDays)) config.backupIntervalDays = Math.min(30, Math.max(1, Number(patch.backupIntervalDays)));
      if (patch && Number(patch.backupKeep)) config.backupKeep = Math.min(30, Math.max(3, Number(patch.backupKeep)));
      saveConfig();
      return Object.assign({}, config, { root: root });
    });
    

    ipc.handle('hb-data:set-root', async function (e, patch) {
      if (!isTrustedSender(e)) { log('[store] hb-data:set-root 非可信发送方，忽略'); return { ok: false, message: 'untrusted sender' }; }
      if (opts.beforeSnapshot) await opts.beforeSnapshot();
      return setDataRoot(patch);
    });
    ipc.handle('hb-data:purge-old-root', function (e) {
      if (!isTrustedSender(e)) { log('[store] hb-data:purge-old-root 非可信发送方，忽略'); return { ok: false, message: 'untrusted sender' }; }
      return purgeOldRoot();
    });
     
    ipc.handle('hb-data:pick-dir', async function () {
      try {
        const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '选择数据目录' });
        if (r && !r.canceled && r.filePaths && r.filePaths.length) return { ok: true, dir: r.filePaths[0] };
        return { ok: false, canceled: true };
      } catch (e) { return { ok: false, message: String(e.message || e) }; }
    });
  }

  return {
    registerIpc, attachProtocol, flush, drainWrites,
    _internal: {
      ensureDoc, applyFields, applyNoteOrder, migrateLegacy, backupNow, backupStatus, pruneBackups, backupList, listBackupHistory, previewBackup, restoreBackup, gcImages, extractInlineImages, setDataRoot, purgeOldRoot, resolveRoot, listCorruptArchives, restoreCorruptArchive, drainWrites,
      

      peekDoc: function () {
        if (doc) return doc;
        try {
          const r = readDocFromDisk();
          if (r && r.status === 'ok' && r.doc) { doc = r.doc; return doc; }
        } catch (_) {}
        return null;
      },
      loadConfig: function () { return Object.assign({}, config, { root: root }); },
      /* 测试钩子：丢弃内存档、下次读盘重新加载（故障注入直接改 data.json 后用） */
      resetDoc: function () { doc = null; },
      /* 测试/收尾钩子：立即落盘（绕过 250ms 防抖），并返回是否仍有挂起 */
      flush: function () { flush(); return writePending; }
    }
  };
}

module.exports = { createStore, DATA_VERSION, runMigrations };
