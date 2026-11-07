'use strict';
const fs = require('fs');
const path = require('path');
const { createStore } = require('../../store.js');
const base = path.join(__dirname, 'profiles', 'store-transactions-' + Date.now());
fs.mkdirSync(base, { recursive: true });
const errs = [], steps = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function ok(value, label) { (value ? steps : errs).push(label); console.log((value ? 'PASS ' : 'FAIL ') + label); }
async function fresh(name) {
  const root = path.join(base, name); fs.mkdirSync(root, { recursive: true });
  const store = createStore({userDataDir:root,getAppVersion:()=>'2.5.0',log:()=>{}});
  const api = store._internal;
  api.applyFields('test',{days:{},habits:[],meta:{revision:'initial'}});
  await store.drainWrites();
  return {root,store,api,file:path.join(root,'data.json')};
}
(async function(){
  const c=await fresh('inflight'), originalWrite=fs.promises.writeFile;
  let release,started;
  const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  fs.promises.writeFile=async function(file,content,...args){if(file===c.file+'.tmp'){started();await gate;}return originalWrite.call(this,file,content,...args);};
  try {
    c.api.applyFields('first',{meta:{revision:'first'}});
    const first=c.store.drainWrites(); await ready;
    c.api.applyFields('second',{meta:{revision:'second'}});
    const final=c.store.drainWrites();release();await Promise.all([first,final]);
    ok(JSON.parse(fs.readFileSync(c.file)).meta.revision==='second','drain waits for changes arriving during an in-flight write');
  } finally {fs.promises.writeFile=originalWrite;}

  const f=await fresh('failure');
  fs.promises.writeFile=async function(file,...args){if(file===f.file+'.tmp')throw new Error('ENOSPC injected');return originalWrite.call(this,file,...args);};
  let rejected=false;
  try{f.api.applyFields('failure',{meta:{revision:'unsaved'}});await f.store.drainWrites();}catch(_){rejected=true;}finally{fs.promises.writeFile=originalWrite;}
  ok(rejected&&JSON.parse(fs.readFileSync(f.file)).meta.revision==='initial','persistent write failure rejects without claiming disk success');
  await f.store.drainWrites();ok(JSON.parse(fs.readFileSync(f.file)).meta.revision==='unsaved','retry preserves and commits the unsaved document');

  const b=await fresh('backup'), originalCp=fs.cpSync;
  fs.mkdirSync(path.join(b.root,'images'),{recursive:true});fs.writeFileSync(path.join(b.root,'images','picture.png'),'picture');
  const before=b.api.backupList().length;
  fs.cpSync=()=>{throw new Error('EACCES injected');};
  let backup;try{backup=b.api.backupNow();}finally{fs.cpSync=originalCp;}
  ok(!backup.ok&&b.api.backupList().length===before,'incomplete image backup fails and is not counted or rotated');

  const m=await fresh('migration'),dest=path.join(base,'new-root'),originalCopy=fs.promises.copyFile;
  let releaseCopy,startCopy;
  const copyGate=new Promise(r=>releaseCopy=r),copyReady=new Promise(r=>startCopy=r);
  fs.promises.copyFile=async function(src,dst,...args){const result=await originalCopy.call(this,src,dst,...args);if(dst===path.join(dest,'data.json')){startCopy();await copyGate;}return result;};
  let moved;
  try{const move=m.api.setDataRoot({dataDir:dest,portable:false});await copyReady;m.api.applyFields('during',{meta:{revision:'during-move'}});releaseCopy();moved=await move;}finally{fs.promises.copyFile=originalCopy;}
  ok(moved.ok&&JSON.parse(fs.readFileSync(path.join(dest,'data.json'))).meta.revision==='during-move','writes during migration are replayed and persisted in the new root');
  const collision=path.join(base,'existing-root');fs.mkdirSync(collision);fs.writeFileSync(path.join(collision,'data.json'),JSON.stringify({days:{},meta:{revision:'other-user'}}));
  const conflict=await m.api.setDataRoot({dataDir:collision,portable:false});
  ok(!conflict.ok&&conflict.conflict&&JSON.parse(fs.readFileSync(path.join(collision,'data.json'))).meta.revision==='other-user','migration refuses to overwrite an existing different document');
  const replaced=await m.api.setDataRoot({dataDir:collision,portable:false,replaceExisting:true});
  ok(replaced.ok&&replaced.targetBackup&&JSON.parse(fs.readFileSync(path.join(replaced.targetBackup,'data.json'))).meta.revision==='other-user'&&JSON.parse(fs.readFileSync(path.join(collision,'data.json'))).meta.revision==='during-move','explicit replacement preserves the target document before migration');

  const portable=path.join(base,'portable-profile'),stable=path.join(base,'portable-exe');fs.mkdirSync(portable);fs.writeFileSync(path.join(portable,'app-config.json'),JSON.stringify({portable:true}));
  const previous=process.env.PORTABLE_EXECUTABLE_DIR;
  process.env.PORTABLE_EXECUTABLE_DIR=stable;
  try{const s=createStore({userDataDir:portable});ok(s._internal.resolveRoot()===path.join(stable,'data'),'portable root follows the real executable directory');}
  finally{if(previous===undefined)delete process.env.PORTABLE_EXECUTABLE_DIR;else process.env.PORTABLE_EXECUTABLE_DIR=previous;}
  const inherited=path.join(base,'portable-inherit'),exe=path.join(base,'portable-stable');fs.mkdirSync(inherited);
  fs.writeFileSync(path.join(inherited,'app-config.json'),JSON.stringify({portable:true}));
  const originalDoc=JSON.stringify({meta:{version:2},days:{'2026-10-14':{water:3}}});fs.writeFileSync(path.join(inherited,'data.json'),originalDoc);
  const inheritedStore=createStore({userDataDir:inherited,portableExeDir:exe});
  ok(fs.readFileSync(path.join(exe,'data/data.json'),'utf8')===originalDoc&&fs.readFileSync(path.join(inherited,'data.json'),'utf8')===originalDoc,'empty stable portable root inherits the original document without changing the source');
  inheritedStore._internal.resolveRoot();
  fs.writeFileSync(path.join(exe,'data/data.json'),JSON.stringify({days:{},meta:{existing:true}}));
  inheritedStore._internal.resolveRoot();
  ok(JSON.parse(fs.readFileSync(path.join(exe,'data/data.json'))).meta.existing===true,'existing portable document is never overwritten by automatic adoption');
  await sleep(100);
  const out=path.join(__dirname,'results');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'verify-store-transactions-result.json'),JSON.stringify({name:'verify-store-transactions',ok:!errs.length,errs,steps,ts:new Date().toISOString()},null,2));
  process.exit(errs.length?1:0);
})().catch(error=>{console.error(error.stack);process.exit(1);});
