"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const handler = __importStar(require("./Handler"));
const NowPlayingContext_1 = __importDefault(require("../lib/NowPlayingContext"));
const router = express_1.default.Router();
function stdLogError(fn, error) {
    NowPlayingContext_1.default.getLogger().error(NowPlayingContext_1.default.getErrorMessage(`[now-playing] Caught error in router -> ${fn}:`, error, false));
}
router.get('/', (req, res) => {
    handler.index(req, res).catch((error) => stdLogError('index', error));
});
router.get('/preview', (req, res) => {
    handler.preview(req, res).catch((error) => stdLogError('preview', error));
});
router.get('/mybg', (req, res) => {
    handler.myBackground(req.query, res);
});
router.post('/api/:apiName/:method', (req, res) => {
    const { apiName, method } = req.params;
    handler.api(apiName, method, req.body, res).catch((error) => stdLogError(`api -> ${apiName}.${method}`, error));
});
router.get('/api/:apiName/:method', (req, res) => {
    const { apiName, method } = req.params;
    handler.api(apiName, method, req.query, res).catch((error) => stdLogError(`api -> ${apiName}.${method}`, error));
});
router.get('/font/:file', (req, res) => {
    const { file } = req.params;
    handler.font(file, res);
});
exports.default = router;
//# sourceMappingURL=Router.js.map