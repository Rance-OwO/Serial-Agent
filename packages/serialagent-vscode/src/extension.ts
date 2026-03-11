/**
 * Serial Agent VS Code 扩展入口
 *
 * 职责：
 * - 注册侧边栏 Webview（Serial Monitor 面板）
 * - 注册命令（刷新串口列表等）
 * - 直接使用 serialport 库进行串口操作
 * - 将串口日志实时推送到 Webview 显示
 *
 * 参考：
 * - COMTool/conn/conn_serial.py 的串口连接/检测/数据接收流程
 * - vscode-extension-samples/webview-view-sample 的 Webview 实现
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { PortInfo, SerialConfig, DEFAULT_CONFIG, ISerialManager } from './types';
import { BridgeServer } from './bridge-server';
import { KeilToolchainService } from './keil-toolchain';

// serialport 含原生 .node 二进制，使用懒加载：
// 即使原生模块加载失败，activate() 也能成功运行，只有串口操作才会报错
type SerialPortClass = import('serialport').SerialPort;
type SerialPortStatic = typeof import('serialport').SerialPort;

let _SerialPort: SerialPortStatic | null = null;
let _serialportError: string | null = null;

/** 懒加载 serialport（防御式，失败时返回 null 并记录错误） */
function requireSerialPort(): SerialPortStatic | null {
  if (_SerialPort) { return _SerialPort; }
  if (_serialportError) { return null; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sp = require('serialport') as { SerialPort: SerialPortStatic };
    _SerialPort = sp.SerialPort;
    return _SerialPort;
  } catch (e: unknown) {
    _serialportError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

// ============================================================
// 常量与类型
// ============================================================

/** 默认波特率列表（参考 COMTool parameters.defaultBaudrates） */
const DEFAULT_BAUDRATES = [
  9600, 19200, 38400, 57600, 74880,
  115200, 230400, 460800, 921600,
  1000000, 1500000, 2000000, 4500000,
];

const MAX_LOG_LINES = 5000;
const MAX_RX_BUFFER = 1024 * 1024; // 1MB — 防止无换行数据导致内存溢出
const RECONNECT_INTERVAL_MS = 2000;
const MAX_SEND_HISTORY = 20;

// PortInfo, SerialConfig, DEFAULT_CONFIG 已从 ./types 导入

/**
 * 串口管理器
 *
 * 使用原始 data 事件（非 ReadlineParser），支持：
 * - 文本/HEX 双模式接收
 * - 可选时间戳
 * - 自动重连（设备拔出后重插自动恢复）
 * - RX/TX 字节计数
 * - 完整串口参数（dataBits, parity, stopBits）
 */
class SerialManager implements ISerialManager {
  private _port: SerialPortClass | null = null;
  private _logBuffer: string[] = [];
  private _rxBuffer: Buffer = Buffer.alloc(0);
  private _config: SerialConfig = { ...DEFAULT_CONFIG };

  // 字节计数
  private _rxBytes = 0;
  private _txBytes = 0;

  // 回调
  private _onLog: ((text: string) => void) | null = null;
  private _onStatus: ((connected: boolean, portPath?: string, baudRate?: number) => void) | null = null;
  private _onError: ((msg: string) => void) | null = null;
  private _onCounterUpdate: ((rx: number, tx: number) => void) | null = null;

  // 自动重连（参考 COMTool waitingReconnect 模式）
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _autoReconnect = false;
  private _reconnecting = false;
  private _lastConfig: SerialConfig | null = null;

  // 新日志订阅（S2.01: 供 wait_for_output 增量监听）
  private _newLogSubscribers: Array<(line: string) => void> = [];

  /** 设置回调 */
  setCallbacks(opts: {
    onLog: (text: string) => void;
    onStatus: (connected: boolean, portPath?: string, baudRate?: number) => void;
    onError: (msg: string) => void;
    onCounterUpdate?: (rx: number, tx: number) => void;
  }) {
    this._onLog = opts.onLog;
    this._onStatus = opts.onStatus;
    this._onError = opts.onError;
    this._onCounterUpdate = opts.onCounterUpdate ?? null;
  }

  /** 列出可用串口 */
  async listPorts(): Promise<PortInfo[]> {
    const SP = requireSerialPort();
    if (!SP) { throw new Error(`serialport native module load failed: ${_serialportError}\nPlease check extension is properly installed (with prebuilt binaries)`); }
    const ports = await SP.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      productId: p.productId,
      vendorId: p.vendorId,
      serialNumber: p.serialNumber,
    }));
  }

  /** 连接串口（使用完整配置） */
  async connect(config: SerialConfig): Promise<boolean> {
    this._stopReconnect();
    if (this._port?.isOpen) { await this.disconnect(); }

    this._config = { ...config };
    this._lastConfig = { ...config };

    return new Promise<boolean>((resolve) => {
      try {
        const SP = requireSerialPort();
        if (!SP) {
          this._onError?.(`serialport native module load failed: ${_serialportError}`);
          this._onStatus?.(false);
          resolve(false);
          return;
        }

        this._port = new SP({
          path: config.port,
          baudRate: config.baudRate,
          dataBits: config.dataBits,
          stopBits: config.stopBits,
          parity: config.parity,
          autoOpen: false,
        });

        // 原始 data 事件 → 支持文本/HEX 双模式
        this._port.on('data', (chunk: Buffer) => {
          this._rxBytes += chunk.length;
          this._onCounterUpdate?.(this._rxBytes, this._txBytes);
          this._processReceivedData(chunk);
        });

        this._port.on('error', (err: Error) => {
          this._onError?.(err.message);
        });

        // 意外断开（设备拔出等）→ 启动自动重连
        this._port.on('close', () => {
          const wasAutoReconnect = this._autoReconnect;
          this._cleanupPort();
          this._onStatus?.(false);
          if (wasAutoReconnect && this._lastConfig) {
            this._startReconnect();
          }
        });

        this._port.open((err) => {
          if (err) {
            this._onError?.(`Open failed: ${err.message}`);
            this._cleanupPort();
            this._onStatus?.(false);
            resolve(false);
          } else {
            this._autoReconnect = true;
            this._onStatus?.(true, config.port, config.baudRate);
            resolve(true);
          }
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this._onError?.(`Connect error: ${msg}`);
        this._cleanupPort();
        this._onStatus?.(false);
        resolve(false);
      }
    });
  }

  /** 主动断开串口（不触发自动重连） */
  async disconnect(): Promise<void> {
    this._autoReconnect = false;
    this._stopReconnect();
    return new Promise<void>((resolve) => {
      if (this._port?.isOpen) {
        this._port.removeAllListeners('close');
        this._port.close(() => {
          this._cleanupPort();
          this._onStatus?.(false);
          resolve();
        });
      } else {
        this._cleanupPort();
        this._onStatus?.(false);
        resolve();
      }
    });
  }

  /** 发送数据（支持 HEX 模式和换行符选择） */
  async send(data: string, hexMode: boolean, lineEnding: string): Promise<boolean> {
    if (!this._port?.isOpen) { return false; }

    let buf: Buffer;
    if (hexMode) {
      // HEX 模式：将 "41 42 0D 0A" 解析为 Buffer
      const hexStr = data.replace(/\s+/g, '');
      if (!hexStr.length || !/^[0-9a-fA-F]*$/.test(hexStr) || hexStr.length % 2 !== 0) {
        this._onError?.('Invalid HEX format (e.g. "41 42 0D 0A")');
        return false;
      }
      buf = Buffer.from(hexStr, 'hex');
    } else {
      // 文本模式：校验非空内容
      const trimmed = data.replace(/\r?\n/g, '');
      if (!trimmed.length) { return false; }
      // 追加换行符
      const suffixes: Record<string, string> = { lf: '\n', crlf: '\r\n', cr: '\r', none: '' };
      buf = Buffer.from(data + (suffixes[lineEnding] ?? '\n'), 'utf8');
    }

    return new Promise<boolean>((resolve) => {
      this._port!.write(buf, (err) => {
        if (err) { this._onError?.(err.message); resolve(false); return; }
        this._txBytes += buf.length;
        this._onCounterUpdate?.(this._rxBytes, this._txBytes);
        resolve(true);
      });
    });
  }

  /** 运行时更新显示设置（不重连） */
  updateSettings(partial: Partial<SerialConfig>): void {
    // 切换到 HEX 模式时，刷出文本模式残留的 rxBuffer
    if (partial.hexMode === true && !this._config.hexMode && this._rxBuffer.length > 0) {
      const remaining = this._rxBuffer.toString('utf8');
      if (remaining.length > 0) {
        this._logBuffer.push(remaining);
        this._onLog?.(remaining + '\n');
      }
      this._rxBuffer = Buffer.alloc(0);
    }
    Object.assign(this._config, partial);
  }

  // ---- 只读属性 ----
  get isConnected(): boolean { return this._port !== null && this._port.isOpen; }
  get isReconnecting(): boolean { return this._reconnectTimer !== null || this._reconnecting; }
  get currentPath(): string { return this._config.port; }
  get currentBaudRate(): number { return this._config.baudRate; }
  get config(): SerialConfig { return { ...this._config }; }
  get rxBytes(): number { return this._rxBytes; }
  get txBytes(): number { return this._txBytes; }

  getLogBuffer(): string[] { return [...this._logBuffer]; }
  clearLog(): void { this._logBuffer = []; }

  resetCounters(): void {
    this._rxBytes = 0;
    this._txBytes = 0;
    this._onCounterUpdate?.(0, 0);
  }

  /** 注入一行日志到缓冲区并通知 Webview + 订阅者 */
  injectLog(line: string): void {
    this._appendLogLine(line);
  }

  /** 将一行日志写入缓冲区并通知所有监听者（injectLog 和 _processReceivedData 共用） */
  private _appendLogLine(line: string): void {
    this._logBuffer.push(line);
    if (this._logBuffer.length > MAX_LOG_LINES) { this._logBuffer.shift(); }
    this._onLog?.(line + '\n');
    for (const cb of this._newLogSubscribers) { cb(line); }
  }

  /** 订阅新日志行（S2.01: 增量监听，用于 wait_for_output） */
  onNewLog(callback: (line: string) => void): void {
    this._newLogSubscribers.push(callback);
  }

  /** 取消订阅新日志行 */
  offNewLog(callback: (line: string) => void): void {
    const idx = this._newLogSubscribers.indexOf(callback);
    if (idx !== -1) { this._newLogSubscribers.splice(idx, 1); }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /** 处理接收到的原始字节 */
  private _processReceivedData(chunk: Buffer): void {
    if (this._config.hexMode) {
      // HEX 模式：每个数据块输出一行，写入 logBuffer
      const hex = Array.from(chunk)
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');

      let line = hex;
      if (this._config.showTimestamp) {
        const now = new Date();
        const ts = `[${now.toTimeString().split(' ')[0]}.${String(now.getMilliseconds()).padStart(3, '0')}]`;
        line = `${ts} ${hex}`;
      }
      this._appendLogLine(line);
    } else {
      // 文本模式：按换行分割，逐行输出
      this._rxBuffer = Buffer.concat([this._rxBuffer, chunk]);

      // 防止无换行数据导致 rxBuffer 无限增长（如二进制固件误输出）
      if (this._rxBuffer.length > MAX_RX_BUFFER) {
        const overflow = this._rxBuffer.toString('utf8');
        this._appendLogLine(`[WARN] RX buffer overflow (${MAX_RX_BUFFER} bytes), force flushing`);
        this._appendLogLine(overflow);
        this._rxBuffer = Buffer.alloc(0);
      }

      let idx: number;
      while ((idx = this._rxBuffer.indexOf(0x0A)) !== -1) {
        const lineBytes = this._rxBuffer.subarray(0, idx);
        this._rxBuffer = this._rxBuffer.subarray(idx + 1);

        let text = lineBytes.toString('utf8');
        if (text.endsWith('\r')) { text = text.slice(0, -1); }

        // 可选时间戳
        if (this._config.showTimestamp) {
          const now = new Date();
          const ts = `[${now.toTimeString().split(' ')[0]}.${String(now.getMilliseconds()).padStart(3, '0')}]`;
          text = `${ts} ${text}`;
        }

        this._appendLogLine(text);
      }
    }
  }

  /** 清理端口资源（不触发状态回调） */
  private _cleanupPort(): void {
    if (this._port) { this._port.removeAllListeners(); this._port = null; }
    this._rxBuffer = Buffer.alloc(0);
  }

  /** 启动自动重连（递归 setTimeout，保证串行执行，消除竞态） */
  private _startReconnect(): void {
    if (this._reconnectTimer || this._reconnecting) { return; }
    this._onError?.('Connection lost, attempting to reconnect...');
    this._scheduleReconnect();
  }

  /** 调度下一次重连尝试 */
  private _scheduleReconnect(): void {
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (!this._autoReconnect || !this._lastConfig) { return; }
      this._reconnecting = true;
      try {
        const ports = await this.listPorts();
        if (ports.some(p => p.path === this._lastConfig!.port)) {
          const ok = await this.connect(this._lastConfig!);
          if (ok) {
            this._onLog?.('[Serial Agent] Reconnected successfully\n');
            this._reconnecting = false;
            return;
          }
        }
      } catch { /* 扫描失败，继续重试 */ }
      this._reconnecting = false;
      // 仍需重连则调度下一次
      if (this._autoReconnect && this._lastConfig) {
        this._scheduleReconnect();
      }
    }, RECONNECT_INTERVAL_MS);
  }

  /** 停止自动重连 */
  private _stopReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnecting = false;
  }
}

