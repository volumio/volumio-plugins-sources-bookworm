"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Cache_cache;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cache = void 0;
const lru_cache_1 = require("lru-cache");
class Cache {
    constructor() {
        _Cache_cache.set(this, void 0);
        __classPrivateFieldSet(this, _Cache_cache, new lru_cache_1.LRUCache({
            max: 500,
            ttl: 1800000 // 30mins
        }), "f");
    }
    get(key) {
        return __classPrivateFieldGet(this, _Cache_cache, "f").get(key);
    }
    set(key, value) {
        __classPrivateFieldGet(this, _Cache_cache, "f").set(key, value);
    }
    cacheOrGet(key, get) {
        let v = __classPrivateFieldGet(this, _Cache_cache, "f").get(key);
        if (v !== undefined) {
            return v;
        }
        v = get();
        __classPrivateFieldGet(this, _Cache_cache, "f").set(key, v);
        return v;
    }
    clear() {
        __classPrivateFieldGet(this, _Cache_cache, "f").clear();
    }
}
exports.Cache = Cache;
_Cache_cache = new WeakMap();
