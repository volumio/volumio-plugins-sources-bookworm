const { resolve } = require('path');
const rotary = require('./index')
const rotary1 = {'pinA': 5, 'pinB': 6, 'stepsPerPeriod': 2};
const button1 = {'pinA': 26, "activeLow": 1, "gpioPull": 'up'}
var winston = require('winston');
const exp = require('constants');
var spawn = require('child_process').spawn
var handles = []


jest.mock('child_process');

const config = new (require('v-conf'))();
config.loadFile('/data/configuration/system_hardware/rotaryencoder2/config.json');


var context = {"coreCommand": 0, 'configManager': 2};
context.logger = winston.createLogger({
    format: winston.format.simple(),
    transports: [
      new (winston.transports.Console)({level: 'verbose'})
    ]
  });

context.coreCommand = {
    pluginManager: {
        getConfigurationFile(x,y){
            return '/data/configuration/system_hardware/rotaryencoder2/config.json';
        }
    }
}
context.config = config;
const rot = new rotary(context);    

test('test if onVolumioStart returns ok',async () => {
        await expect(rot.onVolumioStart()).resolves
})

// test('test if onStart returns ok',async () => {
//         await expect(rot.onStart()).resolves
// })

// test('test if onStop returns ok',async () => {
//         await expect(rot.onStop()).resolves
// })

test('test if dtoverlyAdd can Add rotary on pin 5 and 6', ()=>{
    return rot.dtoverlayAdd(rotary1)
    .then(data => {
        expect(Array.isArray(data)).resolves;
    })
})
test('test if a listener can be added to rotary on pin 5/6', ()=>{
    return rot.attachListenerRotary(rotary1)
    .then(handle => {
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(handle).resolves;
        handles.push(handle);
    })
   
})

test('test if dtoverlyAdd can Add button1', ()=>{
    return rot.dtoverlayAdd(button1)
    .then(data => {
        expect(Array.isArray(data)).resolves;
    })
})

// test('test if a listener can be added to rotary on pin 5/6', async ()=>{
//     await expect(rot.attachListenerRotary(rotary1)).resolves
   
// })

test('test if dtoverlyL returns an Array', ()=>{
    return rot.dtoverlayL().then(data => {
        expect(Array.isArray(data)).toBe(true);
    })
})
test('Test if dtoOverlayL returns an Array with length 2', ()=>{
    return rot.dtoverlayL().then(data => {
        expect(data.length).toBe(2);
    })
})
// test('test if overlay can be deleted', ()=>{
//     return rot.dtoverlayRemove(rotary1).then(data => {
//         expect().resolves;
//     })
// })
// test('test if overlay can be deleted', ()=>{
//     return rot.dtoverlayRemove(button1).then(data => {
//         expect().resolves;
//     })
// })
