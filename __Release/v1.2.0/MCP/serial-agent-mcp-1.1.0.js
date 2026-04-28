#!/usr/bin/env node
"use strict";
/**
 * Serial Agent MCP Server
 *
 * 为 AI（Windsurf / Cursor / Claude 等 MCP Client）提供串口调试能力。
 * 通过 MCP 协议暴露 Tool，内部转换为 HTTP 请求发给 Bridge Server（VS Code 扩展内嵌）。
 *
 * Tool 列表：
 *   - get_serial_status   获取连接状态
 *   - list_serial_ports    列出可用串口
 *   - connect_serial       连接串口
 *   - disconnect_serial    断开串口
 *   - read_serial_log      读取串口日志
 *   - send_serial_data     向串口发送数据
 *   - clear_serial_log     清空日志缓冲区
 *   - wait_for_output      等待特定输出
 *   - send_and_wait        原子性发送+等待响应
 *   - check_keil_config    检测 Keil/Flasher 配置是否完整
 *   - build_keil_project   触发 Keil 编译
 *   - flash_keil_firmware  触发当前配置的烧录器执行烧录
 *   - build_and_flash_keil 一键编译并烧录
 *
 * 传输方式：stdio（标准输入输出）
 *
 * 对应 spec.md §3.2 + §4.2
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
exports.registerTools = registerTools;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function formatBridgeError(method, apiPath, status, parsed) {
    if (typeof parsed === 'string') {
        return `Bridge API ${method} ${apiPath} failed with status ${status}: ${parsed}`;
    }
    if (parsed && typeof parsed === 'object') {
        const payload = parsed;
        const rawError = payload.error;
        if (typeof rawError === 'string') {
            return `Bridge API ${method} ${apiPath} failed with status ${status}: ${rawError}`;
        }
        if (rawError && typeof rawError === 'object') {
            const code = rawError.code || `HTTP_${status}`;
            const message = rawError.message || 'Unknown Bridge error';
            const detailsText = rawError.details === undefined ? '' : ` details=${JSON.stringify(rawError.details)}`;
            return `Bridge API ${method} ${apiPath} failed [${code}]: ${message}${detailsText}`;
        }
    }
    return `Bridge API ${method} ${apiPath} failed with status ${status}: ${JSON.stringify(parsed)}`;
}
/**
 * 读取发现文件获取 Bridge Server 连接信息
 * 每次调用都重新读取，以应对扩展重启产生的新端口/token
 */
function readBridgeConfig() {
    const bridgePath = path.join(os.homedir(), '.serialagent', 'bridge.json');
    if (!fs.existsSync(bridgePath)) {
        throw new Error('Bridge server not running. Please open VS Code with Serial Agent extension activated.\n' +
            `Expected discovery file at: ${bridgePath}`);
    }
    return JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
}
/**
 * 向 Bridge Server 发送 HTTP 请求（S1.11）
 *
 * 所有 MCP Tool 共用此函数：
 * - 自动读取发现文件获取端口和 token
 * - 自动携带 Authorization header
 * - 统一错误处理
 */
