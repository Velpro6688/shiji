/* ============ 设置开关 ============ */
function toggleRemindPer(el){data.settings.remindPerHabit=!data.settings.remindPerHabit;el.classList.toggle('on',data.settings.remindPerHabit);el.setAttribute('aria-checked',String(!!data.settings.remindPerHabit));saveDebounced();}
function toggleRemindSum(el){data.settings.remindSummary=!data.settings.remindSummary;el.classList.toggle('on',data.settings.remindSummary);el.setAttribute('aria-checked',String(!!data.settings.remindSummary));saveDebounced();renderTodo();}
/* 待办到期提醒（3.1.0）：默认开（remindTodo 缺失视为开，与主进程 reminders.js 口径一致） */
function toggleRemindTodo(el){data.settings.remindTodo=data.settings.remindTodo===false?true:false;el.classList.toggle('on',data.settings.remindTodo!==false);el.setAttribute('aria-checked',String(data.settings.remindTodo!==false));saveDebounced();}
function toggleSound(el){data.settings.sound=!data.settings.sound;el.classList.toggle('on',data.settings.sound);el.setAttribute('aria-checked',String(!!data.settings.sound));saveDebounced();if(data.settings.sound)beep(660,0.15);}


function toggleRestore(el){
  var on=!el.classList.contains('on');
  el.classList.toggle('on',on);
  el.setAttribute('aria-checked',String(on));
  try{ localStorage.setItem('hb_restore_sticky',on?'1':'0'); }catch(_){}
  toast(on?'已开启：下次启动自动贴回上次便签':'已关闭：启动不再自动贴回', on?'good':'');
}
window.toggleRestore=toggleRestore;
function syncRestoreSwitch(){
  var el=document.getElementById('tgRestore'); if(!el)return;
  var on=false; try{ on=localStorage.getItem('hb_restore_sticky')==='1'; }catch(_){}
  el.classList.toggle('on',on);
  el.setAttribute('aria-checked',String(on));
}
window.syncRestoreSwitch=syncRestoreSwitch;
 
function renderAppBuildLine(){
  var el=document.getElementById('appBuildLine');if(!el)return;
  var same=!!(MAIN_BUILD&&MAIN_BUILD===APP_BUILD);
  

  if(MAIN_BUILD&&same){ el.style.display='';el.textContent='时迹 · '+APP_BUILD; return; }
  el.style.display='';
  el.textContent=MAIN_BUILD
    ?('时迹 ⚠️ 页面构建 '+APP_BUILD+' 与主进程 '+MAIN_BUILD+' 不一致（换包可能未生效，建议彻底退出后重开）')
    :('时迹 · 页面构建 '+APP_BUILD+'（主进程未上报构建号）');
}
window.renderAppBuildLine=renderAppBuildLine;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderAppBuildLine);
else renderAppBuildLine();

var startupBusy=false;
function showStartupState(state){
  var el=document.getElementById('tgStartup');
  el.classList.toggle('on',!!state.enabled);
  el.setAttribute('aria-checked',String(!!state.enabled));
  el.disabled=!state.supported;
  

  var warns=[];
  if(!state.supported){ warns.push('当前环境不支持读取自启状态'); }
  else{
    if(state.duplicates&&state.duplicates.length) warns.push('系统里有重复自启项：'+state.duplicates.join('、'));
    if(state.mismatched) warns.push('系统登记的是旧版路径，点一下开关即可修复');
  }
  var tip=state.supported?(state.enabled?'开机自启：已开启':'开机自启：未开启'):'当前环境不支持开机自启';
  if(warns.length) tip+='（⚠️ '+warns.join('；')+'）';
  el.title=tip;
  var sub=document.getElementById('startupSub');
  if(sub){
    var base='登录 Windows 时自动启动时迹';
    sub.textContent=warns.length?(base+' · ⚠️ '+warns.join('；')):base;
    sub.style.color=warns.length?'var(--gold,#BA7517)':'';
  }
}
async function refreshStartup(){
  if(startupBusy)return;
  var el=document.getElementById('tgStartup');if(!el)return;
  document.getElementById('startupIcon').innerHTML=icn('clock',20,2);
  if(!window.hbShell||!window.hbShell.getStartup){showStartupState({supported:false,enabled:false});return;}
  startupBusy=true;el.disabled=true;
  try{showStartupState(await window.hbShell.getStartup());}
  catch(_){el.disabled=true;el.title='读取开机自启状态失败，请重新打开设置';}
  finally{startupBusy=false;}
}
async function toggleStartup(el){
  if(startupBusy||el.disabled)return;
  var enabled=el.getAttribute('aria-checked')!=='true';
  startupBusy=true;el.disabled=true;
  try{
    var state=await window.hbShell.setStartup(enabled);showStartupState(state);
    if(state.enabled!==enabled)toast('设置未生效，请检查 Windows 启动应用设置');
  }catch(_){
    try{showStartupState(await window.hbShell.getStartup());}catch(_){el.disabled=true;}
    toast('开机自启设置失败，请重试');
  }finally{startupBusy=false;}
}