// ============================================================
// 全局实例
// ============================================================
const serialManager = new SerialManager();
const bridgeOutputChannel = vscode.window.createOutputChannel('Serial Agent Bridge');
const keilOutputChannel = vscode.window.createOutputChannel('Serial Agent Build');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _extensionPkgVersion: string = (require('../package.json') as { version: string }).version;
const bridgeServer = new BridgeServer(serialManager, bridgeOutputChannel, false, _extensionPkgVersion);
const keilToolchain = new KeilToolchainService(keilOutputChannel);
let statusBarItem: vscode.StatusBarItem;
let bridgeStatusBarItem: vscode.StatusBarItem;
let bridgeRunning = false;
let keilTaskRunning = false;

/** 更新 Bridge Server 状态栏指示灯 */
function updateBridgeStatusBar(): void {
  if (bridgeRunning) {
    bridgeStatusBarItem.text = '$(broadcast) SA Bridge Ready';
    bridgeStatusBarItem.tooltip = `Serial Agent Bridge: Running on port ${bridgeServer.port} (click to stop)`;
    bridgeStatusBarItem.backgroundColor = undefined;
    bridgeStatusBarItem.color = new vscode.ThemeColor('testing.iconPassed');
  } else {
    bridgeStatusBarItem.text = '$(circle-slash) SA Bridge Off';
    bridgeStatusBarItem.tooltip = 'Serial Agent Bridge: Stopped (click to start)';
    bridgeStatusBarItem.backgroundColor = undefined;
    bridgeStatusBarItem.color = undefined;
  }
}

