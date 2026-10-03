'use strict';
const fs=require('fs');
class ConfigStore{constructor(){this.file=null;this.data={};}loadFile(file){this.file=file;this.data=JSON.parse(fs.readFileSync(file,'utf8'));}get(key){const item=this.data[key];if(item&&typeof item==='object'&&Object.prototype.hasOwnProperty.call(item,'value'))return item.value;return item;}set(key,value){if(this.data[key]&&typeof this.data[key]==='object'&&Object.prototype.hasOwnProperty.call(this.data[key],'value'))this.data[key].value=value;else this.data[key]={type:inferType(value),value};this.save();}save(){if(!this.file)return;const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2)+'\n');fs.renameSync(tmp,this.file);}}
function inferType(value){if(typeof value==='boolean')return 'boolean';if(typeof value==='number')return 'number';return 'string';}
module.exports=ConfigStore;
