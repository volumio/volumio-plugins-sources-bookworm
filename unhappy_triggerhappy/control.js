'use strict';

var readyLoop = require('./ready-loop');
var stockMap = require('./stock-map');

// Immediate restart. No ready poll. Does not write the plugin conf.
function makeHappyNow(env) {
    return env.restartTriggerhappy();
}

// Write differences only, or remove the conf when there are none / More Happy is off.
// No ready poll.
function saveBindings(env, data) {
    var moreHappy = !!(data && data.more_happy === true);

    if (!moreHappy) {
        return Promise.resolve(env.removeTriggers()).then(function () {
            return env.restartTriggerhappy();
        });
    }

    var bindings = stockMap.bindingsFromUi(data);
    var i;

    for (i = 0; i < bindings.length; i++) {
        if (String(bindings[i].command).indexOf('\n') !== -1) {
            return Promise.reject(new Error('binding command must be a single line'));
        }
    }

    return Promise.resolve(env.readForeignTriggers()).then(function (texts) {
        var foreign = stockMap.foreignSignatures(texts || []);
        var unique = stockMap.filterDifferences(bindings, foreign);

        if (unique.length === 0) {
            return Promise.resolve(env.removeTriggers()).then(function () {
                return env.restartTriggerhappy();
            });
        }

        return Promise.resolve(env.writeTriggers(stockMap.renderMap(unique))).then(function () {
            return env.restartTriggerhappy();
        });
    });
}

// On plugin start and on boot, when the forever toggle is on. Does not write the plugin conf.
function makeHappyForever(env) {
    return readyLoop.pollUntilReady(function () {
        env.restartTriggerhappy();
    });
}

module.exports = {
    makeHappyNow: makeHappyNow,
    saveBindings: saveBindings,
    makeHappyForever: makeHappyForever
};