/** 更新 VS Code 底部状态栏 */
function updateStatusBar(connected: boolean, port?: string, baudRate?: number): void {
  if (connected && port) {
    statusBarItem.text = `$(plug) ${port} @ ${baudRate}`;
    statusBarItem.tooltip = 'Serial Agent: Connected (click to disconnect)';
    statusBarItem.backgroundColor = undefined;
  } else if (serialManager.isReconnecting) {
    statusBarItem.text = '$(sync~spin) Reconnecting...';
    statusBarItem.tooltip = 'Serial Agent: Attempting to reconnect';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.text = '$(debug-disconnect) Serial';
    statusBarItem.tooltip = 'Serial Agent: Disconnected (click to open panel)';
    statusBarItem.backgroundColor = undefined;
  }
}

// ============================================================
// 扩展激活入口
// ============================================================

export function activate(context: vscode.ExtensionContext) {
  // Bridge Server 状态栏指示灯（最左侧，优先级最高）
  bridgeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  bridgeStatusBarItem.command = 'serialagent.toggleBridge';
  updateBridgeStatusBar();
  bridgeStatusBarItem.show();
  context.subscriptions.push(bridgeStatusBarItem);

  // 串口连接状态栏
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'serialagent.toggleConnection';
  updateStatusBar(false);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(bridgeOutputChannel);
  context.subscriptions.push(keilOutputChannel);

  const runKeilTask = async (taskName: string, runner: () => Promise<void>): Promise<void> => {
    if (keilTaskRunning) {
      vscode.window.showWarningMessage('[Serial Agent] Build/Flash task is running, please wait...');
      return;
    }

    keilTaskRunning = true;
    provider.postMessage({ type: 'keilBusy', busy: true, task: taskName });
    keilOutputChannel.show(true);
    keilOutputChannel.appendLine(`[Serial Agent] ${taskName} started at ${new Date().toLocaleString()}`);

    try {
      await runner();
      keilOutputChannel.appendLine(`[Serial Agent] ${taskName} finished successfully.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      keilOutputChannel.appendLine(`[Serial Agent] ${taskName} failed: ${msg}`);
      vscode.window.showErrorMessage(`[Serial Agent] ${taskName} failed: ${msg}`);
    } finally {
      keilTaskRunning = false;
      provider.postMessage({ type: 'keilBusy', busy: false, task: taskName });
    }
  };

  // Webview Provider（传递完整 context 以支持 globalState 持久化）
  const provider = new SerialPanelProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SerialPanelProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Bridge Server 启动（S1.01）
  bridgeServer.setOnUiClear(() => {
    provider.postMessage({ type: 'clearLog' });
  });
  bridgeServer.start().then(() => {
    bridgeRunning = true;
    updateBridgeStatusBar();
    bridgeOutputChannel.appendLine(`[Serial Agent Bridge] Token: ${bridgeServer.token}`);
  }).catch((err) => {
    bridgeRunning = false;
    updateBridgeStatusBar();
    bridgeOutputChannel.appendLine(`[Serial Agent Bridge] Start failed: ${err}`);
    vscode.window.showWarningMessage('[Serial Agent] Bridge Server failed to start. MCP integration unavailable.');
  });

  // ---- 命令注册 ----

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.refreshPorts', async () => {
      try {
        const ports = await serialManager.listPorts();
        provider.postMessage({ type: 'updatePorts', ports });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`[Serial Agent] Scan failed: ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.toggleConnection', () => {
      if (serialManager.isConnected) {
        vscode.commands.executeCommand('serialagent.disconnect');
      } else {
        vscode.commands.executeCommand('serialagent.serialPanel.focus');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.disconnect', async () => {
      await serialManager.disconnect();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.clearLog', () => {
      serialManager.clearLog();
      serialManager.resetCounters();
      provider.postMessage({ type: 'clearLog' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.openSettings', () => {
      keilToolchain.openSettings();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.selectJlinkDevice', async () => {
      try {
        await keilToolchain.selectJLinkDeviceFromProject();
        vscode.window.showInformationMessage('[Serial Agent] JLink CPU Name updated from Keil target.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`[Serial Agent] Select JLink CPU Name failed: ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.build', async () => {
      await runKeilTask('Keil Build', async () => {
        const result = await keilToolchain.build();
        vscode.window.showInformationMessage(`[Serial Agent] Build OK: ${result.artifactPath}`);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.flash', async () => {
      await runKeilTask('JLink Flash', async () => {
        const result = await keilToolchain.flash();
        vscode.window.showInformationMessage(`[Serial Agent] Flash OK: ${result.artifactPath}`);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.buildAndFlash', async () => {
      await runKeilTask('Build + Flash', async () => {
        const result = await keilToolchain.buildAndFlash();
        vscode.window.showInformationMessage(`[Serial Agent] Build+Flash OK: ${result.artifactPath}`);
      });
    })
  );

  // Bridge Server 开关命令
  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.toggleBridge', async () => {
      if (bridgeRunning) {
        await bridgeServer.stop();
        bridgeRunning = false;
        updateBridgeStatusBar();
        bridgeOutputChannel.appendLine('[Serial Agent Bridge] Stopped by user');
      } else {
        try {
          await bridgeServer.start();
          bridgeRunning = true;
          updateBridgeStatusBar();
          bridgeOutputChannel.appendLine(`[Serial Agent Bridge] Restarted, Token: ${bridgeServer.token}`);
        } catch (err: unknown) {
          bridgeRunning = false;
          updateBridgeStatusBar();
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`[Serial Agent] Bridge Server failed to start: ${msg}`);
        }
      }
    })
  );

  // 右上角按钮：在右侧标签页打开 Serial Agent
  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.openInTab', async () => {
      // 如果已有面板，直接显示
      if (provider.panel) {
        provider.panel.reveal(vscode.ViewColumn.Two);
        return;
      }

      // 获取当前可见编辑器的列数
      const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0;

      // 在右侧创建新编辑器组
      if (hasVisibleEditors) {
        await vscode.commands.executeCommand('workbench.action.newGroupRight');
      }

      // 创建 Webview 面板
      const panel = vscode.window.createWebviewPanel(
        SerialPanelProvider.panelViewType,
        'Serial Agent',
        hasVisibleEditors ? vscode.ViewColumn.Two : vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        }
      );

      // 设置图标
      panel.iconPath = {
        light: vscode.Uri.joinPath(context.extensionUri, 'media', 'SerialAgent.png'),
        dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'SerialAgent.png'),
      };

      // 解析面板（复用 Provider 的 HTML 和消息处理逻辑）
      provider.resolveWebviewPanel(panel);

      // 面板关闭时清理
      panel.onDidDispose(() => {
        provider.clearPanel();
      });
    })
  );
}

export async function deactivate(): Promise<void> {
  await bridgeServer.stop();
  await serialManager.disconnect();
}

// ============================================================
// 侧边栏 Webview Provider
// ============================================================

/**
 * Serial Monitor 侧边栏面板
 *
 * 功能：
 * - 串口选择 + 完整参数配置（baudRate / dataBits / parity / stopBits）
 * - 波特率支持手动输入（input + datalist）
 * - Open/Close + 自动重连状态
 * - 日志输出（文本 / HEX 双模式，可选时间戳）
 * - 发送区域（文本 / HEX，CRLF/LF 选择，发送历史）
 * - RX/TX 字节计数
 * - 配置持久化（globalState）
 */
class SerialPanelProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'serialagent.serialPanel';
  public static readonly panelViewType = 'serialagent.serialPanel.tab';
  private _view?: vscode.WebviewView;
  private _panel?: vscode.WebviewPanel; // 独立面板（右侧标签页）
  private readonly _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  /** 获取独立面板（用于外部检查） */
  get panel(): vscode.WebviewPanel | undefined {
    return this._panel;
  }

  // ---- 持久化 ----

  private _saveConfig(partial: Partial<SerialConfig>): void {
    const saved = this._context.globalState.get<SerialConfig>('serialConfig', { ...DEFAULT_CONFIG });
    this._context.globalState.update('serialConfig', { ...saved, ...partial });
  }
  private _loadConfig(): SerialConfig {
    return this._context.globalState.get<SerialConfig>('serialConfig', { ...DEFAULT_CONFIG });
  }
  private _saveSendHistory(history: string[]): void {
    this._context.globalState.update('sendHistory', history.slice(0, MAX_SEND_HISTORY));
  }
  private _loadSendHistory(): string[] {
    return this._context.globalState.get<string[]>('sendHistory', []);
  }

  // ---- Webview 生命周期 ----

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // 加载持久化配置，应用到 SerialManager 并发送给 Webview
    const savedConfig = this._loadConfig();
    serialManager.updateSettings(savedConfig);

    // 设置串口回调 → 推送到 Webview + 更新状态栏
    serialManager.setCallbacks({
      onLog: (text) => {
        this.postMessage({ type: 'appendLog', text });
      },
      onStatus: (connected, portPath, baudRate) => {
        this.postMessage({
          type: 'updateStatus',
          connected,
          port: portPath ?? '',
          baudRate: baudRate ?? 0,
        });
        updateStatusBar(connected, portPath, baudRate);
      },
      onError: (msg) => {
        vscode.window.showErrorMessage(`[Serial Agent] ${msg}`);
        this.postMessage({ type: 'appendLog', text: `[ERROR] ${msg}\n` });
      },
      onCounterUpdate: (rx, tx) => {
        this.postMessage({ type: 'updateCounters', rx, tx });
      },
    });

    // ---- 监听 Webview 消息（复用共享处理器）----
    this._setupWebviewMessageHandler(webviewView.webview);

    // ---- 初始化 ----

    // 自动扫描串口
    serialManager.listPorts().then((ports) => {
      this.postMessage({ type: 'updatePorts', ports });
    }).catch(() => { /* ignore */ });

    // 恢复持久化配置和发送历史到 Webview
    this.postMessage({
      type: 'restoreConfig',
      config: savedConfig,
      sendHistory: this._loadSendHistory(),
    });

    // Webview 重建场景：同步当前连接状态
    if (serialManager.isConnected) {
      this.postMessage({
        type: 'updateStatus',
        connected: true,
        port: serialManager.currentPath,
        baudRate: serialManager.currentBaudRate,
      });
      this.postMessage({
        type: 'updateCounters',
        rx: serialManager.rxBytes,
        tx: serialManager.txBytes,
      });
    }
  }

  public postMessage(message: Record<string, unknown>) {
    this._view?.webview.postMessage(message);
    this._panel?.webview.postMessage(message);
  }

  /** 清理独立面板引用 */
  public clearPanel(): void {
    this._panel = undefined;
  }

  /** 创建独立面板（用于右侧标签页） */
  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    this._panel = panel;

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    panel.webview.html = this._getHtmlForWebview(panel.webview);

    // 加载持久化配置
    const savedConfig = this._loadConfig();
    serialManager.updateSettings(savedConfig);

    // 设置回调
    serialManager.setCallbacks({
      onLog: (text) => {
        this.postMessage({ type: 'appendLog', text });
      },
      onStatus: (connected, portPath, baudRate) => {
        this.postMessage({
          type: 'updateStatus',
          connected,
          port: portPath ?? '',
          baudRate: baudRate ?? 0,
        });
        updateStatusBar(connected, portPath, baudRate);
      },
      onError: (msg) => {
        vscode.window.showErrorMessage(`[Serial Agent] ${msg}`);
        this.postMessage({ type: 'appendLog', text: `[ERROR] ${msg}\n` });
      },
      onCounterUpdate: (rx, tx) => {
        this.postMessage({ type: 'updateCounters', rx, tx });
      },
    });

    // 监听消息（复用侧边栏的消息处理逻辑）
    this._setupWebviewMessageHandler(panel.webview);

    // 初始化
    serialManager.listPorts().then((ports) => {
      this.postMessage({ type: 'updatePorts', ports });
    }).catch(() => { /* ignore */ });

    this.postMessage({
      type: 'restoreConfig',
      config: savedConfig,
      sendHistory: this._loadSendHistory(),
    });

    if (serialManager.isConnected) {
      this.postMessage({
        type: 'updateStatus',
        connected: true,
        port: serialManager.currentPath,
        baudRate: serialManager.currentBaudRate,
      });
      this.postMessage({
        type: 'updateCounters',
        rx: serialManager.rxBytes,
        tx: serialManager.txBytes,
      });
    }

    // 面板关闭时清理
    panel.onDidDispose(() => {
      this._panel = undefined;
    });
  }

  /** 设置 Webview 消息处理（供侧边栏和独立面板复用） */
  private _setupWebviewMessageHandler(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {

        case 'refreshPorts': {
          try {
            const ports = await serialManager.listPorts();
            this.postMessage({ type: 'updatePorts', ports });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`[Serial Agent] Scan failed: ${msg}`);
          }
          break;
        }

        case 'connect': {
          const { port, baudRate, dataBits, parity, stopBits } = data;
          if (!port) {
            vscode.window.showWarningMessage('[Serial Agent] Please select a serial port first');
            return;
          }
          const currentCfg = serialManager.config;
          const config: SerialConfig = {
            port,
            baudRate: baudRate ?? 115200,
            dataBits: dataBits ?? 8,
            parity: parity ?? 'none',
            stopBits: stopBits ?? 1,
            lineEnding: currentCfg.lineEnding,
            showTimestamp: currentCfg.showTimestamp,
            hexMode: currentCfg.hexMode,
          };
          this._saveConfig(config);
          await serialManager.connect(config);
          break;
        }

        case 'disconnect': {
          await serialManager.disconnect();
          break;
        }

        case 'clearLog': {
          serialManager.clearLog();
          serialManager.resetCounters();
          this.postMessage({ type: 'clearLog' });
          break;
        }

        case 'sendData': {
          const cfg = serialManager.config;
          const hexSend = data.hexSend ?? false;
          await serialManager.send(data.text, hexSend, cfg.lineEnding);
          break;
        }

        case 'updateSettings': {
          const partial: Partial<SerialConfig> = {};
          if (data.showTimestamp !== undefined) { partial.showTimestamp = data.showTimestamp; }
          if (data.hexMode !== undefined) { partial.hexMode = data.hexMode; }
          if (data.lineEnding !== undefined) { partial.lineEnding = data.lineEnding; }
          serialManager.updateSettings(partial);
          this._saveConfig(partial);
          break;
        }

        case 'saveSendHistory': {
          this._saveSendHistory(data.history ?? []);
          break;
        }

        case 'saveConfig': {
          if (data.config) { this._saveConfig(data.config); }
          break;
        }

        case 'keilBuild': {
          vscode.commands.executeCommand('serialagent.keil.build');
          break;
        }

        case 'keilFlash': {
          vscode.commands.executeCommand('serialagent.keil.flash');
          break;
        }

        case 'keilBuildFlash': {
          vscode.commands.executeCommand('serialagent.keil.buildAndFlash');
          break;
        }

        case 'keilOpenConfig': {
          vscode.commands.executeCommand('serialagent.keil.openSettings');
          break;
        }

        case 'keilSelectCpu': {
          vscode.commands.executeCommand('serialagent.keil.selectJlinkDevice');
          break;
        }
      }
    });
  }

  // ---- HTML 生成 ----

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js')
    );
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'reset.css')
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'vscode.css')
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.css')
    );

    const nonce = getNonce();

    // 波特率 datalist 选项
    const baudrateOptions = DEFAULT_BAUDRATES.map(b => `<option value="${b}">`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleResetUri}" rel="stylesheet">
  <link href="${styleVSCodeUri}" rel="stylesheet">
  <link href="${styleMainUri}" rel="stylesheet">
  <title>Serial Agent Monitor</title>
