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

import { createRequire } from 'module';
import * as path from 'path';
import { BridgeServer } from '../packages/serialagent-vscode/src/bridge-server';
import { ISerialManager, ILogger, SerialConfig, PortInfo, DEFAULT_CONFIG } from '../packages/serialagent-vscode/src/types';

// serialport 安装在 packages/serialagent-vscode 中，需从该路径解析
// 使用 process.cwd() 而非 __dirname，确保预编译后路径仍正确
const vscodeRequire = createRequire(path.resolve(process.cwd(), 'packages/serialagent-vscode/package.json'));
const { SerialPort } = vscodeRequire('serialport') as any;

// ============================================================
// 真实 SerialManager（轻量版，仅用于 E2E 测试）
// ============================================================

class RealSerialManager implements ISerialManager {
  private _port: any = null;
  private _config: SerialConfig = { ...DEFAULT_CONFIG };
  private _logBuffer: string[] = [];
  private _rxBuffer: Buffer = Buffer.alloc(0);
  private _rxBytes = 0;
  private _txBytes = 0;
  private _reconnecting = false;
  private _newLogSubscribers: Array<(line: string) => void> = [];

  get isConnected(): boolean { return this._port !== null && this._port.isOpen; }
  get isReconnecting(): boolean { return this._reconnecting; }
  get currentPath(): string { return this._config.port; }
  get currentBaudRate(): number { return this._config.baudRate; }
  get config(): SerialConfig { return { ...this._config }; }
  get rxBytes(): number { return this._rxBytes; }
  get txBytes(): number { return this._txBytes; }

  async listPorts(): Promise<PortInfo[]> {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer,
      productId: p.productId,
      vendorId: p.vendorId,
      serialNumber: p.serialNumber,
    }));
  }

  async connect(config: SerialConfig): Promise<boolean> {
    if (this._port?.isOpen) { await this.disconnect(); }
    this._config = { ...config };

    return new Promise<boolean>((resolve) => {
      try {
        this._port = new SerialPort({
          path: config.port,
          baudRate: config.baudRate,
          dataBits: config.dataBits,
          stopBits: config.stopBits,
          parity: config.parity,
          autoOpen: false,
        });

        this._port.on('data', (chunk: Buffer) => {
          this._rxBytes += chunk.length;
          this._processData(chunk);
        });

        this._port.on('error', (err: Error) => {
          console.error(`[Serial Error] ${err.message}`);
        });

        this._port.open((err) => {
          if (err) {
            console.error(`[Serial] Open failed: ${err.message}`);
            this._port = null;
            resolve(false);
          } else {
            console.log(`[Serial] Connected to ${config.port} @ ${config.baudRate}`);
            resolve(true);
          }
        });
      } catch (err: unknown) {
        console.error(`[Serial] Connect error: ${err}`);
        resolve(false);
      }
    });
  }

  async disconnect(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this._port?.isOpen) {
        this._port.close(() => {
          this._port = null;
          console.log('[Serial] Disconnected');
          resolve();
        });
      } else {
        this._port = null;
        resolve();
      }
    });
  }

  async send(data: string, hexMode: boolean, lineEnding: string): Promise<boolean> {
    if (!this._port?.isOpen) { return false; }

    let buf: Buffer;
    if (hexMode) {
      const hexStr = data.replace(/\s+/g, '');
      if (!hexStr.length || !/^[0-9a-fA-F]*$/.test(hexStr) || hexStr.length % 2 !== 0) {
        return false;
      }
      buf = Buffer.from(hexStr, 'hex');
    } else {
      const suffixes: Record<string, string> = { lf: '\n', crlf: '\r\n', cr: '\r', none: '' };
      buf = Buffer.from(data + (suffixes[lineEnding] ?? '\n'), 'utf8');
    }

    return new Promise<boolean>((resolve) => {
      this._port!.write(buf, (err) => {
        if (err) { resolve(false); return; }
        this._txBytes += buf.length;
        resolve(true);
      });
    });
  }

  getLogBuffer(): string[] { return [...this._logBuffer]; }

  clearLog(): void {
    this._logBuffer = [];
    this._rxBuffer = Buffer.alloc(0);
  }

  resetCounters(): void {
    this._rxBytes = 0;
    this._txBytes = 0;
  }

  injectLog(line: string): void {
    this._logBuffer.push(line);
    if (this._logBuffer.length > 5000) { this._logBuffer.shift(); }
    console.log(`[INJ] ${line}`);
    for (const cb of this._newLogSubscribers) { cb(line); }
  }

  onNewLog(callback: (line: string) => void): void {
    this._newLogSubscribers.push(callback);
  }

  offNewLog(callback: (line: string) => void): void {
    const idx = this._newLogSubscribers.indexOf(callback);
    if (idx !== -1) { this._newLogSubscribers.splice(idx, 1); }
  }

  /** 按行分割串口数据，推入 logBuffer 并通知订阅者 */
  private _processData(chunk: Buffer): void {
    this._rxBuffer = Buffer.concat([this._rxBuffer, chunk]);
    let idx: number;
    while ((idx = this._rxBuffer.indexOf(0x0A)) !== -1) {
      const lineBytes = this._rxBuffer.subarray(0, idx);
      this._rxBuffer = this._rxBuffer.subarray(idx + 1);
      let text = lineBytes.toString('utf8');
      if (text.endsWith('\r')) { text = text.slice(0, -1); }

      this._logBuffer.push(text);
      if (this._logBuffer.length > 5000) { this._logBuffer.shift(); }

      // 控制台实时显示
      console.log(`[RX] ${text}`);

      // 通知订阅者（wait_for_output 用）
      for (const cb of this._newLogSubscribers) { cb(text); }
    }
  }
}

// ============================================================
// 启动
// ============================================================

class ConsoleLogger implements ILogger {
  appendLine(value: string): void { console.log(value); }
}

async function main() {
  const sm = new RealSerialManager();
  const logger = new ConsoleLogger();
  const bridge = new BridgeServer(sm, logger);

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
