/* Modal confirmation and focus return. */
let confirmCallback=null;
var confirmReturnFocus=null;
function showConfirm(title,msg,onOk,danger,labels){
  document.getElementById('confirmCancel').textContent=(labels&&labels.cancel)||T('cancel');
  document.getElementById('confirmOk').textContent=(labels&&labels.confirm)||T('confirm_ok');
  confirmReturnFocus=document.activeElement;    
  document.getElementById('confirmTitle').textContent=title||'确认';
  document.getElementById('confirmMsg').textContent=msg||'';
  confirmCallback=onOk||null;
  document.getElementById('confirmOk').classList.toggle('danger',!!danger);
  document.getElementById('confirmMask').classList.add('show');
  if(window.HabitUI)window.HabitUI.confirmOpened();
  else setTimeout(function(){try{document.getElementById('confirmOk').focus();}catch(_){}},40);
}
function hideConfirm(){ confirmCallback=null; document.getElementById('confirmMask').classList.remove('show');
  if(confirmReturnFocus&&confirmReturnFocus.focus){try{confirmReturnFocus.focus();}catch(_){}} confirmReturnFocus=null; }
(function(){
  document.getElementById('confirmCancel').onclick=hideConfirm;
  document.getElementById('confirmOk').onclick=function(){ const cb=confirmCallback,rf=confirmReturnFocus; confirmCallback=null;confirmReturnFocus=null; document.getElementById('confirmMask').classList.remove('show'); if(cb)cb(); else if(rf&&rf.focus){try{rf.focus();}catch(_){}} };
  document.getElementById('confirmMask').addEventListener('click',function(e){ if(e.target===this)hideConfirm(); });
})();
