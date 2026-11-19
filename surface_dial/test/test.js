'use strict';
const assert=require('assert'); const ControllerSurfaceDial=require('../index'); const {SurfaceDial}=require('../lib/surface-dial'); const {parseDevices}=require('../lib/bluetooth');

async function main(){
 assert.deepStrictEqual(SurfaceDial.parseReport(Buffer.from([1,2,1,0,10,11,12,13,58])),{pressed:false,rotation:1});
 assert.deepStrictEqual(SurfaceDial.parseReport(Buffer.from([1,3,0xff,0xff,10,11,12,13,58])),{pressed:true,rotation:-1});
 assert.deepStrictEqual(SurfaceDial.parseReport(Buffer.from([1,3,0,0,10,11,12,13,58])),{pressed:true,rotation:0});
 assert.deepStrictEqual(SurfaceDial.parseReport(Buffer.from([1,0,0,0,10,11,12,13,58])),{pressed:false,rotation:0});
 assert.strictEqual(SurfaceDial.parseReport(Buffer.from([1,2,1,0])),null);
 assert.strictEqual(SurfaceDial.parseReport(Buffer.from([1,2,1,0,10,11,12,13,58,0])),null);
 assert.strictEqual(SurfaceDial.parseReport(Buffer.from([2,2,1,0,10,11,12,13,58])),null);
 assert.strictEqual(SurfaceDial.parseReport(Buffer.from([1,4,0,0,10,11,12,13,58])),null);
 assert.strictEqual(SurfaceDial.parseReport(Buffer.from([1,2,2,0,10,11,12,13,58])),null);
 assert.strictEqual(SurfaceDial.parseReport(Buffer.from([1,2,0xff,0,10,11,12,13,58])),null);
 assert.strictEqual(SurfaceDial.parseReport(Buffer.from([0x32,0x02])),null);
 assert.strictEqual(SurfaceDial.parseReport([1,2,0,0,10,11,12,13,58]),null);

 let disconnects=0; const dial=new SurfaceDial({onDisconnect:()=>{disconnects+=1;}});
 dial.lastButtonState=true; dial._disconnect();
 assert.strictEqual(disconnects,1); assert.strictEqual(dial.lastButtonState,false);

 const devices=parseDevices('Device AA:BB:CC:DD:EE:FF Surface Dial\nDevice 11:22:33:44:55:66 Keyboard\n');
 assert.strictEqual(devices.length,2); assert.strictEqual(devices[0].name,'Surface Dial');

 const actions=[]; const controller=Object.create(ControllerSurfaceDial.prototype);
 controller.config={get:key=>({single_press:'toggle',double_press:'next',long_press:'previous',double_press_ms:10,long_press_ms:700})[key]};
 controller.buttonDownAt=null; controller.clickTimer=null; controller.pendingClicks=0; controller.longPressFired=false;
 controller._performAction=action=>actions.push(action);
 controller._onButton(false);
 controller._onButton(true); controller._onButton(true); controller._onButton(false); controller._onButton(false);
 await new Promise(resolve=>setTimeout(resolve,220));
 assert.deepStrictEqual(actions,['toggle']);

 const doubleActions=[]; const doubleController=Object.create(ControllerSurfaceDial.prototype);
 doubleController.config=controller.config; doubleController.buttonDownAt=null; doubleController.clickTimer=null; doubleController.pendingClicks=0; doubleController.longPressFired=false;
 doubleController._performAction=action=>doubleActions.push(action);
 doubleController._onButton(true); doubleController._onButton(false);
 doubleController._onButton(true); doubleController._onButton(false);
 assert.deepStrictEqual(doubleActions,['next']);

 const longActions=[]; const longController=Object.create(ControllerSurfaceDial.prototype);
 longController.config=controller.config; longController.buttonDownAt=Date.now()-800; longController.clickTimer=null; longController.pendingClicks=0; longController.longPressFired=false;
 longController._performAction=action=>longActions.push(action);
 longController._onButton(false); longController._onButton(false);
 assert.deepStrictEqual(longActions,['previous']);

 const disconnectedActions=[]; const disconnectedController=Object.create(ControllerSurfaceDial.prototype);
 disconnectedController.config=controller.config; disconnectedController.buttonDownAt=Date.now(); disconnectedController.clickTimer=null; disconnectedController.pendingClicks=0; disconnectedController.longPressFired=false;
 disconnectedController._performAction=action=>disconnectedActions.push(action);
 disconnectedController._resetButtonState(); disconnectedController._onButton(false);
 await new Promise(resolve=>setTimeout(resolve,220));
 assert.deepStrictEqual(disconnectedActions,[]);
 console.log('All tests passed');
}

main().catch(err=>{console.error(err);process.exitCode=1;});
