/* Backup recovery stays behind an explicit preview and confirmation. */
function initRecoveryTools(){
  const state=document.getElementById('backupState'),card=state&&state.parentNode.querySelector('.menu-card');
  if(!card||document.getElementById('backupHistoryEntry'))return;
  [['backupHistoryEntry','备份历史与恢复','查看记录数量、图片完整性与恢复预览',openBackupHistory],['openDataDirectory','打开当前存档目录','查看当前使用的本地存档',openCurrentDataDirectory],['copyDiagnostics','复制诊断信息','仅版本、系统与数量，不包含正文或个人路径',copyDiagnosticInfo]].forEach(([id,title,sub,action])=>{
    const row=document.createElement('button');row.type='button';row.id=id;row.className='menu-item recovery-menu';row.innerHTML='<span class="mi-ico">'+(id==='backupHistoryEntry'?'↺':id==='openDataDirectory'?'▤':'ⓘ')+'</span><span class="mi-txt"><span class="mi-t">'+title+'</span><span class="mi-s">'+sub+'</span></span><span class="mi-arrow">›</span>';row.onclick=action;card.appendChild(row);
  });
}
async function openCurrentDataDirectory(){try{const r=await window.hbShell.openDataDir();if(!r.ok)throw new Error(r.message);toast('已打开存档目录','good');}catch(error){toast('无法打开目录：'+error.message,'bad');}}
async function copyDiagnosticInfo(){try{const r=await window.hbShell.copyDiagnostics();if(!r.ok)throw new Error(r.message);toast('诊断信息已复制，不包含正文','good');}catch(error){toast('复制失败：'+error.message,'bad');}}
async function openBackupHistory(){
  openSheet('backupHistorySheet');const host=document.getElementById('backupHistoryList');host.textContent='正在读取备份…';
  try{
    const list=await window.hbShell.backupHistory();host.replaceChildren();
    if(!list.length){host.textContent='还没有备份。可先到“我的”点击立即备份。';return;}
    list.forEach(row=>{
      const item=document.createElement('section');item.className='backup-history-item';
      const heading=document.createElement('strong');heading.textContent=row.createdAt?new Date(row.createdAt).toLocaleString():row.name;item.appendChild(heading);
      const text=document.createElement('p');text.textContent=row.ok?row.days+' 天记录 · '+row.habits+' 个习惯 · '+row.notes+' 条随记 · '+row.images+' 张图片':'不可恢复';item.appendChild(text);
      const state=document.createElement('p');state.className='planning-hint';state.textContent=row.integrity;item.appendChild(state);
      const button=document.createElement('button');button.type='button';button.textContent='预览恢复';button.disabled=!row.ok;button.onclick=()=>previewBackupRestore(row.name);item.appendChild(button);host.appendChild(item);
    });
  }catch(error){host.textContent='读取失败：'+error.message;}
}
var restoringBackup=false;
async function previewBackupRestore(name){
  if(restoringBackup)return;
  try{
    await flushRendererChanges();const r=await window.hbShell.backupPreview(name);if(!r.ok)throw new Error(r.message||'无法预览');
    const labels={days:'记录天数',habits:'习惯数量',notes:'随记数量'};
    const diff=Object.keys(labels).map(k=>labels[k]+'：'+r.before[k]+' → '+r.after[k]).join('\n');
    showConfirm('确认恢复备份',diff+'\n\n恢复会替换当前存档。数量相同不代表内容相同。当前存档及图片会先完整备份；恢复后可通过备份历史找回。',()=>performBackupRestore(name,r.token),true,{confirm:'备份当前并恢复',cancel:'保留当前'});
  }catch(error){toast('预览失败：'+error.message,'bad');}
}
async function performBackupRestore(name,token){
  if(restoringBackup)return;restoringBackup=true;setDataOperationState(true);
  const sheet=document.getElementById('backupHistorySheet');sheet.inert=true;
  try{
    const r=await window.hbShell.backupRestore(name,token);if(!r.ok)throw new Error(r.message||'恢复失败');
    applyReloadedDoc();closeSheet(true);refreshBackupState();toast('已恢复，恢复前存档已保留备份','good');
  }catch(error){toast(error.message,'bad');await openBackupHistory();}
  finally{sheet.inert=false;restoringBackup=false;setDataOperationState(false);}
}
