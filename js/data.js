/* ============ 数据层：主进程持久化（v2.1 存储架构升级） ============
   data.json / images/ / auto-backup/ 由主进程 store.js 持有与落盘；localStorage 旧键只在
   迁移时读取一次，永不回写、永不删除（红线 5：迁移源保留，老版本可回退）。跨窗协作协议：
   - 主窗拥有 days/habits/settings/profile/meta；编辑窗拥有 memo/memoNotes（字段属主制）；
   - 每窗持有随机 WIN_TOKEN，主进程广播 hb-data-changed 带回 token，发起方自己忽略；
   - 旧「hb_editor_open 心跳 + 30s 新鲜度 + storage 事件」协议整体退役。 */
var WIN_TOKEN='w'+Math.random().toString(36).slice(2,10);
var pendingCommits=new Set(),lastCommitFailed=false;
function hbAvailable(){return typeof window.hbShell!=='undefined'&&!!window.hbShell.dataLoadSync;}
function hbSaveFields(fields,write){
  if(!hbAvailable())return Promise.resolve(true);
  setSaveState('saving');
  var commit=Promise.resolve().then(function(){
    if(write)return write();
    if(window.hbShell.dataCommit)return window.hbShell.dataCommit(WIN_TOKEN,fields);
    window.hbShell.dataSave(WIN_TOKEN,fields);return {ok:true};
  }).then(function(result){
    if(result&&result.ok&&fields.noteChanges)acknowledgeNoteChanges(fields.noteChanges,result.noteConflicts||[]);
    lastCommitFailed=!(result&&result.ok);
    if(lastCommitFailed){setSaveState('error');toast((result&&result.message)||'未能保存，请检查磁盘空间后重试','bad');}
    return !lastCommitFailed;
  }).catch(function(error){lastCommitFailed=true;setSaveState('error');toast('保存失败：'+error.message,'bad');return false;});
  pendingCommits.add(commit);
  commit.then(function(){pendingCommits.delete(commit);if(!pendingCommits.size&&!lastCommitFailed&&!(typeof memoOrderNeedsSave!=='undefined'&&memoOrderNeedsSave))setSaveState('saved');});
  return commit;
}
function setSaveState(state){
  var label=T(state==='saving'?'save_state_saving':state==='error'?'save_state_error':'save_state_saved');
  ['appSaveStatus','memoSaveStatus'].forEach(function(id){var el=document.getElementById(id);if(!el)return;el.dataset.state=state;el.title=label;el.setAttribute('aria-label',label);if(id==='appSaveStatus')el.textContent=label;});
}
async function flushRendererChanges(){
  if(typeof checkpointTimer==='function'&&!IS_EDITOR_WIN)checkpointTimer(false);
  if(typeof memoCommitPending!=='undefined'&&memoCommitPending)commitMemoHtml();
  var changed=!!_saveTimer||(!IS_EDITOR_WIN&&!!activeTimer());
  if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null;}
  if(typeof memoTimer!=='undefined'&&memoTimer){clearTimeout(memoTimer);memoTimer=null;changed=true;}
  if(typeof mottoSaveTimer!=='undefined'&&mottoSaveTimer){clearTimeout(mottoSaveTimer);mottoSaveTimer=null;changed=true;}
  if(changed||lastCommitFailed)await save();
  await Promise.all(Array.from(pendingCommits));
  if(typeof memoOrderNeedsSave!=='undefined'&&memoOrderNeedsSave)await persistNoteOrder();
  if(lastCommitFailed||(typeof memoOrderNeedsSave!=='undefined'&&memoOrderNeedsSave))throw new Error('仍有未保存内容，请重试保存');
  return true;
}
window.flushRendererChanges=flushRendererChanges;
/* 便签图片落盘：压缩后的 dataURL → 主进程 images/<id>.<ext>，回调返回 hbimg:// 引用。
   无数据层或写失败时回调 null，调用方一律退回内嵌 dataURL（绝不丢图）。 */
