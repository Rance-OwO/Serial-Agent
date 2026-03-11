/**
 * Mock SerialManager — 模拟串口管理器的基本行为
 *
 * 用于 Bridge Server API 单元测试，替代真实的 SerialManager（无需真实串口硬件）。
 * 接口与 serialagent-vscode/src/extension.ts 中的 SerialManager 保持一致。
 *
 * 使用方式：
 *   const mock = new MockSerialManager();
 *   mock.simulateLog('System Ready');        // 模拟设备输出
 *   mock.getLogBuffer();                     // => ['System Ready']
 *
 * 对应 Plan.md S0.05
 */

// 共享类型从 packages/serialagent-vscode/src/types.ts 导入
import { PortInfo, SerialConfig, DEFAULT_CONFIG, ISerialManager } from '../../packages/serialagent-vscode/src/types';

// 重新导出以保持向后兼容（已有测试文件可能从此处导入）
export { PortInfo, SerialConfig, DEFAULT_CONFIG, ISerialManager };

/**
 * MockSerialManager
 *
 * 模拟 SerialManager 的核心行为：
 * - 列出串口（可注入模拟串口列表）
 * - 连接/断开（状态切换，不涉及真实串口）
 * - 日志缓冲区（支持模拟设备输出）
 * - 发送数据（记录发送历史）
 * - RX/TX 计数器
 * - 新日志订阅（为 Sprint 2 的 wait_for_output 预留）
 */
export class MockSerialManager implements ISerialManager {
  private _connected = false;
  private _config: SerialConfig = { ...DEFAULT_CONFIG };
  private _logBuffer: string[] = [];
  private _rxBytes = 0;
  private _txBytes = 0;
  private _reconnecting = false;
  private _sendHistory: Array<{ data: string; hexMode: boolean; lineEnding: string }> = [];

  /** 可注入的模拟串口列表 */
  private _mockPorts: PortInfo[] = [];

  /** 新日志订阅回调列表（为 wait_for_output 预留） */
  private _newLogSubscribers: Array<(line: string) => void> = [];

  /** 模拟连接失败的端口集合 */
  private _failPorts: Set<string> = new Set();

  /** 自动响应配置：当 send() 发送的数据匹配 key 时，延迟输出对应响应（用于测试 send_and_wait） */
  private _autoResponses: Map<string, { response: string; delayMs: number }> = new Map();

  /** 跟踪进行中的自动响应定时器，reset() 时取消防止测试泄漏 */
  private _pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  // ============================================================
  // 测试辅助方法（仅 Mock 使用，真实 SerialManager 无此方法）
  // ============================================================

  /** 注入模拟串口列表 */
  setMockPorts(ports: PortInfo[]): void {
    this._mockPorts = [...ports];
  }

  /** 设置某个端口为"连接失败"（模拟串口被占用等场景） */
  setPortFail(portPath: string): void {
    this._failPorts.add(portPath);
  }

  /** 清除端口失败设置 */
  clearPortFail(portPath: string): void {
    this._failPorts.delete(portPath);
  }

  /** 模拟设备输出一行日志 */
  simulateLog(text: string): void {
    this._logBuffer.push(text);
    this._rxBytes += Buffer.byteLength(text, 'utf8');
    // 通知所有订阅者
    for (const cb of this._newLogSubscribers) {
      cb(text);
    }
  }

  /** 模拟设备输出多行日志 */
  simulateLogs(lines: string[]): void {
    for (const line of lines) {
      this.simulateLog(line);
    }
  }

  /** 获取发送历史（用于验证 send 调用） */
  getSendHistory(): Array<{ data: string; hexMode: boolean; lineEnding: string }> {
    return [...this._sendHistory];
  }

  /**
   * 配置自动响应：当 send() 发送指定数据时，延迟模拟设备输出
   * 用于测试 send_and_wait 的原子性行为
   */
  setAutoResponse(sendData: string, response: string, delayMs = 10): void {
    this._autoResponses.set(sendData, { response, delayMs });
  }

  /** 清除所有自动响应配置 */
  clearAutoResponses(): void {
    this._autoResponses.clear();
  }

