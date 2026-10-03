'use strict';
const {execFile,spawn}=require('child_process');
function execBluetooth(args,timeoutMs){return new Promise((resolve,reject)=>{execFile('/usr/bin/bluetoothctl',args,{timeout:timeoutMs||12000},(err,stdout,stderr)=>{if(err)return reject(new Error((stderr||err.message||'').trim()));resolve(stdout||'');});});}
function scanWindow(seconds){return new Promise((resolve,reject)=>{const child=spawn('/usr/bin/bluetoothctl',['--agent','NoInputNoOutput'],{stdio:['pipe','pipe','pipe']});let out='',err='',finished=false;const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);try{child.stdin.end('scan off\nquit\n');}catch(e){}setTimeout(()=>child.kill('SIGTERM'),500).unref();if(error)reject(error);else resolve(out);};const timer=setTimeout(()=>finish(),Math.max(3,seconds||8)*1000);child.stdout.on('data',d=>{out+=d.toString();});child.stderr.on('data',d=>{err+=d.toString();});child.on('error',e=>finish(e));child.on('close',code=>{if(!finished&&code&&code!==0)finish(new Error(err||out||'bluetoothctl failed'));});child.stdin.write('power on\n');child.stdin.write('agent NoInputNoOutput\n');child.stdin.write('default-agent\n');child.stdin.write('scan on\n');});}
function parseDevices(text){const devices=[];String(text).split(/\r?\n/).forEach(line=>{const m=line.match(/Device\s+([0-9A-F:]{17})\s+(.+)/i);if(m)devices.push({mac:m[1].toUpperCase(),name:m[2].trim()});});return devices;}
async function scanForSurfaceDial(){const scanOutput=await scanWindow(8).catch(()=>''),devicesOutput=await execBluetooth(['devices'],5000).catch(()=>'');return parseDevices(scanOutput+'\n'+devicesOutput).filter(d=>/surface\s*dial/i.test(d.name));}
function validateMac(mac){if(!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i.test(mac||''))throw new Error('Invalid Bluetooth address');}
async function trust(mac){validateMac(mac);return execBluetooth(['trust',mac],8000);}
async function connect(mac){validateMac(mac);return execBluetooth(['--timeout','8','connect',mac],10000);}
async function pair(mac){validateMac(mac);await execBluetooth(['--agent','NoInputNoOutput','--timeout','25','pair',mac],30000);await trust(mac).catch(()=>{});return connect(mac).catch(()=>{});}
async function forget(mac){validateMac(mac);return execBluetooth(['remove',mac],10000);}
module.exports={scanForSurfaceDial,pair,forget,trust,connect,parseDevices};