async function bridgeRequest(method, apiPath, body, timeoutMs = 5000) {
    const config = readBridgeConfig();
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: config.port,
            path: apiPath,
            method,
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json',
            },
            timeout: timeoutMs,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let parsed = data;
                try {
                    parsed = JSON.parse(data);
                }
                catch {
                    parsed = data;
                }
                const status = res.statusCode ?? 0;
                if (status >= 400) {
                    reject(new Error(formatBridgeError(method, apiPath, status, parsed)));
                    return;
                }
                resolve(parsed);
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Bridge request timed out after ${timeoutMs}ms: ${method} ${apiPath}`));
        });
        req.on('error', (err) => {
            reject(new Error(`Bridge server unreachable (${err.message}). ` +
                'Please ensure VS Code is running with Serial Agent extension activated.'));
        });
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}
/**
 * 封装 bridgeRequest 为 MCP Tool 响应格式
 * 成功时返回 JSON 文本；失败时返回 isError: true
 */
async function toolBridgeRequest(method, apiPath, body, timeoutMs) {
    try {
        const result = await bridgeRequest(method, apiPath, body, timeoutMs);
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: 'text', text: msg }],
            isError: true,
        };
    }
}
// ============================================================
// MCP Server
// ============================================================
const server = new mcp_js_1.McpServer({
    name: 'serial-agent-mcp',
    version: '1.0.1',
});
function registerTools(targetServer, requester = toolBridgeRequest) {
    // ============================================================
    // Tool 定义 (S1.12 ~ S1.18)
    // ============================================================
    /**
     * S1.17: get_serial_status — 获取当前串口连接状态
     * AI 使用场景：在操作前先确认串口是否已连接
     */
    targetServer.tool('get_serial_status', 'Read-only. Returns current serial connection status, reconnect state, byte counters, and buffered log metrics. Does not modify device or toolchain state.', {}, async () => requester('GET', '/api/status'));
    /**
     * S1.12: list_serial_ports — 列出可用串口设备
     * AI 使用场景：在连接串口前，先查看有哪些可用的串口
     */
    targetServer.tool('list_serial_ports', 'Read-only. Lists available serial port devices on the host system, including path and vendor information. Does not open ports or modify device state.', {}, async () => requester('GET', '/api/ports'));
    /**
     * S1.13: connect_serial — 连接到指定串口
     * AI 使用场景：用户确认串口后，AI 调用此 Tool 建立连接
     */
    targetServer.tool('connect_serial', 'Device interaction. Opens a serial connection to the specified port with optional serial settings. May change host/device communication state.', {
        port: zod_1.z.string().describe('Serial port path, e.g. COM3 or /dev/ttyUSB0'),
        baudRate: zod_1.z.number().optional().default(115200).describe('Baud rate, default 115200'),
        dataBits: zod_1.z.union([zod_1.z.literal(5), zod_1.z.literal(6), zod_1.z.literal(7), zod_1.z.literal(8)]).optional().default(8).describe('Data bits, default 8'),
        stopBits: zod_1.z.union([zod_1.z.literal(1), zod_1.z.literal(1.5), zod_1.z.literal(2)]).optional().default(1).describe('Stop bits, default 1'),
        parity: zod_1.z.enum(['none', 'even', 'odd', 'mark', 'space']).optional().default('none').describe('Parity, default none'),
    }, async ({ port, baudRate, dataBits, stopBits, parity }) => {
        return requester('POST', '/api/connect', { port, baudRate, dataBits, stopBits, parity });
    });
    /**
     * S1.14: disconnect_serial — 断开当前串口连接
     */
    targetServer.tool('disconnect_serial', 'Device interaction. Closes the currently connected serial port. Safe to call even if not connected, but it changes host/device communication state.', {}, async () => requester('POST', '/api/disconnect'));
    /**
     * S1.15: read_serial_log — 读取串口日志
     * AI 使用场景：设备上电/运行后，AI 调用此 Tool 获取最新日志进行分析
     */
    targetServer.tool('read_serial_log', 'Read-only. Returns recent serial log lines from the bridge buffer, including total buffered count. Does not modify device state.', {
        lines: zod_1.z.number().optional().default(50).describe('Number of recent lines to return, default 50'),
    }, async ({ lines }) => {
        return requester('GET', `/api/log?lines=${lines}`);
    });
    /**
     * S1.16: send_serial_data — 向串口发送数据
     * AI 使用场景：发送调试命令、AT 指令、重启指令等
     */
    targetServer.tool('send_serial_data', 'Side-effectful device interaction. Sends text or HEX bytes to the connected serial device and may trigger device behavior changes.', {
        data: zod_1.z.string().describe('Data to send'),
        hexMode: zod_1.z.boolean().optional().default(false).describe('Send as HEX bytes (e.g. "41 42 0D 0A"), default false'),
        lineEnding: zod_1.z.enum(['lf', 'crlf', 'cr', 'none']).optional().describe('Line ending to append. Uses current config if omitted'),
    }, async ({ data, hexMode, lineEnding }) => {
        const body = { data, hexMode };
        if (lineEnding !== undefined) {
            body.lineEnding = lineEnding;
        }
        return requester('POST', '/api/send', body);
    });
    /**
     * S1.18: clear_serial_log — 清空日志缓冲区
     * AI 使用场景：在等待新输出前先清空旧日志，确保 read_serial_log 只返回新内容
     */
    targetServer.tool('clear_serial_log', 'Local bridge state reset. Clears buffered serial logs and RX/TX counters. Does not flash firmware, but it removes locally buffered evidence.', {}, async () => requester('POST', '/api/clear'));
    /**
     * S2.03: wait_for_output — 等待串口输出匹配指定 pattern
     * AI 使用场景：提示用户烧录后，调用此 Tool 阻塞等待设备输出 "Ready" 等关键词
     * 默认先扫描现有缓冲区（配合 clear_serial_log 消除烧录后时序竞态），再订阅新日志
     */
    targetServer.tool('wait_for_output', 'Read-mostly wait operation. Waits for serial output matching a pattern using buffered logs and future output. Does not send data or modify device state.', {
        pattern: zod_1.z.string().describe('Regex or text pattern to match in serial output'),
        timeout: zod_1.z.number().optional().default(30).describe('Timeout in seconds (1-120), default 30'),
        scanBuffer: zod_1.z.boolean().optional().default(true).describe('Scan existing log buffer before subscribing for new logs (default true). Use with clear_serial_log to catch output that arrived between clear and wait. Set false to only wait for future output.'),
    }, async ({ pattern, timeout, scanBuffer }) => {
        const httpTimeoutMs = (timeout + 5) * 1000;
        const queryParams = `?pattern=${encodeURIComponent(pattern)}&timeout=${timeout}&scanBuffer=${scanBuffer}`;
        return requester('GET', `/api/log/wait${queryParams}`, undefined, httpTimeoutMs);
    });
    /**
     * send_and_wait — 原子性发送数据并等待匹配输出
     * AI 使用场景：发送命令后需要等待设备响应（如 AT → OK）
     * 优势：先订阅日志再发送数据，彻底消除 send + wait 的竞态条件
     */
    targetServer.tool('send_and_wait', 'Side-effectful device interaction. Sends data to the connected serial device, then waits for matching output. Preferred over separate send + wait when device state may change.', {
        data: zod_1.z.string().describe('Data to send'),
        pattern: zod_1.z.string().describe('Regex or text pattern to match in response'),
        timeout: zod_1.z.number().optional().default(10).describe('Timeout in seconds (1-120), default 10'),
        hexMode: zod_1.z.boolean().optional().default(false).describe('Send as HEX bytes (e.g. "41 42 0D 0A"), default false'),
        lineEnding: zod_1.z.enum(['lf', 'crlf', 'cr', 'none']).optional().describe('Line ending to append. Uses current config if omitted'),
    }, async ({ data, pattern, timeout, hexMode, lineEnding }) => {
        const httpTimeoutMs = (timeout + 5) * 1000;
        const body = { data, pattern, timeout, hexMode };
        if (lineEnding !== undefined) {
            body.lineEnding = lineEnding;
        }
        return requester('POST', '/api/send-and-wait', body, httpTimeoutMs);
    });
    targetServer.tool('check_keil_config', 'Read-only toolchain validation. Checks whether Keil and the configured firmware flasher are ready for build and flash. Does not build, flash, or modify firmware.', {}, async () => requester('GET', '/api/keil/config-check'));
    targetServer.tool('build_keil_project', 'External toolchain action. Invokes a Keil build and may update local build artifacts on disk. Does not flash the target device.', {}, async () => requester('POST', '/api/keil/build'));
    targetServer.tool('flash_keil_firmware', 'External side-effectful toolchain action. Invokes the configured firmware flasher and may overwrite firmware on the connected target device.', {
        artifactPath: zod_1.z.string().optional().describe('Optional absolute artifact path (.hex/.axf/.bin)'),
    }, async ({ artifactPath }) => {
        const body = {};
        if (artifactPath) {
            body.artifactPath = artifactPath;
        }
        return requester('POST', '/api/keil/flash', body);
    });
    targetServer.tool('build_and_flash_keil', 'External side-effectful toolchain action. Runs Keil build and the configured firmware flasher in one call, updating local artifacts and target device firmware state.', {}, async () => requester('POST', '/api/keil/build-and-flash'));
}
// ============================================================
// 启动 MCP Server
// ============================================================
async function main() {
    registerTools(server);
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    // MCP Server 通过 stdio 与 AI Client 通信，启动后等待请求
    // 注意：不要在 stdout 输出任何非 MCP 协议内容，否则会破坏通信
    console.error('[Serial Agent MCP] Started, waiting for MCP Client connection...');
}
if (require.main === module) {
    main().catch((error) => {
        console.error('[Serial Agent MCP] Failed to start:', error);
        process.exit(1);
    });
}
