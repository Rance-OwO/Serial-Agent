/**
 * Bridge Server REST API 单元测试
 *
 * 测试 Bridge Server 对外暴露的 HTTP REST API 端点。
 * 使用 BridgeServer + MockSerialManager 进行真实 HTTP 请求测试。
 *
 * 对应 spec.md §8.2 Bridge Server API 测试用例 (T-B01 ~ T-B15)
 * 对应 Plan.md S1.20
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import { BridgeServer } from '../packages/serialagent-vscode/src/bridge-server';
import { MockSerialManager } from './mocks/mock-serial-manager';
import { ILogger, IKeilApi, KeilConfigCheckResult, KeilTaskResult } from '../packages/serialagent-vscode/src/types';

// ---- 测试工具 ----

/** 静默日志记录器（测试中不输出） */
class SilentLogger implements ILogger {
  readonly lines: string[] = [];
  appendLine(value: string): void { this.lines.push(value); }
}

class FakeKeilApi implements IKeilApi {
  busy = false;
  checkConfigError: Error | null = null;
  buildError: Error | null = null;
  flashError: Error | null = null;
  buildAndFlashError: Error | null = null;
  configReport: KeilConfigCheckResult = {
    ready: true,
    checks: [{ key: 'uv4Path', ok: true, message: 'ok' }],
    projectFile: 'D:/_KeilProject/demo.uvprojx',
    target: 'Target 1',
  };
  buildResult: KeilTaskResult = {
    success: true,
    projectFile: 'D:/_KeilProject/demo.uvprojx',
    artifactPath: 'D:/_KeilProject/Objects/demo.hex',
    target: 'Target 1',
  };

  isBusy(): boolean { return this.busy; }
  async checkConfig(): Promise<KeilConfigCheckResult> {
    if (this.checkConfigError) { throw this.checkConfigError; }
    return this.configReport;
  }
  async build(): Promise<KeilTaskResult> {
    if (this.buildError) { throw this.buildError; }
    return this.buildResult;
  }
  async flash(artifactPath?: string): Promise<KeilTaskResult> {
    if (this.flashError) { throw this.flashError; }
    if (artifactPath) {
      return { ...this.buildResult, artifactPath };
    }
    return this.buildResult;
  }
  async buildAndFlash(): Promise<KeilTaskResult> {
    if (this.buildAndFlashError) { throw this.buildAndFlashError; }
    return this.buildResult;
  }
}

/** 发送 HTTP 请求并返回解析后的响应 */
function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: object,
  headers?: Record<string, string>,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: string) => { raw += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
        });
      },
    );
    req.on('error', reject);
    if (body) { req.write(JSON.stringify(body)); }
    req.end();
  });
}

/** 发送原始 HTTP 请求（用于 OPTIONS/非法 JSON 等场景） */
function rawHttpRequest(
  port: number,
  method: string,
  path: string,
  rawBody?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: string) => { raw += chunk; });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            text: raw,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (rawBody !== undefined) { req.write(rawBody); }
    req.end();
  });
}

// ---- 测试套件 ----

