'use strict';
/* Renderer build metadata lives in js/data.js after the script split. */
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const crypto=require('crypto');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'../..'),pkg=require('../../package.json');
const defaultArchive=path.join(root,'artifacts','portable-staging-'+pkg.version,'win-unpacked/resources/app.asar');
const archives=process.argv.slice(2).length?process.argv.slice(2).map(p=>path.resolve(p)):[defaultArchive];
const steps=[],errs=[];
function ok(value,label){(value?steps:errs).push(label);console.log((value?'PASS ':'FAIL ')+label);}
function walk(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(dir+'/'+item.name):[dir+'/'+item.name]);}
const files=['habit-rules.js','backup-history.js','main.js','preload.js','store.js','reminders.js','startup-decide.js','habit.html','ui.js','logo.ico','logo-32.png',...walk('js'),...walk('styles')];
const build=(fs.readFileSync(path.join(root,'main.js'),'utf8').match(/const APP_BUILD = '([^']+)'/)||[])[1];
for(const archive of archives){
 try{
  const main=asar.extractFile(archive,'main.js').toString(),renderer=asar.extractFile(archive,'js/data.js').toString();
  ok((main.match(/const APP_BUILD = '([^']+)'/)||[])[1]===build,'main build matches source');
  ok((renderer.match(/const APP_BUILD='([^']+)'/)||[])[1]===build,'renderer module build matches source');
  ok(JSON.parse(asar.extractFile(archive,'package.json').toString()).version===pkg.version,'package version matches source');
  for(const file of files){
    const bytes=asar.extractFile(archive,file),source=fs.readFileSync(path.join(root,file));
    ok(bytes.equals(source),'exact source bytes: '+file);
    if(file.endsWith('.js'))new vm.Script(bytes.toString(),{filename:file});
  }
  const helper=path.join(path.dirname(archive),'desktop-layer.exe');
  ok(fs.readFileSync(helper).equals(fs.readFileSync(path.join(root,'desktop-layer.exe'))),'desktop helper bytes match source');
  console.log('ASAR SHA256 '+crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
 }catch(error){errs.push(error.stack);console.error(error.message);}
}
const out=path.join(__dirname,'results');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'verify-packed-asar-result.json'),JSON.stringify({name:'verify-packed-asar',ok:!errs.length,errs,steps,metrics:{build},ts:new Date().toISOString()},null,2));
process.exit(errs.length?1:0);
