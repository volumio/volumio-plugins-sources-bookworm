"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsPromiseToKew = jsPromiseToKew;
exports.kewToJSPromise = kewToJSPromise;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const kew_1 = __importDefault(require("kew"));
function jsPromiseToKew(promise) {
    const defer = kew_1.default.defer();
    promise.then((result) => {
        defer.resolve(result);
    })
        .catch((error) => {
        defer.reject(error);
    });
    return defer.promise;
}
function kewToJSPromise(promise) {
    // Guard against a JS promise from being passed to this function.
    if (typeof promise.catch === 'function' && promise.fail === undefined) {
        // JS promise - return as is
        return promise;
    }
    return new Promise((resolve, reject) => {
        promise.then((result) => {
            resolve(result);
        })
            .fail((error) => {
            if (error instanceof Error) {
                reject(error);
            }
            else {
                reject(Error(error));
            }
        });
    });
}
//# sourceMappingURL=index.js.map