const rotary = require('./index')
var context = {"coreCommand": 0, 'logger': 1, 'configManager': 2}
const rot = new rotary(context);
test('test if dtoverlyL returns an Array', ()=>{
    return rot.dtoverlayL().then(data => {
        expect(Array.isArray(data)).toBe(true);
    })
})
test('Test if dtoOverlayL returns an Array with 1 object', ()=>{
    return rot.dtoverlayL().then(data => {
        expect(data.length).toBe(1);
    })
})