</head>
<body>

  <!-- 状态栏：连接状态 + RX/TX 计数 -->
  <div class="status-bar">
    <span id="status-dot" class="status-indicator status-disconnected"></span>
    <span id="status-text">Disconnected</span>
    <span class="spacer"></span>
    <span id="rx-count" class="counter" title="Received bytes">RX: 0</span>
    <span id="tx-count" class="counter" title="Sent bytes">TX: 0</span>
  </div>

  <!-- 串口配置 -->
  <div class="config-section">
    <!-- Port -->
    <div class="config-row">
      <label>Port</label>
      <div class="config-control">
        <select id="port-select"><option value="">-- Refresh --</option></select>
        <button id="btn-refresh" class="icon-btn" title="Refresh Ports">&#x21bb;</button>
      </div>
    </div>
    <!-- Baudrate（支持手动输入） -->
    <div class="config-row">
      <label>Baud</label>
      <div class="config-control">
        <input id="baudrate-input" type="number" list="baudrate-list" value="115200" min="1" />
        <datalist id="baudrate-list">${baudrateOptions}</datalist>
      </div>
    </div>
    <!-- Line Ending（与 Advanced 同级） -->
    <div class="config-row">
      <label>End</label>
      <div class="config-control">
        <select id="line-ending-select" title="Line ending for send">
          <option value="none" selected>None</option>
          <option value="lf">LF (\\n)</option>
          <option value="crlf">CRLF (\\r\\n)</option>
          <option value="cr">CR (\\r)</option>
        </select>
      </div>
    </div>
    <!-- 高级参数（折叠） -->
    <details id="advanced-config">
      <summary>Advanced</summary>
      <div class="config-row">
        <label>Data</label>
        <select id="databits-select">
          <option value="5">5</option><option value="6">6</option>
          <option value="7">7</option><option value="8" selected>8</option>
        </select>
      </div>
      <div class="config-row">
        <label>Parity</label>
        <select id="parity-select">
          <option value="none" selected>None</option><option value="even">Even</option>
          <option value="odd">Odd</option><option value="mark">Mark</option>
          <option value="space">Space</option>
        </select>
      </div>
      <div class="config-row">
        <label>Stop</label>
        <select id="stopbits-select">
          <option value="1" selected>1</option><option value="1.5">1.5</option>
          <option value="2">2</option>
        </select>
      </div>
    </details>
  </div>

  <!-- 操作按钮 -->
  <div class="action-bar">
    <button id="btn-connect" class="btn-primary">Open</button>
    <button id="btn-clear" class="btn-secondary">Clear</button>
  </div>

  <div class="action-bar" style="margin-top: 6px;">
    <button id="btn-keil-build" class="btn-secondary">Build</button>
    <button id="btn-keil-flash" class="btn-secondary">Flash</button>
    <button id="btn-keil-build-flash" class="btn-primary">Build+Flash</button>
    <button id="btn-keil-cpu" class="btn-secondary">CPU Name</button>
    <button id="btn-keil-config" class="btn-secondary">Keil Config</button>
  </div>
  <div id="keil-status" style="font-size: 11px; opacity: 0.85; margin: 4px 2px 0;">Keil: Idle</div>

  <!-- 选项栏：时间戳 / HEX / Echo -->
  <div class="options-bar">
    <label class="option-item" title="Show timestamp on each line">
      <input type="checkbox" id="opt-timestamp" />
      <span>Time</span>
    </label>
    <label class="option-item" title="HEX display mode (received data)">
      <input type="checkbox" id="opt-hex" />
      <span>HEX Recv</span>
    </label>
    <label class="option-item" title="Echo sent data in log area">
      <input type="checkbox" id="opt-echo" checked />
      <span>Echo</span>
    </label>
  </div>

  <!-- 内容区域：日志 + 拖拽手柄 + 发送 -->
  <div class="content-wrapper">
    <div class="log-section">
      <div id="log-area" class="log-area"></div>
    </div>
    <div id="resize-handle" class="resize-handle" title="Drag to resize"></div>
    <div class="send-section" id="send-section">
      <div class="send-options-row">
        <label class="option-item" title="Send data as HEX bytes">
          <input type="checkbox" id="opt-hex-send" />
          <span>HEX Send</span>
        </label>
        <div class="history-dropdown" id="history-dropdown">
          <button class="history-toggle" id="history-toggle" type="button">-- History --</button>
          <div class="history-menu" id="history-menu"></div>
        </div>
        <button id="btn-send" class="btn-send" disabled>Send</button>
      </div>
      <div class="send-input-row">
        <textarea id="send-input" rows="3" placeholder="Send data... (Ctrl+Enter to send)" disabled></textarea>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ============================================================
// 工具函数
// ============================================================

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
