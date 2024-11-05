const { Promise, resolve } = require('kew');
const { SerialPort } = require('serialport')
const { ReadlineParser } = require('@serialport/parser-readline');

SerialPort.list()
.then(list => {
    list[0].baudRate = 115200;
    console.log('List: ' + JSON.stringify(list));
    return resolve(list[0]);
})
.then(params => {
    const port = new SerialPort(params)
    port.write('main screen turn on', function(err) {
    if (err) {
        return console.log('Error on write: ', err.message)
    }
    console.log('message written')
    // Open errors will be emitted as an error event
    port.on('error', function(err) {
    console.log('Error: ', err.message)
    })
    })
})