/* ============ 示例数据 ============ */
function clearSample(skipConfirm){
  if(skipConfirm){ doClear(); return; }
  showConfirm('清空数据',T('confirm_clear'),doClear,true);
  function doClear(){
    const keep=HABITS.filter(h=>!h.deleted);   /* 记录已清空，无历史可守的墓碑一并移除 */
    data={days:{},habits:keep,memo:data.memo||{html:'',text:''},memoNotes:Array.isArray(data.memoNotes)?data.memoNotes:[],todos:Array.isArray(data.todos)?data.todos:[],profile:data.profile,settings:data.settings,meta:{sampleLoaded:false,notifiedStreak:{},exportRemindAt:0,heatStartDate:/^\d{4}-\d{2}-\d{2}$/.test((data.meta&&data.meta.heatStartDate)||'')?data.meta.heatStartDate:todayStr()}};
    save();syncHabits();renderAll();
    toast(T('t_cleared'),'good');
  }
}

/* ============ 弹层控制 ============ */
async function exportBackup(){
  try{
    await flushRendererChanges();
    data.habits=HABITS;
    /* v2.1：向主进程取回「图片已回填 dataURL」的完整文档——备份文件自包含、可换机可导入 */
    var docSnapshot=data;
    if(hbAvailable()){
      var r=await Promise.resolve(window.hbShell.exportDoc());
      if(r&&r.ok&&r.doc)docSnapshot=r.doc;
    }
    const payload={schema:'habit-memo-shell',version:1,exportedAt:new Date().toISOString(),data:docSnapshot};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=(T('export_filename')||'habit-backup_')+todayStr()+'.json';
    document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
    toast(T('t_exported'),'backup');
  }catch(err){console.error('[backup] export failed',err);toast(T('t_import_bad'),'backup');}
}
function normalizeImported(raw){
  const src=raw&&raw.data&&typeof raw.data==='object'?raw.data:raw;
  if(!src||typeof src!=='object'||Array.isArray(src)||!src.days||typeof src.days!=='object')return null;
  /* 深度安全清洗：用于「未知字段透传」，只放行 JSON 基本类型，剥离函数/undefined 等。 */
  const cleanVal=(v,d)=>{
    d=d||0; if(d>4)return undefined;
    if(v===null||v===undefined)return undefined;
    const t=typeof v;
    if(t==='string')return v.length>20000?v.slice(0,20000):v;
    if(t==='number')return Number.isFinite(v)?v:undefined;
    if(t==='boolean')return v;
    if(Array.isArray(v))return v.slice(0,2000).map(x=>cleanVal(x,d+1)).filter(x=>x!==undefined);
    if(t==='object'){
      const o={};let c=0;
      for(const k of Object.keys(v)){
        if(c>=120)break;
        if(!/^[A-Za-z0-9_\u4e00-\u9fa5-]{1,40}$/.test(k))continue;
        const sv=cleanVal(v[k],d+1); if(sv!==undefined){o[k]=sv;c++;}
      }
      return o;
    }
    return undefined;
  };
  const HABIT_FIXED={key:1,name:1,icon:1,color:1,type:1,target:1,unit:1,size:1,start:1,end:1,timerMinutes:1,archived:1,archivedAt:1,deleted:1,deletedAt:1,remindAt:1,remindDays:1,createdAt:1,schedule:1,scheduleHistory:1,pauseRanges:1,pinned:1};
  const habits=Array.isArray(src.habits)?src.habits.filter(h=>h&&typeof h==='object'&&typeof h.key==='string'&&/^[A-Za-z0-9_:-]{1,80}$/.test(h.key)&&typeof h.name==='string').map(h=>{
    const type=['bool','count','hours','range'].includes(h.type)?h.type:'bool';
    const rawTarget=Number(h.target);
    let target=1;
    if(type==='count'&&Number.isSafeInteger(rawTarget)&&rawTarget>=1)target=rawTarget;
    else if(type==='hours'&&Number.isFinite(rawTarget)&&rawTarget>=0.1)target=rawTarget;
    else if(type==='range'&&Number.isFinite(rawTarget)&&rawTarget>=0.5&&rawTarget<=24)target=rawTarget;
    const out={
    key:h.key.slice(0,80),name:h.name.slice(0,40),icon:typeof h.icon==='string'?h.icon.slice(0,8):'•',
    color:/^#[0-9a-f]{6}$/i.test(h.color||'')?h.color:'#7FA0B4',type:type,
    target:target,unit:typeof h.unit==='string'?h.unit.slice(0,8):'',size:h.size==='wide'?'wide':'square',
    start:/^\d{2}:\d{2}$/.test(h.start||'')?h.start:'23:00',end:/^\d{2}:\d{2}$/.test(h.end||'')?h.end:'07:00',
    timerMinutes:Math.max(1,Math.min(180,Math.round(Number(h.timerMinutes)||25))),
    archived:h.archived===true, deleted:h.deleted===true, remindAt:/^\d{2}:\d{2}$/.test(h.remindAt||'')?h.remindAt:'',   
    remindDays:(['all','weekdays','weekends'].indexOf(h.remindDays)>=0||/^[0-6](,[0-6])*$/.test(String(h.remindDays||'')))?h.remindDays:'all'   
    };
    if(/^\d{4}-\d{2}-\d{2}$/.test(h.archivedAt||''))out.archivedAt=h.archivedAt;   /* 归档时间：保留，避免归档习惯回迁为普通习惯 */
    if(/^\d{4}-\d{2}-\d{2}$/.test(h.deletedAt||''))out.deletedAt=h.deletedAt;      /* 删除时间：保留，已删除习惯不因导入复活 */
    if(/^\d{4}-\d{2}-\d{2}$/.test(h.createdAt||''))out.createdAt=h.createdAt;      /* 创建日：统计分母起算点，缺失时加载即兜底推导 */
    Object.assign(out,window.HabitRules.cleanPlan(h));
    /* 白名单之外的习惯字段（将来新增的提醒/排序/分组等）安全透传，杜绝"导入后设置丢失" */
    for(const k of Object.keys(h)){
      if(HABIT_FIXED[k])continue;
      if(!/^[A-Za-z0-9_]{1,40}$/.test(k))continue;
      const sv=cleanVal(h[k],1); if(sv!==undefined)out[k]=sv;
    }
    return out;
  }):[];
  const days={};Object.keys(src.days).sort().slice(-20000).forEach(function(ds){   /* 与 store.js days 上限对齐：超限时保留最近 2 万天，截断数由 import_dropped 明示 */
    if(!/^\d{4}-\d{2}-\d{2}$/.test(ds)||!src.days[ds]||typeof src.days[ds]!=='object')return;
    const d=src.days[ds],out={};Object.keys(d).forEach(function(k){
      if(['__proto__','constructor','prototype'].includes(k))return;
      if(!/^[A-Za-z0-9_:-]{1,90}$/.test(k)&&k!=='mood'&&k!=='memo'&&k!=='memoHtml')return;
      const v=d[k];if(typeof v==='string')out[k]=v.slice(0,200000);else if(typeof v==='number'&&Number.isFinite(v))out[k]=v;else if(typeof v==='boolean')out[k]=v;
    });days[ds]=out;
  });
  const srcMemo=src.memo&&typeof src.memo==='object'&&!Array.isArray(src.memo)?src.memo:{};
  let memoHtml=typeof srcMemo.html==='string'?srcMemo.html.slice(0,2000000):'';
  let memoText=typeof srcMemo.text==='string'?srcMemo.text.slice(0,200000):'';
  if(!memoHtml&&!memoText){  
    Object.keys(days).sort().forEach(function(ds){
      const d=days[ds];
      if(d&&(d.memoHtml||d.memo)){memoHtml=typeof d.memoHtml==='string'?d.memoHtml:'';memoText=typeof d.memo==='string'?d.memo:'';}
    });
  }
  memoHtml=sanitizeMemoHtml(memoHtml);
  /* 多便签：上限与主进程 store.js fieldSane 对齐（2000）——超上限整包字段会被拒收，
     重启后静默回滚；超限时保留最近 2000 条，截断数由 import_dropped 明示 */
  const NOTE_LIMIT=2000;
  const NOTE_FIXED={id:1,ts:1,title:1,html:1,text:1};
  const seenNoteId=Object.create(null);
  const rawNotes=Array.isArray(src.memoNotes)?src.memoNotes.filter(n=>n&&typeof n==='object'):[];
  if(rawNotes.length>NOTE_LIMIT)rawNotes.sort(function(a,b){return (Number(b&&b.ts)||0)-(Number(a&&a.ts)||0);});
  const memoNotes=rawNotes.slice(0,NOTE_LIMIT).map(n=>{
    let nid=String(n.id||('n'+Date.now())).slice(0,80);
    if(!nid||seenNoteId[nid])nid='n'+Date.now()+'_'+Math.random().toString(36).slice(2,8);   /* id 去重，避免覆盖 */
    seenNoteId[nid]=1;
    const out={id:nid,ts:Number(n.ts)||Date.now(),title:String(n.title||'').slice(0,120),html:sanitizeMemoHtml(typeof n.html==='string'?n.html.slice(0,2000000):''),text:typeof n.text==='string'?n.text.slice(0,200000):''};
    for(const k of Object.keys(n)){
      if(NOTE_FIXED[k])continue;
      if(!/^[A-Za-z0-9_]{1,40}$/.test(k))continue;
      const sv=cleanVal(n[k]); if(sv!==undefined)out[k]=sv;
    }
    return out;
  });
  /* 待办（3.1.0）：上限与主进程 store.js fieldSane 对齐（2000），超限保留最近创建的，
     截断数由 import_dropped 明示。每项做形状归一：文本截断、优先级钳到 0-3、日期格式校验、子任务 ≤20 */
  const TODO_LIMIT=2000;
  const rawTodos=Array.isArray(src.todos)?src.todos.filter(t=>t&&typeof t==='object'):[];
  if(rawTodos.length>TODO_LIMIT)rawTodos.sort(function(a,b){return (Number(b&&b.createdAt)||0)-(Number(a&&a.createdAt)||0);});
  const seenTodoId=Object.create(null);
  const todos=rawTodos.slice(0,TODO_LIMIT).map(t=>{
    let tid=String(t.id||('t'+Date.now())).slice(0,80);
    if(!tid||seenTodoId[tid])tid='t'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    seenTodoId[tid]=1;
    const due=(typeof t.due==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.due))?t.due:null;
    const subs=(Array.isArray(t.subs)?t.subs:[]).slice(0,20).map(s=>(s&&typeof s==='object')?{
      id:String(s.id||('s'+Date.now())).slice(0,80),
      text:String(s.text||'').slice(0,500),
      done:s.done===true
    }:null).filter(Boolean).filter(function(s){return s.text;});   /* 空文本子任务丢弃，与编辑抽屉保存口径一致 */
    return {
      id:tid,
      text:String(t.text||'').slice(0,500),
      note:typeof t.note==='string'?t.note.slice(0,2000):'',
      priority:Math.min(3,Math.max(0,Math.floor(Number(t.priority)||0))),
      done:t.done===true,
      createdAt:Number(t.createdAt)||Date.now(),
      doneAt:t.doneAt?Number(t.doneAt)||null:null,
      due:due,
      pinned:t.pinned===true,
      subs:subs
    };
  });
  const srcProfile=src.profile&&typeof src.profile==='object'?src.profile:{};
  const avatarImg=typeof srcProfile.avatarImg==='string'&&/^data:image\/(?:png|jpe?g|webp);base64,/i.test(srcProfile.avatarImg)&&srcProfile.avatarImg.length<=500000?srcProfile.avatarImg:'';
  const profile={name:String(srcProfile.name||'用户').slice(0,40),avatar:String(srcProfile.avatar||'☕').slice(0,100),avatarImg:avatarImg,motto:typeof srcProfile.motto==='string'?srcProfile.motto.slice(0,160):''};
  const srcSettings=src.settings&&typeof src.settings==='object'&&!Array.isArray(src.settings)?src.settings:{};
  /* 提醒设置：拆分后的 remindPerHabit/remindSummary 优先，老备份只有总闸 remind 时两者都回落到它；
     其余键（静默时段/提醒方式/通知时间等）安全透传 */
  const settings={
    remindPerHabit: srcSettings.remindPerHabit!==undefined ? srcSettings.remindPerHabit!==false : srcSettings.remind!==false,
    remindSummary:  srcSettings.remindSummary!==undefined  ? srcSettings.remindSummary!==false  : srcSettings.remind!==false,
    sound: srcSettings.sound!==false
  };
  Object.keys(srcSettings).forEach(function(k){
    if(k==='remind'||k==='remindPerHabit'||k==='remindSummary'||k==='sound')return;
    if(!/^[A-Za-z0-9_]{1,40}$/.test(k))return;
    const sv=cleanVal(srcSettings[k],1); if(sv!==undefined)settings[k]=sv;
  });
  const srcMeta=src.meta&&typeof src.meta==='object'&&!Array.isArray(src.meta)?src.meta:{};
  let hs0=srcMeta.heatStartDate;   /* 导入数据里的历史记录不应被标成“开始使用前”灰格 */
  if(!/^\d{4}-\d{2}-\d{2}$/.test(hs0||'')){let mn=null;Object.keys(days).forEach(function(ds){if(!mn||ds<mn)mn=ds;});hs0=(mn&&mn<todayStr())?mn:todayStr();}
  const meta={sampleLoaded:!!srcMeta.sampleLoaded,notifiedStreak:srcMeta.notifiedStreak&&typeof srcMeta.notifiedStreak==='object'&&!Array.isArray(srcMeta.notifiedStreak)?srcMeta.notifiedStreak:{},exportRemindAt:Number(srcMeta.exportRemindAt)||0,heatStartDate:hs0};
  /* meta 其余键（提醒时间戳、归档索引等附加状态）透传，避免静默丢失 */
  const META_FIXED={sampleLoaded:1,notifiedStreak:1,exportRemindAt:1,heatStartDate:1,activeTimer:1};
  Object.keys(srcMeta).forEach(function(k){
    if(META_FIXED[k])return;
    if(!/^[A-Za-z0-9_]{1,40}$/.test(k))return;
    const sv=cleanVal(srcMeta[k],1); if(sv!==undefined)meta[k]=sv;
  });
  const pending=srcMeta.activeTimer;
  const pendingHabit=pending&&habits.find(h=>h.key===pending.key&&h.type==='hours'&&!h.archived&&!h.deleted);
  const total=Math.floor(Number(pending&&pending.totalSeconds));
  const remaining=Math.floor(Number(pending&&pending.remainingSeconds));
  const validPending=pendingHabit&&/^\d{4}-\d{2}-\d{2}$/.test(pending.dayKey||'')&&Number.isFinite(total)&&total>=1&&total<=10800&&Number.isFinite(remaining)&&remaining>=0&&remaining<=total;
  if(validPending&&pending.paused){meta.activeTimer={key:pending.key,totalSeconds:total,remainingSeconds:remaining,endAt:null,dayKey:pending.dayKey,paused:true};}
  if(validPending&&!pending.paused&&Number.isFinite(Number(pending.endAt))&&Number(pending.endAt)>0){meta.activeTimer={key:pending.key,totalSeconds:total,remainingSeconds:remaining,endAt:Number(pending.endAt),dayKey:pending.dayKey,paused:false};}
  if(meta.activeTimer){meta.activeTimer.recoveryPending=true;meta.activeTimer.paused=true;meta.activeTimer.endAt=null;}
  const out={days:days,habits:habits,memo:{html:memoHtml,text:memoText},memoNotes:memoNotes,todos:todos,profile:profile,settings:settings,meta:meta};
  /* 白名单之外的顶层字段（后续版本新增的数据段）安全透传，避免静默丢弃 */
  Object.keys(src).forEach(function(k){
    if(out[k]!==undefined)return;
    if(!/^[A-Za-z0-9_]{1,40}$/.test(k))return;
    const sv=cleanVal(src[k],1); if(sv!==undefined)out[k]=sv;
  });
  return out;
}
function importBackupFile(file){
  /* 导入前后做计数对比 + 读备份信封：原来既不认版本（更新版的文件当同版直接覆盖），
     也只是「导入成功」四个字，被清洗器丢掉了多少习惯/天数/便签用户完全不知道。 */
  const reader=new FileReader();reader.onload=function(){try{
    const raw=JSON.parse(String(reader.result||''));
    const env=(raw&&typeof raw==='object'&&raw.data&&typeof raw.data==='object')?raw:null;
    const src=env?env.data:raw;
    if(!src||typeof src!=='object'||!src.days) return toast(T('t_import_bad'),'backup');
    const before={h:Array.isArray(src.habits)?src.habits.length:0, d:Object.keys(src.days||{}).length, n:Array.isArray(src.memoNotes)?src.memoNotes.length:0, t:Array.isArray(src.todos)?src.todos.length:0};
    const imported=normalizeImported(raw);
    if(!imported)return toast(T('t_import_bad'),'backup');
    const after={h:Array.isArray(imported.habits)?imported.habits.length:0, d:Object.keys(imported.days||{}).length, n:Array.isArray(imported.memoNotes)?imported.memoNotes.length:0, t:Array.isArray(imported.todos)?imported.todos.length:0};
    const dropped=(before.h-after.h)+(before.d-after.d)+(before.n-after.n)+(before.t-after.t);

    const ver=env?Number(env.version)||1:1;
    let msg=T('import_preview')
      .replace('{h}',after.h).replace('{d}',after.d).replace('{n}',after.n)
      +' · '+(env&&env.exportedAt?T('import_from').replace('{t}',String(env.exportedAt).slice(0,10).replace(/-/g,'/')):T('import_legacy'));
    if(ver>1) msg+='\n'+T('import_newver').replace('{v}',ver);
    if(dropped>0) msg+='\n'+T('import_dropped').replace('{n}',dropped);
    msg+='\n\n'+T('confirm_import');
    showConfirm(T('import_title'),msg,async function(){
      try{
      await flushRendererChanges();
      recoverOrphanHabitRecords(imported);
      if(window.hbShell&&window.hbShell.importDoc){
        var result=await window.hbShell.importDoc(WIN_TOKEN,imported);
        if(!result||!result.ok)throw new Error((result&&result.message)||'导入未完成');
      }else{
        var backup=await window.hbShell.backupNow();
        if(!backup||!backup.ok)throw new Error('备份失败，已取消导入');
        if(!await hbSaveFields(imported))throw new Error('未能保存导入内容');
      }
      data=imported;syncHabits();
      /* 便签列表整体替换：原 curNoteId 可能已不存在，重定位到最新一条，避免停留在空白编辑态 */
      const ns=(data.memoNotes&&data.memoNotes.length)?data.memoNotes.slice().sort(function(a,b){return (b.ts||0)-(a.ts||0);}):[];
      curNoteId=ns.length?ns[0].id:null;
      

      renderStaticI18n();applyTheme();renderAll();renderMemoList();renderMemo();
      toast(dropped>0?T('t_import_ok_part').replace('{n}',dropped):T('t_import_ok'),'good');
      }catch(error){toast('导入失败：'+error.message,'bad');}
    });
  }catch(err){console.error('[backup] import failed',err);toast(T('t_import_bad'),'backup');}};
  reader.onerror=function(){toast(T('t_import_bad'),'backup');};reader.readAsText(file);
}
function initBackupImport(){const input=document.getElementById('backupFile');if(input)input.addEventListener('change',function(){if(input.files&&input.files[0])importBackupFile(input.files[0]);input.value='';});}

