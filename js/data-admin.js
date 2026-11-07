/* ============ 数据管理：备份 / 数据目录操作（v2.1，实际读写都在主进程 store.js） ============ */
function shortPath(p){
  if(!p)return '';
  try{
    var parts=String(p).split(/[\\/]/).filter(Boolean);
    if(parts.length<=2)return String(p);
    return '…\\'+parts.slice(-2).join('\\');
  }catch(_){return String(p);}
}
/* 整档重新装载（数据目录迁移后）：从主进程取回新根存档并整体重渲染（不 reload 窗口） */
function applyReloadedDoc(){
  try{
    if(!hbAvailable())return;
    var res=window.hbShell.dataLoadSync();
    if(res&&res.doc){data=fillDocDefaults(res.doc);noteBases=new Map((data.memoNotes||[]).map(n=>[n.id,noteContent(n)]));syncHabits();renderStaticI18n();applyTheme();renderAll();renderMemoList();renderMemo();if(!IS_EDITOR_WIN)prepareTimerRecovery();}
  }catch(_){}
}
 
function corruptRestoreFlow(){
  if(!window.hbShell||!window.hbShell.corruptList)return;
  window.hbShell.corruptList().then(function(list){
    if(!list||!list.length){ toast('没有可恢复的损坏存档'); return; }
    var lines=list.map(function(c,i){
      return (i+1)+'. '+c.file.replace('data-corrupt-','').replace(/-/g,'/')+'（'+(c.ok?('约 '+c.days+' 天 · 习惯 '+c.habits):'内容仍无法解析')+'）';
    }).join('\n');
    showConfirm('恢复损坏存档','检测到 '+list.length+' 份损坏存档：\n\n'+lines+'\n\n点「确定」恢复最近的一份；当前数据会先自动备份，随时可在备份目录找回。',function(){
      var target=list[0].file;
      Promise.resolve(window.hbShell.corruptRestore(target)).then(function(r){
        if(r&&r.ok){ toast('已恢复损坏存档（当前数据已先备份）','good'); try{applyReloadedDoc();}catch(_){} try{refreshBackupState();}catch(_){} }
        else toast((r&&r.message)||'恢复失败','bad');
      }).catch(function(){ toast('恢复失败','bad'); });
    },true);
  }).catch(function(){ toast('读取损坏存档失败','bad'); });
}
async function refreshBackupState(){
  const bs=document.getElementById('backupState'); if(!bs)return;
  if(!hbAvailable()){ bs.textContent=T('backup_state_never'); return; }
  var st=null;
  try{ st=await Promise.resolve(window.hbShell.backupStatus()); }catch(_){}
  if(!st||!st.ok){ bs.textContent=T('backup_state_never'); return; }
  var line=(st.lastAt?T('backup_state_last').replace('{t}',relTimeLabel(st.lastAt)):T('backup_state_never'))
    +' · '+T('backup_state_cfg').replace('{d}',st.intervalDays).replace('{k}',st.keep).replace('{n}',st.count);
  if(data.meta&&data.meta.corruptRecovered)line=T('corrupt_line')+' · '+line;
  bs.textContent=line;
  var bi=document.getElementById('backupIntervalSub');
  if(bi)bi.textContent=T('backup_interval_sub').replace('{d}',st.intervalDays);
  var bk=document.getElementById('backupKeepSub');
  if(bk)bk.textContent=T('backup_keep_sub').replace('{k}',st.keep);
  var dd=document.getElementById('dataDirSub');
   
  try{
    if(window.hbShell&&window.hbShell.corruptList){
      window.hbShell.corruptList().then(function(list){
        var card=bs.nextElementSibling;
        if(!card||!card.classList.contains('menu-card'))return;
        var row=document.getElementById('corruptRow');
        if(!Array.isArray(list)||!list.length){ if(row)row.remove(); return; }
        if(!row){
          row=document.createElement('div');row.id='corruptRow';row.className='menu-item';
          row.setAttribute('role','button');row.tabIndex=0;
          row.innerHTML='<div class="mi-ico" style="background:var(--gold-t);color:var(--gold)">🛠</div>'
            +'<div class="mi-txt"><div class="mi-t">恢复损坏存档</div><div class="mi-s" id="corruptSub"></div></div>'
            +'<div class="mi-arrow">›</div>';
          row.onclick=function(){ corruptRestoreFlow(); };
          card.insertBefore(row,card.firstChild);
        }
        row.querySelector('#corruptSub').textContent='检测到 '+list.length+' 份可恢复的存档 · 点击恢复最近一份';
      }).catch(function(){});
    }
  }catch(_){}
  if(dd)dd.textContent=T('dir_sub_cur').replace('{d}',shortPath(st.root));
  var pt=document.getElementById('portableSub');
  if(pt)pt.textContent=st.portable?T('portable_sub_on'):T('portable_sub_off');
}
async function backupNowManual(){
  if(!hbAvailable()||!window.hbShell.backupNow){toast(T('backup_need_shell'),'bad');return;}
  if(backupNowManual.busy)return;
  backupNowManual.busy=true;setDataOperationState(true);
  try{
    await flushRendererChanges();toast(T('backup_doing'),'backup');
    var r=await window.hbShell.backupNow();
    if(r&&r.ok)toast(T('t_backup_ok'),'good');
    else toast(T('t_backup_fail')+((r&&r.message)?('：'+r.message):''),'bad');
    refreshBackupState();
  }catch(error){toast(T('t_backup_fail')+'：'+error.message,'bad');}
  finally{backupNowManual.busy=false;setDataOperationState(false);}
}
function setDataOperationState(busy){
  var section=document.querySelector('.settings-section:has(#portableSub)');
  if(!section)return;
  section.inert=busy;section.setAttribute('aria-busy',String(busy));
  var status=document.getElementById('dataOperationStatus');
  if(!status){status=document.createElement('p');status.id='dataOperationStatus';status.className='heat-scroll-hint';status.setAttribute('role','status');section.parentNode.insertBefore(status,section);}
  status.textContent='正在处理数据，请稍候…';status.hidden=!busy;
}
async function cycleBackupCfg(which){
  if(!hbAvailable()||!window.hbShell.configSet){toast(T('backup_need_shell'),'bad');return;}
  try{
    var c=await Promise.resolve(window.hbShell.configGet());
    if(which==='interval'){
      var iv=[1,3,7],i=iv.indexOf(Number(c.backupIntervalDays)||1);
      var nv=iv[(i+1)%iv.length];
      await Promise.resolve(window.hbShell.configSet({backupIntervalDays:nv}));
      toast(T('backup_interval_done').replace('{d}',nv),'good');
    }else{
      var kp=[3,5,7,10],j=kp.indexOf(Number(c.backupKeep)||7);
      var nk=kp[(j+1)%kp.length];
      await Promise.resolve(window.hbShell.configSet({backupKeep:nk}));
      toast(T('backup_keep_done').replace('{k}',nk),'good');
    }
    refreshBackupState();
  }catch(e){toast(T('t_backup_fail'),'bad');}
}
/* 目录迁移成功后的公共收尾：重载文档 + 可选清理旧目录（二次确认，绝不自动删） */
function afterRootMoved(res){
  applyReloadedDoc();
  refreshBackupState();
  if(res&&res.moved&&res.oldRoot){
    showConfirm(T('dir_purge_title'),T('dir_purge_msg').replace('{o}',res.oldRoot),function(){
      Promise.resolve(window.hbShell.purgeOldRoot()).then(function(p){
        toast(p&&p.ok?T('dir_purge_ok'):T('t_backup_fail'),p&&p.ok?'good':'bad');
        refreshBackupState();
      }).catch(function(){toast(T('t_backup_fail'),'bad');});
    },true);
  }
}
var dataRootBusy=false;
async function migrateDataRoot(patch,doneText){
  if(dataRootBusy)return;
  dataRootBusy=true;
  setDataOperationState(true);
  try{
    await flushRendererChanges();
    var result=await window.hbShell.setDataRoot(patch);
    if(result&&result.conflict){
      showConfirm('目标目录已有存档','两份数据都会先保留备份。迁移后使用当前存档，目标原存档可从备份恢复。\n\n目标：'+result.root,function(){migrateDataRoot(Object.assign({},patch,{replaceExisting:true}),doneText);},true,{confirm:'备份两侧并迁移',cancel:'取消'});
      return;
    }
    if(!result||!result.ok){toast((result&&result.message)||T('t_backup_fail'),'bad');return;}
    toast(doneText,'good');
    if(result.targetBackup)toast('目标原存档已保留：'+result.targetBackup,'backup');
    afterRootMoved(result);
  }catch(error){toast(T('t_backup_fail')+'：'+error.message,'bad');}
  finally{dataRootBusy=false;setDataOperationState(false);}
}
async function moveDataDir(){
  if(!hbAvailable()||!window.hbShell.pickDir){toast(T('backup_need_shell'),'bad');return;}
  var pick=await Promise.resolve(window.hbShell.pickDir());
  if(!pick||!pick.ok||!pick.dir)return;   /* 用户取消选择 */
  var target=String(pick.dir);
  showConfirm(T('dir_move_title'),T('dir_move_msg').replace('{d}',target),async function(){
    await migrateDataRoot({dataDir:target,portable:false},T('dir_moved'));
  },true);
}
async function togglePortable(){
  if(!hbAvailable()||!window.hbShell.setDataRoot){toast(T('backup_need_shell'),'bad');return;}
  var c=await Promise.resolve(window.hbShell.configGet());
  var want=!c.portable;
  showConfirm(T('portable_title'),T(want?'portable_confirm_on':'portable_confirm_off'),async function(){
    await migrateDataRoot({portable:want},T('portable_done'));
  },true);
}
function openSheet(id){
  var mask=document.getElementById('mask'),sheet=document.getElementById(id);
  if(!mask||!sheet)return;
  mask.classList.add('show');sheet.inert=false;sheet.classList.add('show');
  if(window.HabitUI)window.HabitUI.sheetOpened(id);
}
function closeSheet(force){
  if(window.HabitUI&&!window.HabitUI.allowSheetClose(!!force))return false;
  document.getElementById('mask').classList.remove('show');
  document.querySelectorAll('.sheet').forEach(s=>{s.inert=true;s.classList.remove('show');});
  if(window.HabitUI)window.HabitUI.sheetClosed();
  return true;
}
function backToHabits(){closeSheet();}   /* 编辑器从管理面板打开时，返回=关弹层、回到面板 */

/* ============ toast + 保存标记 ============ */


function toast(msg,cls){
  const el=document.createElement('div');el.className='toast '+(cls||'');el.textContent=msg;
  document.getElementById('toastWrap').appendChild(el);
  setTimeout(()=>{el.style.transition='.4s';el.style.opacity='0';el.style.transform='translateY(-10px)';setTimeout(()=>el.remove(),400);},2800);
}



function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
/* 嵌进 onclick="fn('${}')" 这类「HTML 属性里的 JS 单引号字符串」的值：先做 JS 转义再 HTML 转义。
   只用 esc 的话 &#39; 会在属性解析后还原成 '，对 JS 字符串上下文并不构成保护。 */
function jsStr(s){return esc(String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"));}
/* 渲染期的颜色白名单：导入/旧档可携带任意字符串，直接拼进 style 是 CSS 注入面 */
function cssColor(c){return /^#[0-9a-fA-F]{3,8}$/.test(String(c||''))?c:'#7FA0B4';}
