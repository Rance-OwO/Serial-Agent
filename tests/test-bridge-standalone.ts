/**
 * Bridge Server 独立测试脚本
 *
 * 用于 S1.19 Windsurf 联调：启动一个带 MockSerialManager 的 BridgeServer，
 * 写入 bridge.json，使 Windsurf 中的 MCP Tool 可以真正调通。
 *
 * 使用方式：npx tsx tests/test-bridge-standalone.ts
 * 按 Ctrl+C 停止
 */

import { BridgeServer } from '../packages/serialagent-vscode/src/bridge-server';
import { MockSerialManager } from './mocks/mock-serial-manager';
import { ILogger } from '../packages/serialagent-vscode/src/types';

class ConsoleLogger implements ILogger {
  appendLine(value: string): void {
    console.log(value);
  }
}

async function main() {
  const mock = new MockSerialManager();
  const logger = new ConsoleLogger();
  const bridge = new BridgeServer(mock, logger);

  // 注入模拟串口设备
  mock.setMockPorts([
    { path: 'COM3', manufacturer: 'Silicon Labs', vendorId: '10C4', productId: 'EA60' },
    { path: 'COM5', manufacturer: 'FTDI', vendorId: '0403', productId: '6001' },
  ]);

  // 预填充一些模拟日志
  mock.simulateLogs([
    '[Boot] ESP32-S3 starting...',
    '[Boot] CPU freq: 240MHz',
    '[Boot] Flash: 16MB',
    '[WiFi] Connecting to AP...',
    '[WiFi] Connected, IP: 192.168.1.100',
    '[App] FreeRTOS tasks initialized',
    '[App] System Ready',
  ]);

  await bridge.start();

  console.log('');
  console.log('=== Serial Agent Bridge Server (Standalone Test) ===');
  console.log(`Port:  127.0.0.1:${bridge.port}`);
  console.log(`Token: ${bridge.token}`);
  console.log('');
  console.log('Mock ports: COM3 (Silicon Labs), COM5 (FTDI)');
  console.log('Mock log: 7 lines pre-loaded');
  console.log('');
  console.log('Press Ctrl+C to stop.');
  console.log('');

  // 优雅退出
  const cleanup = async () => {
    console.log('\nShutting down...');
    await bridge.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // 每 3 秒模拟新日志输出
  setInterval(() => {
    const ts = new Date().toISOString().split('T')[1].slice(0, 12);
    mock.simulateLog(`[Sensor] temp=25.${Math.floor(Math.random() * 100)} humidity=${50 + Math.floor(Math.random() * 30)} @ ${ts}`);
  }, 3000);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