function hbPersistMemoImage(dataUrl,cb){
  if(!hbAvailable()||!/^data:image\//i.test(dataUrl||'')){cb(null);return;}
  try{
    Promise.resolve(window.hbShell.writeImage(dataUrl)).then(function(r){
      cb(r&&r.ok&&r.ref?r.ref:null);
    }).catch(function(){cb(null);});
  }catch(_){cb(null);}
}


const APP_BUILD='2026-11-07-v1.1.0-beta.1';
var MAIN_BUILD=(function(){try{var m=(location.search||'').match(/[?&]build=([^&]+)/);return m?decodeURIComponent(m[1]):'';}catch(_){return '';}})();

/* —— 矢量图标库（描边式，stroke:currentColor 自动跟随文字色/主题） —— */
/* 除用户可自定义的「习惯图标 / 头像 / 心情表情」外，界面所有装饰图标统一用它 */
const ICN_P={ // 每个图标的内部路径（24x24 viewBox）
  pin:'<circle cx="12" cy="10" r="3.2"/><path d="M12 21c4.5-4.2 7-7.5 7-11a7 7 0 1 0-14 0c0 3.5 2.5 6.8 7 11z"/>',
  check:'<path d="M20 6.5 9.2 17.3 4 12.1"/>',
  palette:'<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-3.9-4-6.4-9-6.4z"/><circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/>',
  sprout:'<path d="M12 20v-8"/><path d="M12 12c0-3-2.2-5.2-5.5-5.2C6 10 8.2 12 12 12z"/><path d="M12 13c0-3.4 2.4-5.8 6-5.8-.2 3.8-2.6 5.8-6 5.8z"/>',
  chart:'<path d="M4 20h16"/><rect x="6" y="11" width="3" height="6" rx="1"/><rect x="11" y="7" width="3" height="10" rx="1"/><rect x="16" y="13" width="3" height="4" rx="1"/>',
  fire:'<path d="M12 3c.5 3-1.8 4.2-2.8 5.8C8 10.6 8 12 8 12.6a4 4 0 1 0 8 0c0-2.2-1.4-3.4-1.4-5C13.3 6.2 13.6 4.4 12 3z"/>',
  trend:'<path d="M3 17l5-5 3.5 3.5L20 7"/><path d="M15 7h5v5"/>',
  thought:'<path d="M8 15a4.5 4.5 0 1 1 3.3-7.6A4 4 0 0 1 18 10a3.5 3.5 0 0 1-.5 7H8z"/><circle cx="6" cy="19" r="1.3"/>',
  trophy:'<path d="M7 4h10v3a5 5 0 0 1-10 0z"/><path d="M7 5H4.5a2.5 2.5 0 0 0 3 2.4"/><path d="M17 5h2.5a2.5 2.5 0 0 1-3 2.4"/><path d="M12 12v3"/><path d="M9 19h6"/><path d="M10 15h4l.5 4h-5z"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/>',
  save:'<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="4"/>',
  phone:'<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M10.5 18h3"/>',
  bell:'<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0"/>',
  sound:'<path d="M5 9v6h3.5L14 20V4L8.5 9z"/><path d="M17 8.5a4 4 0 0 1 0 7"/>',
  upload:'<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
  download:'<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
  broom:'<path d="M16 4l-6.5 6.5"/><path d="M9 10l5 5"/><path d="M7 13l4 4-5.5 3L4 18z"/>',
  calendar:'<rect x="4" y="5" width="16" height="16" rx="2.5"/><path d="M4 9h16M8 3v4M16 3v4"/><path d="M8.5 14l2 2 3.5-3.5"/>',
  camera:'<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7l1.5-2.5h4L15.5 7"/><circle cx="12" cy="13.5" r="3.2"/>',
  seedling:'<path d="M12 20v-7"/><path d="M12 13C12 9 9 7 5 7c0 4 3 6 7 6z"/><path d="M12 15c0-3.2 2.4-5.2 6-5.2-.2 3.6-2.8 5.2-6 5.2z"/>',
  gem:'<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4 7 9l5 11M15 4l2 5-5 11"/>',
  crown:'<path d="M4 8l3.5 3L12 5l4.5 6L20 8l-1.5 10h-13z"/><path d="M5.5 18h13"/>',
  star:'<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.6 1-5.8L3.5 9.7l5.9-.9z"/>',
  medal:'<circle cx="12" cy="14" r="5"/><path d="M8.5 9.5 6 3h4l1.5 3.5M15.5 9.5 18 3h-4l-1.5 3.5"/><path d="M12 12l.8 1.6 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2z" fill="currentColor" stroke="none"/>',
  rainbow:'<path d="M4 18a8 8 0 0 1 16 0"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M10 18a2 2 0 0 1 4 0"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  hash:'<path d="M9 4 7.5 20M16.5 4 15 20M4 9h15.5M3.5 15H19"/>',
  moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  edit:'<path d="M16 4l4 4L8 20H4v-4z"/><path d="M13.5 6.5l4 4"/>',
  trash:'<path d="M5 7h14M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  party:'<path d="M4 20l4.5-11 6.5 6.5z"/><path d="M14 4c1.5 0 2 1 2 2M17 7c1.5 0 2.5 1 2.5 2.5M13 3l.5 1.5M20 6l-1.5.5M18 11l1 .3"/>',
  warn:'<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.5v.5" fill="currentColor" stroke="currentColor"/>',
  cross:'<path d="M6 6l12 12M18 6 6 18"/>',
  arrowR:'<path d="M5 12h13"/><path d="M13 6l6 6-6 6"/>',
};
function icn(name,size,sw){ // 生成 SVG 字符串
  const p=ICN_P[name]; if(!p) return '';
  const s=size||18, w=sw||2;
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" style="display:block">${p}</svg>`;
}

/* —— 默认习惯（首次/旧数据兜底） —— */
const DEFAULT_HABITS=[
  {key:'water',name:L.habit.water,icon:'💧',type:'count',target:8,unit:T('unit_cup'),color:'#7FA0B4',size:'wide'},
  {key:'sleep',name:L.habit.sleep,icon:'😴',type:'range',target:8,unit:T('unit_hour'),color:'#A794C0',size:'wide',start:'23:00',end:'07:00'},
  {key:'early',name:L.habit.early,icon:'🌅',type:'bool',color:'#D69B72',size:'wide'},
  {key:'exercise',name:L.habit.exercise,icon:'🏃',type:'bool',color:'#8FAE86',size:'wide'},
  {key:'reading',name:L.habit.reading,icon:'📖',type:'hours',target:1,unit:T('unit_hour'),color:'#D08D98',size:'wide'},
  {key:'meditation',name:L.habit.meditation,icon:'🧘',type:'bool',color:'#6EB8AE',size:'wide'},
];
const COLORS=['#7FA0B4','#8FAE86','#D69B72','#A794C0','#D08D98','#E0BC72','#6EB8AE','#E89A82','#8B9DAE','#9BA890'];
const ICONS=['💧','😴','🌅','🏃','📖','🧘','🍎','💪','✍️','🎯','🌙','☀️','🥗','🚶','🎨','🎸','💊','🦷','🧴','🌱','💤','📵','🧹','💰','🌸','☕','🍵','⏰','🐾','🏊','🧎','📝','⌨️','💻','📚','🎧'];
const AVATARS=['☕','🌸','🌿','🦊','🐰','🐱','🌻','🍀','🌙','⭐','🍂','🐻','🦋','🌺','🍩','🧸'];

const MOODS=[
  {key:'happy',emoji:'😄',name:L.mood.happy,color:'#D4A959'},
  {key:'calm',emoji:'😌',name:L.mood.calm,color:'#8DA080'},
  {key:'normal',emoji:'😐',name:L.mood.normal,color:'#B6A99C'},
  {key:'tired',emoji:'😪',name:L.mood.tired,color:'#7E9BB0'},
  {key:'sad',emoji:'😢',name:L.mood.sad,color:'#C77B85'},
];
const MMAP=Object.fromEntries(MOODS.map(m=>[m.key,m]));

/* —— 徽章定义（游戏化） —— */
const BADGES=[
  {id:'first',icon:'🌱',name:L.badge.first[0],desc:L.badge.first[1],test:d=>totalCheckins()>=1,g:{cur:d=>totalCheckins(),goal:1,uzh:'次',uen:'check-ins'}},
  {id:'week',icon:'🔥',name:L.badge.week[0],desc:L.badge.week[1],test:d=>maxStreakAll()>=7,g:{cur:d=>maxStreakAll(),goal:7,uzh:'天',uen:'days'}},
  {id:'14',icon:'💎',name:L.badge['14'][0],desc:L.badge['14'][1],test:d=>maxStreakAll()>=14,g:{cur:d=>maxStreakAll(),goal:14,uzh:'天',uen:'days'}},
  {id:'30',icon:'👑',name:L.badge['30'][0],desc:L.badge['30'][1],test:d=>maxStreakAll()>=30,g:{cur:d=>maxStreakAll(),goal:30,uzh:'天',uen:'days'}},
  {id:'perfect',icon:'⭐',name:L.badge.perfect[0],desc:L.badge.perfect[1],test:d=>hasPerfectDay()},
  {id:'mood',icon:'🎨',name:L.badge.mood[0],desc:L.badge.mood[1],test:d=>moodCount()>=10,g:{cur:d=>moodCount(),goal:10,uzh:'天',uen:'days'}},
  {id:'50',icon:'🏅',name:L.badge['50'][0],desc:L.badge['50'][1],test:d=>totalCheckins()>=50,g:{cur:d=>totalCheckins(),goal:50,uzh:'次',uen:'check-ins'}},
  {id:'100',icon:'🏆',name:L.badge['100'][0],desc:L.badge['100'][1],test:d=>totalCheckins()>=100,g:{cur:d=>totalCheckins(),goal:100,uzh:'次',uen:'check-ins'}},
  {id:'multi',icon:'🌈',name:L.badge.multi[0],desc:L.badge.multi[1],test:d=>activeHabits().length>=5},
  {id:'250',icon:'🥇',name:L.badge['250'][0],desc:L.badge['250'][1],test:d=>totalCheckins()>=250,g:{cur:d=>totalCheckins(),goal:250,uzh:'次',uen:'check-ins'}},
  {id:'record',icon:'🗓️',name:L.badge.record[0],desc:L.badge.record[1],test:d=>recordCount()>=100,g:{cur:d=>recordCount(),goal:100,uzh:'天',uen:'days'}}
];

/* ============ 数据层 ============ */
let HABITS=[], HMAP={};
function syncHabits(){ HABITS=Array.isArray(data.habits)?data.habits:HABITS; HMAP=Object.fromEntries(HABITS.map(h=>[h.key,h])); }
/* 活跃习惯 = 未归档且未删除：今日打卡 / 进度环 / 待办 / 提醒 / 趋势统计均以此为准。
   归档与删除都只是"标记"：习惯定义与全部历史打卡记录原样保留在 data.days 里，不受影响。 */
function activeHabits(){return HABITS.filter(function(h){return !h.archived&&!h.deleted;});}
function habitHasRecord(h,day){
  if(!day||typeof day!=='object')return false;
  return (h.key in day)||(h.key+'_s' in day)||(h.key+'_e' in day);
}
/* 某日期应显示的习惯集合：今天/未来=活跃习惯；往期=活跃 + 当天有记录的已归档/已删除习惯（只读可见，历史不被篡改） */
function habitsVisibleOn(ds){
  const act=activeHabits().filter(h=>window.HabitRules.due(h,ds,data.days)||habitHasRecord(h,dayObj(ds)));
  if(ds>=todayStr())return act;
  const day=dayObj(ds)||{};
  return act.concat(HABITS.filter(function(h){return (h.archived||h.deleted)&&habitHasRecord(h,day);}));
}

let data=load();
var noteBases=new Map((data.memoNotes||[]).map(n=>[n.id,noteContent(n)]));
function noteContent(n){return JSON.stringify([n.html||'',n.text||'',n.title||'']);}
function noteSaveFields(){
  const notes=data.memoNotes||[],changes=[];
  notes.forEach(n=>{const base=noteBases.has(n.id)?noteBases.get(n.id):null;if(noteContent(n)!==base)changes.push({id:n.id,base,note:JSON.parse(JSON.stringify(n))});});
  noteBases.forEach((base,id)=>{if(!notes.some(n=>n.id===id))changes.push({id,base,note:null});});
  return {memo:data.memo,noteChanges:changes};
}
function acknowledgeNoteChanges(changes,conflicts){
  changes.forEach(change=>{
    const conflict=conflicts.find(c=>c.id===change.id);
    if(conflict){
      const note=(data.memoNotes||[]).find(n=>n.id===change.id);
      if(note){note.id=conflict.copyId;note.title=(note.title||'便签')+'（冲突副本）';if(curNoteId===change.id)curNoteId=note.id;noteBases.delete(change.id);noteBases.set(note.id,noteContent({...change.note,title:(change.note.title||'便签')+'（冲突副本）'}));if(conflict.original){data.memoNotes.push(conflict.original);noteBases.set(change.id,noteContent(conflict.original));}const title=document.getElementById('memoEdTitle');if(title&&curNoteId===note.id)title.value=note.title;}
    }else if(change.note)noteBases.set(change.id,noteContent(change.note));else noteBases.delete(change.id);
  });
  if(conflicts.length)toast('检测到其他窗口的修改，已保留双方内容为冲突副本','backup');
}
let _saveTimer=null;
let _pausableTimers=[];
let _todoRefreshTimer=null;
let _autoSaveTimer=null;
function saveDebounced(){setSaveState('saving');clearTimeout(_saveTimer);_saveTimer=setTimeout(function(){_saveTimer=null;save();},300);}
window.addEventListener('beforeunload',function(){try{
  if(_saveTimer){   

    clearTimeout(_saveTimer);_saveTimer=null;
    if(window.hbShell&&window.hbShell.dataSaveSync)window.hbShell.dataSaveSync(WIN_TOKEN,IS_EDITOR_WIN?noteSaveFields():{days:data.days,habits:data.habits,settings:data.settings,profile:data.profile,meta:data.meta,todos:data.todos});
    else save();
  }
}catch(_){} });
/* 热力图从「本机最早记录日」起累计：样例/导入/迁移的已有记录不应被标成“开始使用前”灰格。 */
if(!data.meta)data.meta={};
(function ensureHeatStart(){
  if(/^\d{4}-\d{2}-\d{2}$/.test(data.meta.heatStartDate||''))return;   /* 已存档则不动（兼容老用户） */
  let minDS=null;
  Object.keys(data.days||{}).forEach(function(ds){if(/^\d{4}-\d{2}-\d{2}$/.test(ds)&&(!minDS||ds<minDS))minDS=ds;});
  data.meta.heatStartDate=(minDS&&minDS<todayStr())?minDS:todayStr();
  try{hbSaveFields({meta:data.meta});}catch(e){}
})();
/* 常驻便签：备忘录不再按天存放，独立存于 data.memo，跨天不丢、与打卡互不影响。 */
if(!data.memo||typeof data.memo!=='object'||Array.isArray(data.memo))data.memo={html:'',text:''};
(function migrateLegacyDailyMemo(){
  if(data.memo.html||data.memo.text)return;      // 已有常驻内容则不动
  const days=data.days||{};
  let best=null;
  Object.keys(days).sort().forEach(function(ds){
    const d=days[ds];if(!d)return;
    if(d.memoHtml||d.memo)best={html:d.memoHtml||'',text:d.memo||''};
  });
  if(best){data.memo.html=best.html;data.memo.text=best.text;try{hbSaveFields({memo:data.memo});}catch(e){}}
})();


function recoverOrphanHabitRecords(d){
  if(!d||!d.days||!Array.isArray(d.habits))return 0;
  const priorKeys=new Set(d.habits.map(h=>h&&h.key));
  const countBefore=d.habits.length;
  d.habits=d.habits.filter(function(h){
    if(!h||!h.deleted||!['已删除的习惯','Deleted habit'].includes(h.name))return true;
    return !(h.key==='_late'||h.key==='__note'||(/_(ts|tsb|done)$/.test(h.key)&&priorKeys.has(h.key.replace(/_(ts|tsb|done)$/,''))));
  });
  const known=new Set(d.habits.map(function(h){return h&&h.key;}).filter(Boolean));
  const found={};
  Object.keys(d.days).forEach(function(ds){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(ds))return;
    const day=d.days[ds];if(!day||typeof day!=='object')return;
    Object.keys(day).forEach(function(k){
      if(k==='mood'||k==='memo'||k==='memoHtml'||k.startsWith('_')||/_(s|e|t|ts|tsb|done)$/.test(k))return;
      const base=k.replace(/_(s|e|t)$/,'');   /* _s/_e=时间段，_t=冻结目标（stampTarget）；后缀键都归属主键 */
      if(base!==k||known.has(base))return;      /* 只处理主键；_s/_e 随主键走 */
      const v=day[k];
      if(typeof v!=='boolean'&&typeof v!=='number')return;
      if(!found[base])found[base]={maxNum:0,bool:false,hasRange:false,last:ds};
      const f=found[base];
      if(v===true)f.bool=true;
      if(typeof v==='number'&&Number.isFinite(v)&&v>f.maxNum)f.maxNum=v;
      if(day[base+'_s']||day[base+'_e'])f.hasRange=true;
      if(ds>f.last)f.last=ds;
    });
  });
  let added=countBefore-d.habits.length;
  Object.keys(found).forEach(function(k){
    const f=found[k];
    const def=DEFAULT_HABITS.find(function(x){return x.key===k;});
    const nh=def?Object.assign({},def):{
      key:k,name:(LANG==='en'?'Deleted habit':'已删除的习惯'),icon:'🗂️',color:'#9BA8B4',
      type:f.bool?'bool':'count',target:Math.max(1,Math.ceil(f.maxNum||1)),unit:'',size:'wide'
    };
    if(!def&&f.hasRange){nh.type='range';nh.start='23:00';nh.end='07:00';nh.unit=T('unit_hour');}
    nh.deleted=true;nh.deletedAt=f.last;
    d.habits.push(nh);added++;
  });
  return added;
}
(function(){
  const added=recoverOrphanHabitRecords(data);
  if(added){try{hbSaveFields({habits:data.habits});}catch(e){}}
})();
/* Do not recreate deleted habits. Older builds used a restore migration that made the
   last deleted default habit reappear on the next render. */


