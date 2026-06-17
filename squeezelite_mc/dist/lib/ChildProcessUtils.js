"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logChildProcessMessage = logChildProcessMessage;
const SqueezeliteMCContext_1 = __importDefault(require("./SqueezeliteMCContext"));
function logChildProcessMessage(level, message) {
    switch (level) {
        case 'debug':
            SqueezeliteMCContext_1.default.getLogger().verbose(message);
            break;
        case 'error':
            SqueezeliteMCContext_1.default.getLogger().error(message);
            break;
        case 'info':
            SqueezeliteMCContext_1.default.getLogger().info(message);
            break;
        case 'warn':
            SqueezeliteMCContext_1.default.getLogger().warn(message);
            break;
    }
}
