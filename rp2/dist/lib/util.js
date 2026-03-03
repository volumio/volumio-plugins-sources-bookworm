"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUri = parseUri;
exports.jsPromiseToKew = jsPromiseToKew;
exports.kewToJSPromise = kewToJSPromise;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const kew_1 = __importDefault(require("kew"));
/**
 *
 * @param uri 'rp2/{view}@{param0=...}@{param1=...}'
 * @returns
 */
function parseUri(uri) {
    if (!uri.startsWith('rp2/')) {
        return [];
    }
    const views = uri.split('/').reduce((result, segment, i) => {
        if (i === 0) {
            // rp2
            result.push({ name: 'root', params: {} });
            return result;
        }
        const splitted = segment.split('@');
        const viewName = splitted.shift();
        if (!viewName) {
            return result;
        }
        const params = splitted.reduce((acc, qs) => {
            const [key, value] = qs.split('=');
            if (key && value !== undefined) {
                acc[key] = decodeURIComponent(value);
            }
            return acc;
        }, {});
        result.push({
            name: viewName,
            params
        });
        return result;
    }, []);
    return views;
}
function jsPromiseToKew(promise) {
    const defer = kew_1.default.defer();
    promise
        .then((result) => {
        defer.resolve(result);
    })
        .catch((error) => {
        defer.reject(error);
    });
    return defer.promise;
}
function kewToJSPromise(promise) {
    // Guard against a JS promise from being passed to this function.
    if (typeof promise.catch === 'function' &&
        typeof promise.fail === 'undefined') {
        // JS promise - return as is
        return promise;
    }
    return new Promise((resolve, reject) => {
        promise
            .then((result) => {
            resolve(result);
        })
            .fail((error) => {
            reject(error instanceof Error ? error : Error(String(error)));
        });
    });
}
