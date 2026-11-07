'use strict';
const {spawnSync}=require('child_process');
const path=require('path');
for(const scale of ['1.25','1.5','2']){
 const report='verify-scale-'+scale.replace('.','-')+'-result.json';
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-electron.cjs'),'scripts/verify/verify-scale.cjs',report,scale],{stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
