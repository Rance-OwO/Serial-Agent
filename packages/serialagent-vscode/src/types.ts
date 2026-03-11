/**
 * Serial Agent 共享类型定义
 *
 * 被 extension.ts、bridge-server.ts、测试桩共用。
 * 抽取为独立模块以支持 BridgeServer 单元测试（无需依赖 vscode）。
 */

/** 串口设备信息 */
export interface PortInfo {
  path: string;
  manufacturer?: string;
  productId?: string;
  vendorId?: string;
  serialNumber?: string;
}

/** 串口完整配置（连接参数 + 显示选项） */
export interface SerialConfig {
  port: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space';
  stopBits: 1 | 1.5 | 2;
  lineEnding: 'none' | 'lf' | 'crlf' | 'cr';
  showTimestamp: boolean;
  hexMode: boolean;
}

export const DEFAULT_CONFIG: SerialConfig = {
  port: '',
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  lineEnding: 'none',
  showTimestamp: false,
  hexMode: false,
};

/**
 * SerialManager 接口 — BridgeServer 所需的串口操作抽象
 *
 * 真实 SerialManager 和 MockSerialManager 均实现此接口，
 * 使 BridgeServer 可在测试中使用 Mock 替代。
 */
export interface ISerialManager {
  readonly isConnected: boolean;
  readonly isReconnecting: boolean;
  readonly currentPath: string;
  readonly currentBaudRate: number;
  readonly rxBytes: number;
  readonly txBytes: number;
  readonly config: SerialConfig;

  listPorts(): Promise<PortInfo[]>;
  connect(config: SerialConfig): Promise<boolean>;
  disconnect(): Promise<void>;
  send(data: string, hexMode: boolean, lineEnding: string): Promise<boolean>;
  getLogBuffer(): string[];
  clearLog(): void;
  resetCounters(): void;

  /** 注入一行日志到缓冲区（用于 Bridge API Echo 等场景） */
  injectLog(line: string): void;

  /** 订阅新日志行（增量监听，用于 wait_for_output） */
  onNewLog(callback: (line: string) => void): void;
  /** 取消订阅新日志行 */
  offNewLog(callback: (line: string) => void): void;
}

/**
 * 日志输出接口 — 抽象 vscode.OutputChannel
 *
 * 在 VS Code 中使用 OutputChannel 实现，
 * 在测试中使用简单的 console 或 noop 实现。
 */
export interface ILogger {
  appendLine(value: string): void;
}

/** Keil 配置检查项 */
export interface KeilConfigCheckItem {
  key: string;
  ok: boolean;
  message: string;
  value?: string;
}

/** Keil 配置检查结果 */
export interface KeilConfigCheckResult {
  ready: boolean;
  checks: KeilConfigCheckItem[];
  projectFile?: string;
  target?: string;
}

/** Keil/JLink 执行结果（build/flash/buildAndFlash） */
export interface KeilTaskResult {
  success: boolean;
  projectFile: string;
  artifactPath?: string;
  target?: string;
}

/** BridgeServer 调用的 Keil API 抽象 */
export interface IKeilApi {
  isBusy(): boolean;
  checkConfig(): Promise<KeilConfigCheckResult>;
  build(): Promise<KeilTaskResult>;
  flash(artifactPath?: string): Promise<KeilTaskResult>;
  buildAndFlash(): Promise<KeilTaskResult>;
}