describe('Bridge Server API', () => {
  let mock: MockSerialManager;
  let logger: SilentLogger;
  let bridge: BridgeServer;
  let port: number;
  let token: string;

  /** 带 Token 的请求快捷方法 */
  function authRequest(method: string, path: string, body?: object) {
    return httpRequest(port, method, path, body, { 'Authorization': `Bearer ${token}` });
  }

  beforeAll(async () => {
    mock = new MockSerialManager();
    logger = new SilentLogger();
    bridge = new BridgeServer(mock, logger, true);
    await bridge.start();
    port = bridge.port;
    token = bridge.token;
  });

  afterAll(async () => {
    await bridge.stop();
  });

  beforeEach(() => {
    mock.reset();
  });

  // ======== 认证 (S1.10) ========

  describe('认证 (Token Auth)', () => {
    it('T-B01: 无 Token 请求任意 API 应返回 401', async () => {
      const res = await httpRequest(port, 'GET', '/api/status');
      expect(res.status).toBe(401);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('AUTH_REQUIRED');
      expect(res.data.error.message).toContain('Authorization');
    });

    it('T-B02: 错误 Token 请求应返回 401', async () => {
      const res = await httpRequest(port, 'GET', '/api/status', undefined, {
        'Authorization': 'Bearer wrong-token-12345',
      });
      expect(res.status).toBe(401);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('T-B02b: 正确 Token 请求应返回 200', async () => {
      const res = await authRequest('GET', '/api/status');
      expect(res.status).toBe(200);
    });
  });

  // ======== GET /api/status (S1.03) ========

  describe('GET /api/status', () => {
    it('未连接时返回 connected: false', async () => {
      const res = await authRequest('GET', '/api/status');
      expect(res.status).toBe(200);
      expect(res.data.connected).toBe(false);
      expect(res.data.bufferedLines).toBe(0);
      expect(res.data.isReconnecting).toBe(false);
    });

    it('连接后返回 connected: true + 端口/波特率信息', async () => {
      mock.setMockPorts([{ path: 'COM3', manufacturer: 'Test' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      const res = await authRequest('GET', '/api/status');
      expect(res.status).toBe(200);
      expect(res.data.connected).toBe(true);
      expect(res.data.port).toBe('COM3');
      expect(res.data.baudRate).toBe(115200);
    });
  });

  // ======== GET /api/ports (S1.04) ========

  describe('GET /api/ports', () => {
    it('T-B03: 无设备插入时应返回空数组', async () => {
      const res = await authRequest('GET', '/api/ports');
      expect(res.status).toBe(200);
      expect(res.data.ports).toEqual([]);
    });

    it('T-B04: 有设备时应返回设备信息数组', async () => {
      mock.setMockPorts([
        { path: 'COM3', manufacturer: 'Silicon Labs', vendorId: '10C4', productId: 'EA60' },
        { path: 'COM5', manufacturer: 'FTDI' },
      ]);
      const res = await authRequest('GET', '/api/ports');
      expect(res.status).toBe(200);
      expect(res.data.ports).toHaveLength(2);
      expect(res.data.ports[0].path).toBe('COM3');
      expect(res.data.ports[0].manufacturer).toBe('Silicon Labs');
      expect(res.data.ports[1].path).toBe('COM5');
    });
  });

  // ======== POST /api/connect (S1.05) ========

  describe('POST /api/connect', () => {
    it('T-B05: 合法端口应连接成功', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      const res = await authRequest('POST', '/api/connect', { port: 'COM3', baudRate: 115200 });
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.message).toContain('COM3');
      expect(mock.isConnected).toBe(true);
    });

    it('T-B06: 非法端口应返回错误', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      mock.setPortFail('COM3');
      const res = await authRequest('POST', '/api/connect', { port: 'COM3' });
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
    });

    it('T-B06b: 缺少 port 字段应返回 400', async () => {
      const res = await authRequest('POST', '/api/connect', { baudRate: 115200 });
      expect(res.status).toBe(400);
      expect(res.data.error.code).toBe('MISSING_REQUIRED_FIELD');
      expect(res.data.error.message).toContain('port');
    });

    it('无效 baudRate 应返回 400', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      const res = await authRequest('POST', '/api/connect', { port: 'COM3', baudRate: -9600 });
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('INVALID_ARGUMENT');
      expect(res.data.error.message).toContain('baudRate');
    });

    it('无效 parity 应返回 400', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      const res = await authRequest('POST', '/api/connect', { port: 'COM3', parity: 'bad-parity' });
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('INVALID_ARGUMENT');
      expect(res.data.error.message).toContain('parity');
    });

    it('T-B07: 已连接时再连接应先断开旧连接', async () => {
      mock.setMockPorts([{ path: 'COM3' }, { path: 'COM5' }]);
      await authRequest('POST', '/api/connect', { port: 'COM3' });
      expect(mock.currentPath).toBe('COM3');
      await authRequest('POST', '/api/connect', { port: 'COM5' });
      expect(mock.currentPath).toBe('COM5');
      expect(mock.isConnected).toBe(true);
    });
  });

  // ======== POST /api/disconnect (S1.06) ========

  describe('POST /api/disconnect', () => {
    it('T-B08: 未连接时断开应返回 success（幂等）', async () => {
      const res = await authRequest('POST', '/api/disconnect');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });

    it('连接后断开应成功', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await authRequest('POST', '/api/connect', { port: 'COM3' });
      expect(mock.isConnected).toBe(true);
      const res = await authRequest('POST', '/api/disconnect');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(mock.isConnected).toBe(false);
    });
  });

  // ======== GET /api/log (S1.07) ========

  describe('GET /api/log', () => {
    it('T-B09: 缓冲区为空时应返回空数组', async () => {
      const res = await authRequest('GET', '/api/log');
      expect(res.status).toBe(200);
      expect(res.data.lines).toEqual([]);
      expect(res.data.totalBuffered).toBe(0);
    });

    it('T-B10: lines=5 且缓冲区有 100 行时应返回最后 5 行', async () => {
      for (let i = 0; i < 100; i++) {
        mock.simulateLog(`Line ${i}`);
      }
      const res = await authRequest('GET', '/api/log?lines=5');
      expect(res.status).toBe(200);
      expect(res.data.lines).toHaveLength(5);
      expect(res.data.lines[0]).toBe('Line 95');
      expect(res.data.lines[4]).toBe('Line 99');
      expect(res.data.totalBuffered).toBe(100);
    });

    it('默认返回 50 行', async () => {
      for (let i = 0; i < 80; i++) {
        mock.simulateLog(`Log ${i}`);
      }
      const res = await authRequest('GET', '/api/log');
      expect(res.status).toBe(200);
      expect(res.data.lines).toHaveLength(50);
      expect(res.data.lines[0]).toBe('Log 30');
    });
  });

  // ======== POST /api/send (S1.08) ========

  describe('POST /api/send', () => {
    it('T-B11: 未连接时发送应返回失败', async () => {
      const res = await authRequest('POST', '/api/send', { data: 'hello' });
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('SERIAL_NOT_CONNECTED');
      expect(res.data.error.message).toContain('Not connected');
    });

    it('T-B12: HEX 格式错误应返回错误提示', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      const res = await authRequest('POST', '/api/send', { data: 'ZZZZ', hexMode: true });
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
    });

    it('文本模式发送成功', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      const res = await authRequest('POST', '/api/send', { data: 'AT+RST', lineEnding: 'crlf' });
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.bytesSent).toBeGreaterThan(0);
    });

    it('缺少 data 字段应返回 400', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      const res = await authRequest('POST', '/api/send', {});
      expect(res.status).toBe(400);
      expect(res.data.error.code).toBe('MISSING_REQUIRED_FIELD');
      expect(res.data.error.message).toContain('data');
    });
  });

  // ======== POST /api/clear (S1.09) ========

  describe('POST /api/clear', () => {
    it('清空后日志缓冲区为空', async () => {
      mock.simulateLogs(['line1', 'line2', 'line3']);
      expect(mock.getLogBuffer()).toHaveLength(3);
      const res = await authRequest('POST', '/api/clear');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      // 验证缓冲区已清空
      const logRes = await authRequest('GET', '/api/log');
      expect(logRes.data.lines).toEqual([]);
      expect(logRes.data.totalBuffered).toBe(0);
    });
  });

  // ======== GET /api/log/wait (S2.02) ========

  describe('GET /api/log/wait', () => {
    it('缺少 pattern 参数应返回 400', async () => {
      const res = await authRequest('GET', '/api/log/wait');
      expect(res.status).toBe(400);
      expect(res.data.error.code).toBe('MISSING_REQUIRED_PARAMETER');
      expect(res.data.error.message).toContain('pattern');
    });

    it('T-B13: pattern 匹配成功应立即返回 found: true', async () => {
      // 延迟 100ms 后模拟设备输出
      setTimeout(() => {
        mock.simulateLog('Booting...');
        mock.simulateLog('System Ready');
      }, 100);

      const res = await authRequest('GET', '/api/log/wait?pattern=Ready&timeout=5');
      expect(res.status).toBe(200);
      expect(res.data.found).toBe(true);
      expect(res.data.matchedLine).toContain('Ready');
      expect(res.data.waitedMs).toBeLessThan(3000);
      expect(res.data.recentLogs).toBeInstanceOf(Array);
    });

    it('T-B14: 超时应返回 found: false', async () => {
      const res = await authRequest('GET', '/api/log/wait?pattern=NeverMatch&timeout=1');
      expect(res.status).toBe(200);
      expect(res.data.found).toBe(false);
      expect(res.data.waitedMs).toBeGreaterThanOrEqual(900);
      expect(res.data.hint).toBeTruthy();
    });

    it('缓冲区已有匹配数据时立即返回（修复竞态条件）', async () => {
      mock.simulateLog('Old log: System Ready');
      const res = await authRequest('GET', '/api/log/wait?pattern=Ready&timeout=1');
      expect(res.status).toBe(200);
      expect(res.data.found).toBe(true);
      expect(res.data.matchedLine).toContain('Ready');
      expect(res.data.waitedMs).toBeLessThan(100);
    });

    it('fromNow 参数已废弃，始终先检查缓冲区', async () => {
      mock.simulateLog('Buffered: Boot OK');
      // 即使传 fromNow=true，也应该先检查缓冲区
      const res = await authRequest('GET', '/api/log/wait?pattern=Boot%20OK&timeout=1&fromNow=true');
      expect(res.status).toBe(200);
      expect(res.data.found).toBe(true);
      expect(res.data.matchedLine).toContain('Boot OK');
    });

    it('正则表达式 pattern 支持', async () => {
      setTimeout(() => {
        mock.simulateLog('[ERROR] GPIO5: invalid pin');
      }, 50);

      const res = await authRequest('GET', `/api/log/wait?pattern=${encodeURIComponent('\\[ERROR\\].*GPIO')}&timeout=3`);
      expect(res.status).toBe(200);
      expect(res.data.found).toBe(true);
      expect(res.data.matchedLine).toContain('GPIO5');
    });
  });

  // ======== POST /api/send-and-wait ========

  describe('POST /api/send-and-wait', () => {
    it('缺少 data 字段应返回 400', async () => {
      const res = await authRequest('POST', '/api/send-and-wait', { pattern: 'OK' });
      expect(res.status).toBe(400);
      expect(res.data.error.code).toBe('MISSING_REQUIRED_FIELD');
      expect(res.data.error.message).toContain('data');
    });

    it('缺少 pattern 字段应返回 400', async () => {
      const res = await authRequest('POST', '/api/send-and-wait', { data: 'AT' });
      expect(res.status).toBe(400);
      expect(res.data.error.code).toBe('MISSING_REQUIRED_FIELD');
      expect(res.data.error.message).toContain('pattern');
    });

    it('未连接时应返回 400', async () => {
      const res = await authRequest('POST', '/api/send-and-wait', { data: 'AT', pattern: 'OK' });
      expect(res.status).toBe(400);
      expect(res.data.error.code).toBe('SERIAL_NOT_CONNECTED');
      expect(res.data.error.message).toContain('Not connected');
    });

    it('原子性发送并匹配响应（自动响应模拟）', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      mock.setAutoResponse('AT', 'OK', 10);

      const res = await authRequest('POST', '/api/send-and-wait', {
        data: 'AT',
        pattern: 'OK',
        timeout: 5,
        lineEnding: 'crlf',
      });
      expect(res.status).toBe(200);
      expect(res.data.sendSuccess).toBe(true);
      expect(res.data.found).toBe(true);
      expect(res.data.matchedLine).toBe('OK');
      expect(res.data.waitedMs).toBeLessThan(3000);
    });

    it('响应超时时返回 found: false', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      // 不设置 auto-response，设备不会响应

      const res = await authRequest('POST', '/api/send-and-wait', {
        data: 'AT',
        pattern: 'OK',
        timeout: 1,
      });
      expect(res.status).toBe(200);
      expect(res.data.sendSuccess).toBe(true);
      expect(res.data.found).toBe(false);
      expect(res.data.waitedMs).toBeGreaterThanOrEqual(900);
      expect(res.data.hint).toBeTruthy();
    });

    it('发送失败时返回 sendSuccess: false', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });

      // HEX 格式错误导致发送失败
      const res = await authRequest('POST', '/api/send-and-wait', {
        data: 'ZZZZ',
        pattern: 'OK',
        hexMode: true,
      });
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('SERIAL_SEND_FAILED');
    });

    it('Echo 注入到日志缓冲区', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      mock.setAutoResponse('ver', 'Firmware v1.0.0', 10);

      await authRequest('POST', '/api/send-and-wait', {
        data: 'ver',
        pattern: 'Firmware',
        timeout: 5,
      });

      // 检查 Echo 和响应都在缓冲区中
      const logRes = await authRequest('GET', '/api/log');
      expect(logRes.data.lines).toContain('MCP TX>> ver');
      expect(logRes.data.lines).toContain('Firmware v1.0.0');
    });

    it('并发 send-and-wait 请求应各自匹配到对应响应', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      mock.setAutoResponse('CMD1', 'RSP1', 20);
      mock.setAutoResponse('CMD2', 'RSP2', 10);

      const [res1, res2] = await Promise.all([
        authRequest('POST', '/api/send-and-wait', { data: 'CMD1', pattern: 'RSP1', timeout: 3 }),
        authRequest('POST', '/api/send-and-wait', { data: 'CMD2', pattern: 'RSP2', timeout: 3 }),
      ]);

      expect(res1.status).toBe(200);
      expect(res1.data.sendSuccess).toBe(true);
      expect(res1.data.found).toBe(true);
      expect(res1.data.matchedLine).toBe('RSP1');

      expect(res2.status).toBe(200);
      expect(res2.data.sendSuccess).toBe(true);
      expect(res2.data.found).toBe(true);
      expect(res2.data.matchedLine).toBe('RSP2');
    });
  });

  // ======== GET /api/status 状态提示 ========

  describe('GET /api/status (statusHint)', () => {
    it('未连接且无历史数据时无 statusHint', async () => {
      const res = await authRequest('GET', '/api/status');
      expect(res.status).toBe(200);
      expect(res.data.connected).toBe(false);
      expect(res.data.statusHint).toBeUndefined();
    });

    it('未连接但有历史数据时附带 statusHint', async () => {
      // 模拟曾经有数据但当前断开的场景
      mock.simulateLog('Some old log');
      const res = await authRequest('GET', '/api/status');
      expect(res.status).toBe(200);
      expect(res.data.connected).toBe(false);
      expect(res.data.rxBytes).toBeGreaterThan(0);
      expect(res.data.statusHint).toBeTruthy();
      expect(res.data.statusHint).toContain('historical activity');
    });

    it('已连接时无 statusHint', async () => {
      mock.setMockPorts([{ path: 'COM3' }]);
      await mock.connect({ port: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, lineEnding: 'lf', showTimestamp: false, hexMode: false });
      const res = await authRequest('GET', '/api/status');
      expect(res.status).toBe(200);
      expect(res.data.connected).toBe(true);
      expect(res.data.statusHint).toBeUndefined();
    });
  });

  // ======== 404 处理 ========

  describe('路由错误', () => {
    it('不存在的路径应返回 404', async () => {
      const res = await authRequest('GET', '/api/nonexistent');
      expect(res.status).toBe(404);
      expect(res.data.error.code).toBe('NOT_FOUND');
      expect(res.data.error.message).toContain('Not found');
    });
  });

  describe('协议与格式一致性', () => {
    it('OPTIONS 预检请求应返回 204 和 CORS 头', async () => {
      const res = await rawHttpRequest(port, 'OPTIONS', '/api/status');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(String(res.headers['access-control-allow-methods'])).toContain('GET');
      expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
      expect(String(res.headers['access-control-allow-headers'])).toContain('Authorization');
    });

    it('非法 JSON body 应返回 400 且包含统一错误信息', async () => {
      const res = await rawHttpRequest(
        port,
        'POST',
        '/api/connect',
        '{"port":"COM3"',
        {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      );
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.text) as { success: boolean; error: { code: string; message: string } };
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('INVALID_JSON_BODY');
      expect(parsed.error.message).toContain('Invalid JSON body');
    });
  });

  describe('Keil API 状态码与错误码', () => {
    it('Keil API 未初始化应返回 501 + 统一错误格式', async () => {
      const res = await authRequest('GET', '/api/keil/config-check');
      expect(res.status).toBe(501);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('KEIL_API_UNAVAILABLE');
      expect(res.data.error.message).toContain('not initialized');
    });

    it('Keil busy 场景应返回 409 + KEIL_TASK_BUSY', async () => {
      const keilApi = new FakeKeilApi();
      keilApi.busy = true;
      bridge.setKeilApi(keilApi);

      const res = await authRequest('POST', '/api/keil/build');
      expect(res.status).toBe(409);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('KEIL_TASK_BUSY');
      expect(res.data.error.details.stage).toBe('build');
    });

    it('Keil build 成功应返回 200 + success/data', async () => {
      const keilApi = new FakeKeilApi();
      bridge.setKeilApi(keilApi);

      const res = await authRequest('POST', '/api/keil/build');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data.stage).toBe('build');
      expect(res.data.data.buildOk).toBe(true);
      expect(res.data.data.artifactPath).toContain('.hex');
    });

    it('Keil config-check 配置缺失应返回 400 + KEIL_CONFIG_INVALID', async () => {
      const keilApi = new FakeKeilApi();
      keilApi.checkConfigError = new Error('Cannot find UV4 executable');
      bridge.setKeilApi(keilApi);

      const res = await authRequest('GET', '/api/keil/config-check');
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('KEIL_CONFIG_INVALID');
      expect(res.data.error.details.stage).toBe('config-check');
    });

    it('Keil flash 执行失败应返回 500 + KEIL_FLASH_FAILED', async () => {
      const keilApi = new FakeKeilApi();
      keilApi.flashError = new Error('JLink failed unexpectedly');
      bridge.setKeilApi(keilApi);

      const res = await authRequest('POST', '/api/keil/flash', { artifactPath: 'D:/tmp/demo.hex' });
      expect(res.status).toBe(500);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('KEIL_FLASH_FAILED');
      expect(res.data.error.details.stage).toBe('flash');
    });

    it('Keil build-and-flash 成功应返回 200 + buildOk/flashOk', async () => {
      const keilApi = new FakeKeilApi();
      bridge.setKeilApi(keilApi);

      const res = await authRequest('POST', '/api/keil/build-and-flash');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data.stage).toBe('build-and-flash');
      expect(res.data.data.buildOk).toBe(true);
      expect(res.data.data.flashOk).toBe(true);
    });
  });
});
