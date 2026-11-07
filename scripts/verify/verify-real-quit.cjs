'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../..');
const steps=[],errs=[];
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
for(const mode of [0,50,250,'editor']){
  const delay=typeof mode==='number'?mode:0;
  const profile=path.join(__dirname,'profiles','real-quit-'+Date.now()+'-'+delay);fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'data.json'),JSON.stringify({meta:{version:2,sampleLoaded:false,guideDone:true},days:{},habits:[{key:'quit-test',name:'退出测试',type:'bool',size:'wide',color:'#0071e3',icon:'✓'}],settings:{theme:'light',sound:false,remindPerHabit:false,remindSummary:false},profile:{name:'Test'},memo:{html:'',text:''},memoNotes:mode==='editor'?[{id:'quit-note',title:'测试便签',html:'<p>原内容</p>',text:'原内容',ts:Date.now()}]:[]}));
  const result=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(__dirname,'verify-real-quit-child.cjs'),profile,String(delay),String(mode)],{env,cwd:root,windowsHide:true,encoding:'utf8',timeout:30000});
  let passed=false;
  try{const day=fs.readFileSync(path.join(profile,'test-day.txt'),'utf8'),doc=JSON.parse(fs.readFileSync(path.join(profile,'data.json'),'utf8'));passed=result.status===0&&doc.days[day]['quit-test']===true;if(mode==='editor')passed=passed&&doc.memoNotes.some(n=>n.id==='quit-note'&&n.html.includes('退出前最后一笔便签'));}catch(_){}
  const label=mode==='editor'?'real main process preserves the last debounced note edit':'real main process preserves check-in when quitting after '+delay+'ms';(passed?steps:errs).push(label);console.log((passed?'PASS ':'FAIL ')+label);
  if(!passed)console.log(result.stdout,result.stderr,result.error&&result.error.message);
}
const out=path.join(__dirname,'results');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'verify-real-quit-result.json'),JSON.stringify({name:'verify-real-quit',ok:!errs.length,steps,errs,ts:new Date().toISOString()},null,2));
process.exit(errs.length?1:0);
