'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const build=pkg.releaseDate+'-v'+pkg.version;
const check=process.argv.includes('--check');
const changes=[
  ['main.js',/const APP_BUILD = '[^']+';/,"const APP_BUILD = '"+build+"';"],
  ['js/data.js',/const APP_BUILD='[^']+';/,"const APP_BUILD='"+build+"';"],
  ['安装包制作/installer.nsi',/!define APP_VERSION\s+"[^"]+"/,'!define APP_VERSION   "'+pkg.version+'"']
];
let failed=false;
for(const [file,pattern,replacement] of changes){
  const target=path.join(root,file),text=fs.readFileSync(target,'utf8');
  if(!pattern.test(text))throw new Error('Missing release marker: '+file);
  const next=text.replace(pattern,replacement);
  if(next!==text){if(check){console.error('Release mismatch: '+file);failed=true;}else fs.writeFileSync(target,next);}
}
if(!pkg.build.portable.artifactName.includes(pkg.version)){console.error('Portable artifact version mismatch');failed=true;}
console.log((failed?'FAIL':'PASS')+' release '+pkg.version+' / '+build);process.exitCode=failed?1:0;
