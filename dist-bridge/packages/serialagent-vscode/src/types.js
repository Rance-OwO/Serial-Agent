"use strict";
/**
 * Serial Agent 共享类型定义
 *
 * 被 extension.ts、bridge-server.ts、测试桩共用。
 * 抽取为独立模块以支持 BridgeServer 单元测试（无需依赖 vscode）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.DEFAULT_CONFIG = {
    port: '',
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    lineEnding: 'none',
    showTimestamp: false,
    hexMode: false,
};
