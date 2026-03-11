"use strict";
/**
 * Bridge Server 真实硬件测试脚本
 *
 * 使用真实 serialport 库连接物理设备，配合 BridgeServer 暴露 REST API，
 * 使 Windsurf 中的 MCP Tool 能操作真实串口硬件。
 *
 * 使用方式：
 *   首次 / 代码变更后：npm run bridge:build
 *   启动：npm run bridge
 * 按 Ctrl+C 停止
 *
 * 对应 Plan.md S2.07
 */
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const module_1 = require("module");
const path = __importStar(require("path"));
const bridge_server_1 = require("../packages/serialagent-vscode/src/bridge-server");
const types_1 = require("../packages/serialagent-vscode/src/types");
// serialport 安装在 packages/serialagent-vscode 中，需从该路径解析
// 使用 process.cwd() 而非 __dirname，确保预编译后路径仍正确
const vscodeRequire = (0, module_1.createRequire)(path.resolve(process.cwd(), 'packages/serialagent-vscode/package.json'));
const { SerialPort } = vscodeRequire('serialport');
// ============================================================
// 真实 SerialManager（轻量版，仅用于 E2E 测试）
// ============================================================
class RealSerialManager {
    constructor() {
        this._port = null;
        this._config = { ...types_1.DEFAULT_CONFIG };
        this._logBuffer = [];
        this._rxBuffer = Buffer.alloc(0);
        this._rxBytes = 0;
        this._txBytes = 0;
        this._reconnecting = false;
        this._newLogSubscribers = [];
    }
    get isConnected() { return this._port !== null && this._port.isOpen; }
    get isReconnecting() { return this._reconnecting; }
    get currentPath() { return this._config.port; }
    get currentBaudRate() { return this._config.baudRate; }
    get config() { return { ...this._config }; }
    get rxBytes() { return this._rxBytes; }
    get txBytes() { return this._txBytes; }
    async listPorts() {
        const ports = await SerialPort.list();
        return ports.map(p => ({
            path: p.path,
            manufacturer: p.manufacturer,
            productId: p.productId,
            vendorId: p.vendorId,
            serialNumber: p.serialNumber,
        }));
    }
    async connect(config) {
        if (this._port?.isOpen) {
            await this.disconnect();
        }
        this._config = { ...config };
        return new Promise((resolve) => {
            try {
                this._port = new SerialPort({
                    path: config.port,
                    baudRate: config.baudRate,
                    dataBits: config.dataBits,
                    stopBits: config.stopBits,
                    parity: config.parity,
                    autoOpen: false,
                });
                this._port.on('data', (chunk) => {
                    this._rxBytes += chunk.length;
                    this._processData(chunk);
                });
                this._port.on('error', (err) => {
                    console.error(`[Serial Error] ${err.message}`);
                });
                this._port.open((err) => {
                    if (err) {
                        console.error(`[Serial] Open failed: ${err.message}`);
                        this._port = null;
                        resolve(false);
                    }
                    else {
                        console.log(`[Serial] Connected to ${config.port} @ ${config.baudRate}`);
                        resolve(true);
                    }
                });
            }
            catch (err) {
                console.error(`[Serial] Connect error: ${err}`);
                resolve(false);
            }
        });
    }
    async disconnect() {
        return new Promise((resolve) => {
            if (this._port?.isOpen) {
                this._port.close(() => {
                    this._port = null;
                    console.log('[Serial] Disconnected');
                    resolve();
                });
            }
            else {
                this._port = null;
                resolve();
            }
        });
    }
    async send(data, hexMode, lineEnding) {
        if (!this._port?.isOpen) {
            return false;
        }
        let buf;
        if (hexMode) {
            const hexStr = data.replace(/\s+/g, '');
            if (!hexStr.length || !/^[0-9a-fA-F]*$/.test(hexStr) || hexStr.length % 2 !== 0) {
                return false;
            }
            buf = Buffer.from(hexStr, 'hex');
        }
        else {
            const suffixes = { lf: '\n', crlf: '\r\n', cr: '\r', none: '' };
            buf = Buffer.from(data + (suffixes[lineEnding] ?? '\n'), 'utf8');
        }
        return new Promise((resolve) => {
            this._port.write(buf, (err) => {
                if (err) {
                    resolve(false);
                    return;
                }
                this._txBytes += buf.length;
                resolve(true);
            });
        });
    }
    getLogBuffer() { return [...this._logBuffer]; }
    clearLog() {
        this._logBuffer = [];
        this._rxBuffer = Buffer.alloc(0);
    }
    resetCounters() {
        this._rxBytes = 0;
        this._txBytes = 0;
    }
    injectLog(line) {
        this._logBuffer.push(line);
        if (this._logBuffer.length > 5000) {
            this._logBuffer.shift();
        }
        console.log(`[INJ] ${line}`);
        for (const cb of this._newLogSubscribers) {
            cb(line);
        }
    }
    onNewLog(callback) {
        this._newLogSubscribers.push(callback);
    }
    offNewLog(callback) {
        const idx = this._newLogSubscribers.indexOf(callback);
        if (idx !== -1) {
            this._newLogSubscribers.splice(idx, 1);
        }
    }
    /** 按行分割串口数据，推入 logBuffer 并通知订阅者 */
    _processData(chunk) {
        this._rxBuffer = Buffer.concat([this._rxBuffer, chunk]);
        let idx;
        while ((idx = this._rxBuffer.indexOf(0x0A)) !== -1) {
            const lineBytes = this._rxBuffer.subarray(0, idx);
            this._rxBuffer = this._rxBuffer.subarray(idx + 1);
            let text = lineBytes.toString('utf8');
            if (text.endsWith('\r')) {
                text = text.slice(0, -1);
            }
            this._logBuffer.push(text);
            if (this._logBuffer.length > 5000) {
                this._logBuffer.shift();
            }
            // 控制台实时显示
            console.log(`[RX] ${text}`);
            // 通知订阅者（wait_for_output 用）
            for (const cb of this._newLogSubscribers) {
                cb(text);
            }
        }
    }
}
// ============================================================
// 启动
// ============================================================
class ConsoleLogger {
    appendLine(value) { console.log(value); }
}
async function main() {
    const sm = new RealSerialManager();
    const logger = new ConsoleLogger();
    const bridge = new bridge_server_1.BridgeServer(sm, logger);
    await bridge.start();
    console.log('');
    console.log('=== Serial Agent Bridge Server (Real Hardware) ===');
    console.log(`Port:  127.0.0.1:${bridge.port}`);
    console.log(`Token: ${bridge.token}`);
    console.log('');
    console.log('Now use Windsurf MCP Tools to:');
    console.log('  1. list_serial_ports  — find your STM32 COM port');
    console.log('  2. connect_serial     — connect to it');
    console.log('  3. read_serial_log    — read boot messages');
    console.log('  4. send_serial_data   — send "ver" command');
    console.log('  5. wait_for_output    — wait for pattern match');
    console.log('');
    console.log('Press Ctrl+C to stop.');
    console.log('');
    const cleanup = async () => {
        console.log('\nShutting down...');
        await sm.disconnect();
        await bridge.stop();
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}
main().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
});
