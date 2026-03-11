"use strict";
/**
 * Bridge Server — HTTP REST API for MCP Server
 *
 * 在扩展进程中内嵌 HTTP Server，暴露 REST API 供 MCP Server 调用。
 * - 仅绑定 127.0.0.1（安全要求）
 * - Token 认证（每次激活生成新 Token）
 * - 服务发现文件 (~/.serialagent/bridge.json)
 *
 * 独立模块：不依赖 vscode，使用 ISerialManager + ILogger 接口，
 * 支持在单元测试中使用 MockSerialManager 替代真实串口。
 *
 * 对应 spec.md §3.1.2
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
exports.BridgeServer = void 0;
const http = __importStar(require("http"));
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
class BridgeServer {
    constructor(sm, logger, authEnabled = false, version = '0.0.0') {
        this._server = null;
        this._token = '';
        this._port = 0;
        this._instanceId = '';
        this._onUiClear = null;
        this._keilApi = null;
        /** 进行中的 wait 请求取消函数列表（S2.05: 优雅关闭用） */
        this._activeWaiters = new Set();
        this._serialManager = sm;
        this._logger = logger;
        this._authEnabled = authEnabled;
        this._version = version;
    }
    /** 设置 UI 同步回调：Bridge API 清空日志时通知 Webview */
    setOnUiClear(cb) { this._onUiClear = cb; }
    /** 设置 Keil API：供 Bridge 调用配置检测、编译、烧录 */
    setKeilApi(api) { this._keilApi = api; }
    get port() { return this._port; }
    get token() { return this._token; }
    // ---- 生命周期 ----
    async start() {
        // H2: 重复调用保护，先关闭旧 server
        if (this._server) {
            await this.stop();
        }
        this._token = crypto.randomUUID();
        this._instanceId = crypto.randomUUID();
        this._server = http.createServer((req, res) => this._handleRequest(req, res));
        return new Promise((resolve, reject) => {
            this._server.listen(0, '127.0.0.1', () => {
                const addr = this._server.address();
                this._port = addr.port;
                this._logger.appendLine(`[Serial Agent Bridge] Started on 127.0.0.1:${this._port}`);
                this._writeBridgeFile();
                resolve();
            });
            this._server.on('error', (err) => {
                this._logger.appendLine(`[Serial Agent Bridge] Failed to start: ${err.message}`);
                reject(err);
            });
        });
    }
    async stop() {
        // S2.05: 取消所有进行中的 wait 请求
        for (const cancel of this._activeWaiters) {
            cancel();
        }
        this._activeWaiters.clear();
        this._deleteBridgeFile();
        return new Promise((resolve) => {
            if (this._server) {
                this._server.close(() => { this._server = null; resolve(); });
            }
            else {
                resolve();
            }
        });
    }
    // ---- 服务发现文件 (S1.02) ----
    _getBridgeFilePath() {
        return path.join(os.homedir(), '.serialagent', 'bridge.json');
    }
    _writeBridgeFile() {
        const filePath = this._getBridgeFilePath();
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = {
            port: this._port,
            pid: process.pid,
            token: this._token,
            instanceId: this._instanceId,
            version: this._version,
            startedAt: new Date().toISOString(),
        };
        // Windows 不支持 mode 参数，跳过权限设置；macOS/Linux 设置 0o600
        const writeOpts = process.platform === 'win32' ? 'utf8' : { encoding: 'utf8', mode: 0o600 };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), writeOpts);
        this._logger.appendLine(`[Serial Agent Bridge] Discovery file written: ${filePath}`);
    }
    _deleteBridgeFile() {
        try {
            const filePath = this._getBridgeFilePath();
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                this._logger.appendLine('[Serial Agent Bridge] Discovery file deleted');
            }
        }
        catch { /* ignore */ }
    }
    // ---- Token 认证中间件 (S1.10) ----
    _checkAuth(req, res) {
        if (!this._authEnabled) {
            return true;
        }
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${this._token}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return false;
        }
        return true;
    }
    // ---- 请求路由 ----
    async _handleRequest(req, res) {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (!this._checkAuth(req, res)) {
            return;
        }
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${this._port}`);
        const pathname = url.pathname;
        const method = req.method ?? 'GET';
        try {
            if (method === 'GET' && pathname === '/api/status') {
                await this._handleStatus(res);
            }
            else if (method === 'GET' && pathname === '/api/ports') {
                await this._handlePorts(res);
            }
            else if (method === 'POST' && pathname === '/api/connect') {
                await this._handleConnect(req, res);
            }
            else if (method === 'POST' && pathname === '/api/disconnect') {
                await this._handleDisconnect(res);
            }
            else if (method === 'GET' && pathname === '/api/log') {
                await this._handleLog(res, url);
            }
            else if (method === 'POST' && pathname === '/api/send') {
                await this._handleSend(req, res);
            }
            else if (method === 'GET' && pathname === '/api/log/wait') {
                await this._handleLogWait(res, url);
            }
            else if (method === 'POST' && pathname === '/api/send-and-wait') {
                await this._handleSendAndWait(req, res);
            }
            else if (method === 'POST' && pathname === '/api/clear') {
                await this._handleClear(res);
            }
            else if (method === 'GET' && pathname === '/api/keil/config-check') {
                await this._handleKeilConfigCheck(res);
            }
            else if (method === 'POST' && pathname === '/api/keil/build') {
                await this._handleKeilBuild(res);
            }
            else if (method === 'POST' && pathname === '/api/keil/flash') {
                await this._handleKeilFlash(req, res);
            }
            else if (method === 'POST' && pathname === '/api/keil/build-and-flash') {
                await this._handleKeilBuildAndFlash(res);
            }
            else if (method === 'POST' && pathname === '/api/keil/build-flash') {
                await this._handleKeilBuildAndFlash(res);
            } // alias
            else {
                this._json(res, 404, { error: `Not found: ${method} ${pathname}` });
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._logger.appendLine(`[Serial Agent Bridge] Error: ${method} ${pathname} -> ${msg}`);
            this._json(res, 500, { error: msg });
        }
    }
    _readBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
                if (body.length > BridgeServer.MAX_BODY_SIZE) {
                    req.destroy();
                    reject(new Error('Request body too large'));
                }
            });
            req.on('end', () => {
                try {
                    resolve(body ? JSON.parse(body) : {});
                }
                catch {
                    reject(new Error('Invalid JSON body'));
                }
            });
            req.on('error', reject);
        });
    }
    _json(res, status, data) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    _jsonError(res, status, code, message, details) {
        const payload = {
            success: false,
            error: {
                code,
                message,
            },
        };
        if (details) {
            payload.error = {
                code,
                message,
                details,
            };
        }
        this._json(res, status, payload);
    }
    _mapKeilError(err, fallbackCode) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('KEIL_TASK_BUSY')) {
            return { status: 409, code: 'KEIL_TASK_BUSY', message: 'Another Keil build/flash task is currently running' };
        }
        if (msg.toLowerCase().includes('cannot find') || msg.toLowerCase().includes('missing')) {
            return { status: 400, code: 'KEIL_CONFIG_INVALID', message: msg };
        }
        return { status: 500, code: fallbackCode, message: msg };
    }
    _ensureKeilApi(res) {
        if (!this._keilApi) {
            this._jsonError(res, 501, 'KEIL_API_UNAVAILABLE', 'Keil API is not initialized in extension');
            return null;
        }
        return this._keilApi;
    }
    // ---- API Handlers (S1.03 ~ S1.09) ----
    /** S1.03: GET /api/status */
    async _handleStatus(res) {
        const connected = this._serialManager.isConnected;
        const rxBytes = this._serialManager.rxBytes;
        const txBytes = this._serialManager.txBytes;
        const bufferedLines = this._serialManager.getLogBuffer().length;
        // 当 connected=false 但有历史活动数据时，附加提示帮助 AI 判断
        let statusHint;
        if (!connected && (rxBytes > 0 || txBytes > 0 || bufferedLines > 0)) {
            statusHint = 'Port reports disconnected but has historical activity (rxBytes/txBytes/bufferedLines > 0). '
                + 'It may have experienced a transient disconnect. Try connect_serial to re-establish.';
        }
        const result = {
            connected,
            port: this._serialManager.currentPath,
            baudRate: this._serialManager.currentBaudRate,
            rxBytes,
            txBytes,
            bufferedLines,
            isReconnecting: this._serialManager.isReconnecting,
        };
        if (statusHint) {
            result.statusHint = statusHint;
        }
        this._json(res, 200, result);
    }
    /** S1.04: GET /api/ports */
    async _handlePorts(res) {
        const ports = await this._serialManager.listPorts();
        this._json(res, 200, { ports });
    }
    /** S1.05: POST /api/connect */
    async _handleConnect(req, res) {
        const body = await this._readBody(req);
        if (!body.port || typeof body.port !== 'string') {
            this._json(res, 400, { success: false, error: 'Missing required field: port' });
            return;
        }
        const baudRateRaw = body.baudRate;
        if (baudRateRaw !== undefined &&
            (typeof baudRateRaw !== 'number' || !Number.isFinite(baudRateRaw) || !Number.isInteger(baudRateRaw) || baudRateRaw <= 0)) {
            this._json(res, 400, { success: false, error: 'Invalid baudRate: must be a positive integer' });
            return;
        }
        const dataBitsRaw = body.dataBits;
        if (dataBitsRaw !== undefined && dataBitsRaw !== 5 && dataBitsRaw !== 6 && dataBitsRaw !== 7 && dataBitsRaw !== 8) {
            this._json(res, 400, { success: false, error: 'Invalid dataBits: must be one of 5,6,7,8' });
            return;
        }
        const parityRaw = body.parity;
        if (parityRaw !== undefined && parityRaw !== 'none' && parityRaw !== 'even' && parityRaw !== 'odd' && parityRaw !== 'mark' && parityRaw !== 'space') {
            this._json(res, 400, { success: false, error: 'Invalid parity: must be one of none/even/odd/mark/space' });
            return;
        }
        const stopBitsRaw = body.stopBits;
        if (stopBitsRaw !== undefined && stopBitsRaw !== 1 && stopBitsRaw !== 1.5 && stopBitsRaw !== 2) {
            this._json(res, 400, { success: false, error: 'Invalid stopBits: must be one of 1/1.5/2' });
            return;
        }
        const baudRate = typeof baudRateRaw === 'number' ? baudRateRaw : 115200;
        const dataBits = dataBitsRaw === 5 || dataBitsRaw === 6 || dataBitsRaw === 7 || dataBitsRaw === 8 ? dataBitsRaw : 8;
        const parity = parityRaw === 'none' || parityRaw === 'even' || parityRaw === 'odd' || parityRaw === 'mark' || parityRaw === 'space' ? parityRaw : 'none';
        const stopBits = stopBitsRaw === 1 || stopBitsRaw === 1.5 || stopBitsRaw === 2 ? stopBitsRaw : 1;
        const config = {
            port: body.port,
            baudRate,
            dataBits,
            parity,
            stopBits,
            // 保留当前显示设置
            lineEnding: this._serialManager.config.lineEnding,
            showTimestamp: this._serialManager.config.showTimestamp,
            hexMode: this._serialManager.config.hexMode,
        };
        const ok = await this._serialManager.connect(config);
        if (ok) {
            this._json(res, 200, { success: true, message: `Connected to ${config.port} @ ${config.baudRate}` });
        }
        else {
            this._json(res, 400, { success: false, error: `Failed to connect to ${config.port}` });
        }
    }
    /** S1.06: POST /api/disconnect */
    async _handleDisconnect(res) {
        await this._serialManager.disconnect();
        this._json(res, 200, { success: true });
    }
    /** S1.07: GET /api/log?lines=50 */
    async _handleLog(res, url) {
        const linesParam = url.searchParams.get('lines');
        const lines = linesParam ? Math.max(1, parseInt(linesParam, 10) || 50) : 50;
        const buffer = this._serialManager.getLogBuffer();
        this._json(res, 200, {
            lines: buffer.slice(-lines),
            totalBuffered: buffer.length,
        });
    }
    /** S1.08: POST /api/send */
    async _handleSend(req, res) {
        const body = await this._readBody(req);
        if (body.data === undefined || body.data === null) {
            this._json(res, 400, { success: false, error: 'Missing required field: data' });
            return;
        }
        if (!this._serialManager.isConnected) {
            this._json(res, 400, { success: false, error: 'Not connected to any serial port' });
            return;
        }
        const data = String(body.data);
        const hexMode = body.hexMode ?? false;
        const lineEnding = body.lineEnding ?? this._serialManager.config.lineEnding;
        const result = await this._sendAndEcho(data, hexMode, lineEnding);
        if (result.ok) {
            this._json(res, 200, { success: true, bytesSent: result.bytesSent });
        }
        else {
            this._json(res, 400, { success: false, error: 'Send failed (check HEX format or connection)' });
        }
    }
    /**
     * S2.02: GET /api/log/wait
     *
     * 阻塞等待串口输出匹配指定 pattern。
     * - pattern: 正则表达式或纯文本匹配模式（必填）
     * - timeout: 等待超时秒数，默认 30，范围 1-120
     * - scanBuffer: 是否先扫描现有缓冲区（默认 true）
     *
     * scanBuffer=true 时先扫描已有日志（配合 clear_serial_log 使用，
     * 可捕获 clear 之后、wait 之前到达的数据，消除烧录后等待的时序竞态）。
     * scanBuffer=false 时仅监听调用之后的新日志（旧行为）。
     * 如需原子性 send+wait，使用 POST /api/send-and-wait。
     */
    async _handleLogWait(res, url) {
        const pattern = url.searchParams.get('pattern');
        if (!pattern) {
            this._json(res, 400, { error: 'Missing required parameter: pattern' });
            return;
        }
        const timeoutSec = Math.min(120, Math.max(1, parseInt(url.searchParams.get('timeout') ?? '30', 10) || 30));
        const scanBuffer = url.searchParams.get('scanBuffer') !== 'false'; // default true
        const regex = this._buildRegex(pattern);
        const startTime = Date.now();
        const recentLogs = [];
        // Buffer Pre-scan：先扫描现有缓冲区，捕获 clear 之后、wait 之前到达的日志
        if (scanBuffer) {
            const existingBuffer = this._serialManager.getLogBuffer();
            recentLogs.push(...existingBuffer.slice(-50));
            for (const line of existingBuffer) {
                if (regex.test(line)) {
                    this._json(res, 200, {
                        found: true,
                        matchedLine: line,
                        matchedAt: new Date().toISOString(),
                        waitedMs: Date.now() - startTime,
                        recentLogs: recentLogs.slice(-20),
                    });
                    return;
                }
            }
        }
        // 缓冲区未匹配（或 scanBuffer=false），订阅新日志等待
        return this._waitForPattern(res, regex, timeoutSec, startTime, recentLogs);
    }
    /**
     * POST /api/send-and-wait
     *
     * 原子操作：先订阅日志 → 发送数据 → 等待匹配输出。
     * 彻底消除 send_serial_data + wait_for_output 之间的竞态条件。
     *
     * body: { data, pattern, timeout?, hexMode?, lineEnding? }
     */
    async _handleSendAndWait(req, res) {
        const body = await this._readBody(req);
        if (body.data === undefined || body.data === null) {
            this._json(res, 400, { success: false, error: 'Missing required field: data' });
            return;
        }
        if (!body.pattern || typeof body.pattern !== 'string') {
            this._json(res, 400, { success: false, error: 'Missing required field: pattern' });
            return;
        }
        if (!this._serialManager.isConnected) {
            this._json(res, 400, { success: false, error: 'Not connected to any serial port' });
            return;
        }
        const data = String(body.data);
        const pattern = body.pattern;
        const timeoutSec = Math.min(120, Math.max(1, Number(body.timeout) || 10));
        const hexMode = body.hexMode ?? false;
        const lineEnding = body.lineEnding ?? this._serialManager.config.lineEnding;
        const regex = this._buildRegex(pattern);
        const startTime = Date.now();
        const recentLogs = [];
        // 关键顺序：先订阅，再发送，确保不丢失快速响应
        this._serialManager.onNewLog(onLineCollector);
        // 临时收集器：在 _waitForPattern 建立之前先收集日志
        let earlyLines = [];
        let earlyMatch = null;
        function onLineCollector(line) {
            earlyLines.push(line);
            if (!earlyMatch && regex.test(line)) {
                earlyMatch = line;
            }
        }
        const sendResult = await this._sendAndEcho(data, hexMode, lineEnding);
        this._serialManager.offNewLog(onLineCollector);
        if (!sendResult.ok) {
            this._json(res, 400, { sendSuccess: false, error: 'Send failed (check HEX format or connection)' });
            return;
        }
        // 发送成功后检查：在 send 期间是否已匹配
        recentLogs.push(...earlyLines);
        if (earlyMatch) {
            this._json(res, 200, {
                sendSuccess: true,
                found: true,
                matchedLine: earlyMatch,
                matchedAt: new Date().toISOString(),
                waitedMs: Date.now() - startTime,
                recentLogs: recentLogs.slice(-20),
            });
            return;
        }
        // 未立即匹配，进入正常等待流程
        return this._waitForPattern(res, regex, timeoutSec, startTime, recentLogs, true);
    }
    // ---- 共享工具方法 ----
    /** 构建正则匹配器（无效正则退化为纯文本包含匹配） */
    _buildRegex(pattern) {
        try {
            return new RegExp(pattern);
        }
        catch {
            return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
    }
    /** 执行发送 + Echo 注入，返回发送结果和字节数（_handleSend 和 _handleSendAndWait 共用） */
    async _sendAndEcho(data, hexMode, lineEnding) {
        const ok = await this._serialManager.send(data, hexMode, lineEnding);
        if (!ok) {
            return { ok: false, bytesSent: 0 };
        }
        let bytesSent;
        if (hexMode) {
            bytesSent = data.replace(/\s+/g, '').length / 2;
        }
        else {
            const suffixes = { lf: '\n', crlf: '\r\n', cr: '\r', none: '' };
            bytesSent = Buffer.byteLength(data + (suffixes[lineEnding] ?? '\n'), 'utf8');
        }
        this._serialManager.injectLog(`MCP TX>> ${data}`);
        return { ok: true, bytesSent };
    }
    /** 订阅新日志并等待 pattern 匹配（wait_for_output 和 send_and_wait 共用） */
    _waitForPattern(res, regex, timeoutSec, startTime, recentLogs, sendAndWait = false) {
        return new Promise((resolve) => {
            let settled = false;
            const timeoutMs = timeoutSec * 1000;
            const cleanup = () => {
                if (settled) {
                    return;
                }
                settled = true;
                this._serialManager.offNewLog(onLine);
                clearTimeout(timer);
                this._activeWaiters.delete(cancel);
            };
            const onLine = (line) => {
                recentLogs.push(line);
                if (recentLogs.length > 50) {
                    recentLogs.shift();
                }
                if (regex.test(line)) {
                    cleanup();
                    const result = {
                        found: true,
                        matchedLine: line,
                        matchedAt: new Date().toISOString(),
                        waitedMs: Date.now() - startTime,
                        recentLogs: recentLogs.slice(-20),
                    };
                    if (sendAndWait) {
                        result.sendSuccess = true;
                    }
                    this._json(res, 200, result);
                    resolve();
                }
            };
            const timer = setTimeout(() => {
                cleanup();
                const result = {
                    found: false,
                    waitedMs: Date.now() - startTime,
                    recentLogs: recentLogs.slice(-20),
                    hint: 'Device may not have been flashed yet, or the expected pattern was not printed.',
                };
                if (sendAndWait) {
                    result.sendSuccess = true;
                }
                this._json(res, 200, result);
                resolve();
            }, timeoutMs);
            const cancel = () => {
                cleanup();
                const result = {
                    found: false,
                    waitedMs: Date.now() - startTime,
                    recentLogs: recentLogs.slice(-20),
                    hint: 'Wait cancelled: Bridge Server shutting down.',
                };
                if (sendAndWait) {
                    result.sendSuccess = true;
                }
                this._json(res, 200, result);
                resolve();
            };
            this._activeWaiters.add(cancel);
            this._serialManager.onNewLog(onLine);
        });
    }
    /** S1.09: POST /api/clear */
    async _handleClear(res) {
        this._serialManager.clearLog();
        this._serialManager.resetCounters();
        this._onUiClear?.();
        this._json(res, 200, { success: true });
    }
    async _handleKeilConfigCheck(res) {
        const keilApi = this._ensureKeilApi(res);
        if (!keilApi) {
            return;
        }
        try {
            const report = await keilApi.checkConfig();
            this._json(res, 200, {
                success: true,
                data: {
                    configOk: report.ready,
                    checks: report.checks,
                    projectFile: report.projectFile,
                    target: report.target,
                },
            });
        }
        catch (err) {
            const mapped = this._mapKeilError(err, 'KEIL_CONFIG_CHECK_FAILED');
            this._jsonError(res, mapped.status, mapped.code, mapped.message, { stage: 'config-check' });
        }
    }
    async _handleKeilBuild(res) {
        const keilApi = this._ensureKeilApi(res);
        if (!keilApi) {
            return;
        }
        if (keilApi.isBusy()) {
            this._jsonError(res, 409, 'KEIL_TASK_BUSY', 'Another Keil build/flash task is currently running', { stage: 'build' });
            return;
        }
        try {
            const result = await keilApi.build();
            this._json(res, 200, {
                success: true,
                data: {
                    stage: 'build',
                    buildOk: result.success,
                    artifactPath: result.artifactPath,
                    projectFile: result.projectFile,
                    target: result.target,
                },
            });
        }
        catch (err) {
            const mapped = this._mapKeilError(err, 'KEIL_BUILD_FAILED');
            this._jsonError(res, mapped.status, mapped.code, mapped.message, { stage: 'build' });
        }
    }
    async _handleKeilFlash(req, res) {
        const keilApi = this._ensureKeilApi(res);
        if (!keilApi) {
            return;
        }
        if (keilApi.isBusy()) {
            this._jsonError(res, 409, 'KEIL_TASK_BUSY', 'Another Keil build/flash task is currently running', { stage: 'flash' });
            return;
        }
        try {
            const body = await this._readBody(req);
            const artifactPath = typeof body.artifactPath === 'string' ? body.artifactPath : undefined;
            const result = await keilApi.flash(artifactPath);
            this._json(res, 200, {
                success: true,
                data: {
                    stage: 'flash',
                    flashOk: result.success,
                    artifactPath: result.artifactPath,
                    projectFile: result.projectFile,
                    target: result.target,
                },
            });
        }
        catch (err) {
            const mapped = this._mapKeilError(err, 'KEIL_FLASH_FAILED');
            this._jsonError(res, mapped.status, mapped.code, mapped.message, { stage: 'flash' });
        }
    }
    async _handleKeilBuildAndFlash(res) {
        const keilApi = this._ensureKeilApi(res);
        if (!keilApi) {
            return;
        }
        if (keilApi.isBusy()) {
            this._jsonError(res, 409, 'KEIL_TASK_BUSY', 'Another Keil build/flash task is currently running', { stage: 'build-and-flash' });
            return;
        }
        try {
            const result = await keilApi.buildAndFlash();
            this._json(res, 200, {
                success: true,
                data: {
                    stage: 'build-and-flash',
                    buildOk: true,
                    flashOk: true,
                    artifactPath: result.artifactPath,
                    projectFile: result.projectFile,
                    target: result.target,
                },
            });
        }
        catch (err) {
            const mapped = this._mapKeilError(err, 'KEIL_BUILD_FLASH_FAILED');
            this._jsonError(res, mapped.status, mapped.code, mapped.message, { stage: 'build-and-flash' });
        }
    }
}
exports.BridgeServer = BridgeServer;
// ---- 工具方法 ----
/** 最大 body 大小 1MB（防止恶意大请求） */
BridgeServer.MAX_BODY_SIZE = 1024 * 1024;