var __hbNoSizeMigration = true;   /* 保留标记：明确 size 只由用户编辑习惯时写入，启动流程不得改写 */
let calMonth=new Date();calMonth.setDate(1);
let editingKey=null;
let edSel={icon:ICONS[0],color:COLORS[0],type:'bool',size:'wide'};
let timerTick=null;
let timerSettingKey=null;

/* 提醒开关迁移（v2.3.1）：老总闸 remind 拆成 remindPerHabit/remindSummary，缺省视为开启（与旧默认一致） */
function migrateRemindSettings(s){
  if(s.remind!==undefined){
    if(s.remindPerHabit===undefined)s.remindPerHabit=s.remind===true;
    if(s.remindSummary===undefined)s.remindSummary=s.remind===true;
    delete s.remind;
  }
  if(s.remindPerHabit===undefined)s.remindPerHabit=true;
  if(s.remindSummary===undefined)s.remindSummary=true;
  return s;
}
 
function fillDocDefaults(d){
  if(!d.meta)d.meta={};
  if(!d.meta.notifiedStreak)d.meta.notifiedStreak={};
  if(!d.days)d.days={};
  if(!d.profile)d.profile={name:'用户',avatar:'☕'};
  if(!d.settings||typeof d.settings!=='object'||Array.isArray(d.settings))d.settings={remindPerHabit:true,remindSummary:true,sound:true};
  migrateRemindSettings(d.settings);
  if(!Array.isArray(d.habits))d.habits=(d.meta&&d.meta.habitsCleared===true)?[]:DEFAULT_HABITS.slice();
  d.habits.forEach(function(h){if(h&&typeof h==='object')migrateCreatedAt(h,d.days);});
  if(!d.memo||typeof d.memo!=='object')d.memo={html:'',text:''};
  if(!Array.isArray(d.memoNotes))d.memoNotes=[];
  if(!Array.isArray(d.todos))d.todos=[];
  return d;
}
function sampleDoc(corrupt){
  /* todos 必须给数组：sampleDoc 的返回不经 fillDocDefaults 二次补齐，缺键会让 data.todos=undefined，
     之后每次 save() 提交 {todos:undefined} 都被主进程 fieldSane 拒收——全新安装的待办将永不落盘 */
  return {days:genSample(),habits:DEFAULT_HABITS.slice(),profile:{name:'用户',avatar:'☕'},settings:{remindPerHabit:true,remindSummary:true,sound:true},meta:{sampleLoaded:true,notifiedStreak:{},exportRemindAt:0,corruptRecovered:!!corrupt},todos:[]};
}
function load(){
  /* v2.1 主数据源：主进程 data.json（boot 一次性 sendSync 读内存档，MIGRATIONS 已在主进程执行）。
     迁移由渲染层发起：主进程读不到渲染层 localStorage，检测到「无新存档 + 有旧键」时把原文
     一次交给主进程——主进程先落 legacy-backup-v1.json 原文副本再迁移，任何情况不丢数据。 */
  if(hbAvailable()){
    var res=null;
    try{ res=window.hbShell.dataLoadSync(); }catch(e){ try{console.error('[load] dataLayer error',e);}catch(_){} }
    if(res&&res.notice)window.hbStartupNotice=res.notice;
    if(res&&res.doc&&res.status!=='empty')return fillDocDefaults(res.doc);
    var raw=null;
    try{ raw=localStorage.getItem(LS_KEY); }catch(_){}
    if(raw){
      var m=null;
      try{ m=window.hbShell.dataMigrateSync(raw); }catch(e){ m=null; }
      if(m&&m.ok&&m.doc){
        try{toast('已自动迁移本地数据（原数据已留档，可随时回退）','good');}catch(_){}
        return fillDocDefaults(m.doc);
      }
      /* 迁移失败：旧数据已由主进程另存 legacy 副本（含 corrupt 时间戳副本），
         不创建新存档、不覆盖任何原数据；本次以示例数据启动并明确告知。 */
      try{toast('数据迁移失败：原数据已完整留档，可稍后重试或从「导入备份」恢复','backup');}catch(_){}
      return sampleDoc(true);
    }
    /* 真的没有存档（首次运行）：给示例数据，但不打 corruptRecovered 标记 */
    return sampleDoc(false);
  }
  /* 兜底：无主进程数据层（直接用浏览器打开等）→ 退回旧 localStorage 读档路径 */
  try{
    const raw=localStorage.getItem(LS_KEY);
    if(raw)return fillDocDefaults(JSON.parse(raw));
  }catch(e){
    try{
      const raw=localStorage.getItem(LS_KEY);
      if(raw){ localStorage.setItem(LS_KEY+'_corrupt',raw); localStorage.setItem('hb_corrupt_at',String(Date.now())); }
    }catch(_){}
    return sampleDoc(true);
  }
  return sampleDoc(false);
}
function save(){
  data.habits=HABITS;
  /* v2.1：按「字段属主」提交给主进程（store.js 串行合并 + 原子落盘 + 广播变更）。
     编辑窗只提交 memo/memoNotes；主窗只提交 days/habits/settings/profile/meta——
     两侧字段集不相交，历史「互相覆盖 / 便签被旧快照回滚」问题从机制上消除。
     主窗对便签的刻意操作（删除）走 saveMemoFields()；顺序变更走 persistNoteOrder()。 */
  if(IS_EDITOR_WIN){
    return hbSaveFields(noteSaveFields());
  }else{
    return hbSaveFields({days:data.days,habits:data.habits,settings:data.settings,profile:data.profile,meta:data.meta,todos:data.todos});
  }
}
/* 主窗便签字段变更专用：主窗内存的 memo/memoNotes 经 hb-data-changed 广播保持新鲜，可安全提交 */
function saveMemoFields(){ return hbSaveFields(noteSaveFields()); }
syncHabits();

