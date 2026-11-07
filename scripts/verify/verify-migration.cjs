/* verify-migration —— v2.1 存储迁移回放（任务 1+2 新增）
   覆盖：
   A) 旧 localStorage（含带图便签）→ 渲染层发起迁移 → data.json + legacy-backup-v1.json 原文副本；
   B) 迁移后旧键只读保留（红线 5）+ dataURL 图片后台抽取为 images/ 文件（正文改 hbimg:// 引用）；
   C) 重复启动幂等：不重复迁移、数据稳定；
   D) 迁移失败兜底：坏档 → legacy-corrupt 副本 + corruptRecovered 模式 + 不创建新存档；
   E) hbimg:// 技术验证点：落盘图片经自定义协议渲染、crossorigin 加载、canvas 不被跨源污染。 */
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const H = require('./_harness.js');

const NAME = 'verify-migration';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const PROF = H.initProfile(NAME);
H.stubIpc(suite.calls);
const DATA_FILE = () => path.join(PROF, 'data.json');

async function pollEval(win, expr, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    let r = null;
    try { r = await H.evalJson(win, expr, 5000); } catch (_) {}
    if (r) return r;
    if (Date.now() - t0 > (timeoutMs || 10000)) return null;
    await H.sleep(200);
  }
}

app.whenReady().then(async () => {
  const win = H.makeWin(suite);
  try {
    /* ===== Phase F：迁移失败兜底 ===== */
    await H.loadPage(win); await H.bootWait(win);
    await H.evalJson(win, 'localStorage.setItem(LS_KEY,"{{{not a json");return true');
    fs.unlinkSync(DATA_FILE());
    H.storeInternal().resetDoc();
    await win.webContents.reload(); await H.bootWait(win);
    let r = await H.evalJson(win, 'return {corrupt:!!(data.meta&&data.meta.corruptRecovered),ls:localStorage.getItem(LS_KEY)}');
    suite.ok(r.corrupt === true, '坏档迁移失败 → corruptRecovered 示例模式启动');
    suite.ok(r.ls === '{{{not a json', '失败后旧键原文保留（未清除未改写）');
    const corruptCopies = fs.readdirSync(PROF).filter(f => f.indexOf('legacy-backup-v1-corrupt-') === 0);
    suite.ok(corruptCopies.length >= 1, '失败原文另存 legacy-backup-v1-corrupt-*（' + corruptCopies.join(',') + '）');
    await H.drainPageErrs(win, suite);

    /* 清场：回到「无旧键、有示例档」状态，为成功迁移做准备 */
    await H.evalJson(win, 'localStorage.removeItem(LS_KEY);return true');
    fs.unlinkSync(DATA_FILE());
    H.storeInternal().resetDoc();
    await win.webContents.reload(); await H.bootWait(win);
    await H.sleep(800);   /* 等示例档写盘（首启 boot 迁移点会提交 meta） */
    suite.ok(fs.existsSync(DATA_FILE()), '清场后示例档已重建');

    /* ===== Phase S：成功迁移（含带图便签）===== */
    /* 页内 canvas 生成真实 PNG dataURL（保证 ≥100 字符合法 base64），拼装 v1 旧档写入 LS_KEY。
       旧档原文Node 侧持有（页面全局 reload 后即失效，不能作比对基准） */
    const seeded = await H.evalJson(win, [
      'var c=document.createElement("canvas");c.width=24;c.height=24;',
      'var x=c.getContext("2d");x.fillStyle="#FF0000";x.fillRect(0,0,24,24);x.fillStyle="#00FF00";x.fillRect(8,8,8,8);',
      'var du=c.toDataURL("image/png");',
      'var legacy={meta:{notifiedStreak:{},heatStartDate:"2026-09-01"},',
      ' days:{"2026-09-01":{water:3,early:true,mood:"happy"},"2026-09-02":{water:8}},',
      ' habits:[{key:"water",name:"喝水",icon:"💧",type:"count",target:8,unit:"杯",color:"#7FA0B4",size:"wide"},',
      '         {key:"early",name:"早睡",icon:"🌅",type:"bool",color:"#D69B72",size:"wide"}],',
      ' profile:{name:"用户",avatar:"☕"},settings:{remind:true,sound:true},',
      ' memo:{html:"",text:""},',
      ' memoNotes:[{id:"n1",ts:1727800000000,html:"<p>带图便签</p><p><img src=\\""+du+"\\"></p>",text:"带图便签",title:""}]};',
      'var s=JSON.stringify(legacy);localStorage.setItem(LS_KEY,s);return {len:s.length,hasImg:s.indexOf("data:image/png;base64,")>=0,raw:s}'
    ].join(''));
    suite.ok(seeded.hasImg === true, '旧档种子已写入（含带图便签，len=' + seeded.len + '）');
    const LEGACY_RAW = seeded.raw;
    fs.unlinkSync(DATA_FILE());
    H.storeInternal().resetDoc();
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {ver:(data.meta||{}).version,water:(data.days["2026-09-01"]||{}).water,mood:(data.days["2026-09-01"]||{}).mood,habits:data.habits.map(function(h){return h.key}).join(","),note:(data.memoNotes||[]).length}');
    suite.ok(r.ver === 2, '迁移后 meta.version=2');
    suite.ok(r.water === 3 && r.mood === 'happy', '迁移数据完整：2026-09-01 water=3 mood=happy');
    suite.ok(r.habits === 'water,early', '迁移习惯完整（water,early）');
    suite.ok(r.note === 1, '带图便签迁移完整');
    /* 旧键只读保留 + 原文副本 */
    r = await H.evalJson(win, 'return {ls:localStorage.getItem(LS_KEY)}');
    suite.ok(r.ls === LEGACY_RAW, '迁移后 localStorage 旧键逐字节保留（红线 5）');
    const legacyCopy = path.join(PROF, 'legacy-backup-v1.json');
    suite.ok(fs.existsSync(legacyCopy), 'legacy-backup-v1.json 原文副本已落盘');
    if (fs.existsSync(legacyCopy)) {
      const legacyOnDisk = JSON.parse(fs.readFileSync(legacyCopy, 'utf8'));
      suite.ok(legacyOnDisk.days && legacyOnDisk.days['2026-09-01'] && legacyOnDisk.days['2026-09-01'].water === 3, '副本内容与旧档一致');
    }
    /* dataURL → images/ 后台抽取自愈（轮询至正文引用 hbimg://） */
    const ex = await pollEval(win, 'var d=hbShell.dataLoadSync().doc;var h=(d.memoNotes&&d.memoNotes[0])?d.memoNotes[0].html:"";return (h.indexOf("hbimg://")>=0)?{ref:h.match(/hbimg:\\/\\/[A-Za-z0-9]+/)[0]}:null', 15000);
    suite.ok(!!ex && !!ex.ref, '带图便签 dataURL 已抽取为 hbimg:// 引用（' + (ex && ex.ref) + '）');
    const imgDir = path.join(PROF, 'images');
    const imgFiles = fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : [];
    suite.ok(imgFiles.length >= 1, 'images/ 目录落盘图片文件（' + imgFiles.length + ' 个）');
    await H.drainPageErrs(win, suite);

    /* ===== Phase I：hbimg:// 渲染 + canvas 不污染（技术验证点）===== */
    if (ex && ex.ref) {
      await H.evalJson(win, 'window.__rr=null;hbShell.readImage(' + JSON.stringify(ex.ref) + ').then(function(x){window.__rr=x;});return true');
      const rr = await pollEval(win, 'return window.__rr', 8000);
      suite.ok(rr && rr.ok === true && /^data:image\/png;base64,/.test(rr.dataUrl || ''), 'readImage 回读 dataURL 成功');
      await H.evalJson(win, 'window.__taint=null;(function(){var im=new Image();im.setAttribute("crossorigin","anonymous");im.onload=function(){try{var c=document.createElement("canvas");c.width=im.naturalWidth||24;c.height=im.naturalHeight||24;var x=c.getContext("2d");x.drawImage(im,0,0);var px=x.getImageData(2,2,1,1).data;var du=c.toDataURL("image/png");window.__taint={ok:true,px:[px[0],px[1],px[2]],len:du.length};}catch(e){window.__taint={ok:false,err:String(e&&e.message||e)};}};im.onerror=function(){window.__taint={ok:false,err:"img load failed"};};im.src=' + JSON.stringify(ex.ref) + ';})();return true');
      const t = await pollEval(win, 'return window.__taint', 10000);
      suite.ok(!!t && t.ok === true, 'hbimg:// + crossorigin：canvas drawImage/getImageData/toDataURL 未被跨源污染' + (t && t.err ? '（' + t.err + '）' : ''));
      suite.ok(!!t && t.ok === true && t.px[0] === 255, '像素回读正确（红通道=' + (t ? t.px[0] : '?') + '）');
    }

    /* ===== Phase C：重复启动幂等 ===== */
    const legacyCountBefore = fs.readdirSync(PROF).filter(f => f.indexOf('legacy-backup-v1') === 0).length;
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {ver:(data.meta||{}).version,water:(data.days["2026-09-01"]||{}).water,habits:data.habits.length,ls:localStorage.getItem(LS_KEY)}');
    suite.ok(r.ver === 2 && r.water === 3 && r.habits === 2, '重复启动幂等：数据稳定（ver=2 water=3 habits=2）');
    suite.ok(r.ls === LEGACY_RAW, '重复启动后旧键仍逐字节保留');
    const legacyCountAfter = fs.readdirSync(PROF).filter(f => f.indexOf('legacy-backup-v1') === 0).length;
    suite.ok(legacyCountAfter === legacyCountBefore, '不重复迁移（legacy 副本数稳定 ' + legacyCountAfter + '）');
    await H.drainPageErrs(win, suite);
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