  /** 重置所有 Mock 状态 */
  reset(): void {
    this._connected = false;
    this._config = { ...DEFAULT_CONFIG };
    this._logBuffer = [];
    this._rxBytes = 0;
    this._txBytes = 0;
    this._reconnecting = false;
    this._sendHistory = [];
    this._mockPorts = [];
    this._newLogSubscribers = [];
    this._failPorts.clear();
    this._autoResponses.clear();
    for (const t of this._pendingTimers) { clearTimeout(t); }
    this._pendingTimers.clear();
  }

  // ============================================================
  // 与真实 SerialManager 对齐的公开接口
  // ============================================================

  /** 列出可用串口 */
  async listPorts(): Promise<PortInfo[]> {
    return [...this._mockPorts];
  }

  /** 连接串口 */
  async connect(config: SerialConfig): Promise<boolean> {
    if (this._connected) {
      await this.disconnect();
    }

    if (!config.port) {
      return false;
    }

    // 模拟连接失败
    if (this._failPorts.has(config.port)) {
      return false;
    }

    // 检查端口是否在模拟列表中
    const portExists = this._mockPorts.some(p => p.path === config.port);
    if (!portExists && this._mockPorts.length > 0) {
      return false;
    }

    this._config = { ...config };
    this._connected = true;
    return true;
  }

  /** 断开串口 */
  async disconnect(): Promise<void> {
    this._connected = false;
    this._reconnecting = false;
  }

  /** 发送数据 */
  async send(data: string, hexMode: boolean, lineEnding: string): Promise<boolean> {
    if (!this._connected) {
      return false;
    }

    // HEX 模式校验
    if (hexMode) {
      const hexStr = data.replace(/\s+/g, '');
      if (!hexStr.length || !/^[0-9a-fA-F]*$/.test(hexStr) || hexStr.length % 2 !== 0) {
        return false;
      }
      this._txBytes += hexStr.length / 2;
    } else {
      const suffixes: Record<string, string> = { lf: '\n', crlf: '\r\n', cr: '\r', none: '' };
      this._txBytes += Buffer.byteLength(data + (suffixes[lineEnding] ?? '\n'), 'utf8');
    }

    this._sendHistory.push({ data, hexMode, lineEnding });

    // 自动响应：模拟设备在收到特定数据后延迟输出响应
    const autoResp = this._autoResponses.get(data);
    if (autoResp) {
      const timer = setTimeout(() => {
        this._pendingTimers.delete(timer);
        this.simulateLog(autoResp.response);
      }, autoResp.delayMs);
      this._pendingTimers.add(timer);
    }

    return true;
  }

  /** 更新显示设置 */
  updateSettings(partial: Partial<SerialConfig>): void {
    Object.assign(this._config, partial);
  }

  // ---- 只读属性 ----
  get isConnected(): boolean { return this._connected; }
  get isReconnecting(): boolean { return this._reconnecting; }
  get currentPath(): string { return this._config.port; }
  get currentBaudRate(): number { return this._config.baudRate; }
  get config(): SerialConfig { return { ...this._config }; }
  get rxBytes(): number { return this._rxBytes; }
  get txBytes(): number { return this._txBytes; }

  getLogBuffer(): string[] { return [...this._logBuffer]; }

  clearLog(): void {
    this._logBuffer = [];
  }

  resetCounters(): void {
    this._rxBytes = 0;
    this._txBytes = 0;
  }

  // ============================================================
  // 新日志订阅（为 Sprint 2 wait_for_output 预留）
  // ============================================================

  /** 注入一行日志到缓冲区并通知订阅者 */
  injectLog(line: string): void {
    this._logBuffer.push(line);
    if (this._logBuffer.length > 5000) { this._logBuffer.shift(); }
    for (const cb of this._newLogSubscribers) { cb(line); }
  }

  /** 订阅新日志行 */
  onNewLog(callback: (line: string) => void): void {
    this._newLogSubscribers.push(callback);
  }

  /** 取消订阅 */
  offNewLog(callback: (line: string) => void): void {
    const idx = this._newLogSubscribers.indexOf(callback);
    if (idx !== -1) {
      this._newLogSubscribers.splice(idx, 1);
    }
  }
}