/* —— 示例数据（12 天，让用户看效果） —— */
function genSample(){
  const days={};const today=new Date();
  for(let i=11;i>=0;i--){
    const dt=new Date(today);dt.setDate(today.getDate()-i);
    const ds=fmt(dt);const o={};
    // 喝水：随机 4~8
    o.water=Math.floor(Math.random()*5)+4;
    // 睡觉：同时保存时长和对应的起止时间，历史卡片才会与统计值一致。
    o.sleep=[6,6.5,7,7.5,8,8,8.5,9][Math.floor(Math.random()*8)];
    const sleepStart=22*60+Math.floor(Math.random()*4)*30;
    const sleepEnd=sleepStart+o.sleep*60;
    const sleepTime=function(minutes){const clock=((minutes%1440)+1440)%1440;return String(Math.floor(clock/60)).padStart(2,'0')+':'+String(clock%60).padStart(2,'0');};
    o.sleep_s=sleepTime(sleepStart);o.sleep_e=sleepTime(sleepEnd);
    // 早起：8成完成
    if(Math.random()>0.2)o.early=true;
    // 运动：6成
    if(Math.random()>0.4)o.exercise=true;
    // 读书：随机 0~2h
    o.reading=[0,0.5,1,1,1.5,2][Math.floor(Math.random()*6)];
    // 冥想：5成
    if(Math.random()>0.5)o.meditation=true;
    // 心情
    o.mood=MOODS[Math.floor(Math.random()*MOODS.length)].key;
    days[ds]=o;
  }
  return days;
}
