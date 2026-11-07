'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {createStore}=require('../../store');
const base=path.join(__dirname,'profiles','backup-history-'+Date.now());fs.mkdirSync(base,{recursive:true});
const store=createStore({userDataDir:base,getAppVersion:()=>'2.6.0'}),api=store._internal,steps=[];
function check(label,fn){fn();steps.push(label);console.log('PASS '+label);}
(async()=>{
 api.applyFields('test',{days:{'2026-10-01':{h:true}},habits:[{key:'h',name:'test',type:'bool'}],meta:{},memoNotes:[{id:'n',html:'<img src="hbimg://abc">'}]});await store.drainWrites();
 fs.mkdirSync(path.join(base,'images'),{recursive:true});fs.writeFileSync(path.join(base,'images/abc.png'),'test-image');
 const backup=api.backupNow();assert(backup.ok);let rows=api.listBackupHistory();
 check('history reports counts and verified images',()=>assert(rows.some(r=>r.name===backup.name&&r.ok&&r.verified&&r.days===1&&r.notes===1&&r.images===1)));
 api.applyFields('test',{days:{'2026-10-02':{h:false}},meta:{revision:2}});await store.drainWrites();
 const preview=api.previewBackup(backup.name);check('preview compares current and selected archive',()=>{assert(preview.ok);assert.equal(preview.before.days,1);assert.equal(preview.after.notes,1);});
 api.applyFields('test',{meta:{revision:3}});await store.drainWrites();
 const stale=await api.restoreBackup(backup.name,preview.token);check('changed current data invalidates preview',()=>{assert(stale.stale);assert.equal(api.ensureDoc().meta.revision,3);});
 const next=api.previewBackup(backup.name),original=fs.cpSync;fs.cpSync=()=>{throw new Error('injected snapshot failure');};
 let failed;try{failed=await api.restoreBackup(backup.name,next.token);}finally{fs.cpSync=original;}
 check('failed safety backup prevents replacement',()=>{assert(!failed.ok);assert.equal(api.ensureDoc().meta.revision,3);});
 const ready=api.previewBackup(backup.name),result=await api.restoreBackup(backup.name,ready.token);
 check('restore commits document and preserves a safety backup',()=>{assert(result.ok);assert(api.ensureDoc().days['2026-10-01'].h);assert(api.listBackupHistory().some(r=>r.name===result.safetyBackup));assert.equal(fs.readFileSync(path.join(base,'images/abc.png'),'utf8'),'test-image');});
 fs.writeFileSync(path.join(base,'auto-backup',backup.name,'images/abc.png'),'tampered');
 check('tampered image blocks preview and restore',()=>assert(!api.previewBackup(backup.name).ok));
 check('traversal names are refused',()=>assert(!api.previewBackup('../data.json').ok));
 fs.writeFileSync(path.join(__dirname,'results/verify-backup-history-result.json'),JSON.stringify({ok:true,steps,errs:[],ts:new Date().toISOString()},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
