import * as crypto from 'crypto';
import * as vscode from 'vscode';
import {
  FirmwareConfigAction,
  FirmwareConfigRoute,
  FirmwareConfigSnapshot,
  normalizeFirmwareConfigRoute,
  FirmwareConfigSummary,
} from './firmware-config-model';
import type { SerialRuntime } from './serial-manager';
import { PortAutoRefresh } from './port-auto-refresh';
import { DEFAULT_CONFIG, SerialConfig } from './types';

const DEFAULT_BAUDRATES = [
  9600, 19200, 38400, 57600, 74880,
  115200, 230400, 460800, 921600,
  1000000, 1500000, 2000000, 4500000,
];

const MAX_SEND_HISTORY = 20;
const MAX_SERIAL_PROFILES = 10;
const MAX_QUICK_COMMANDS = 12;

interface SerialProfile {
  id: string;
  name: string;
  config: SerialConfig;
}

interface QuickCommand {
  id: string;
  label: string;
  value: string;
  hexSend?: boolean;
}

export type AccordionPanel = 'firmware' | 'connection' | 'monitor';

interface SerialPanelUiState {
  activePanel: AccordionPanel | null;
  normalSendHeight?: number;
  firmwareDrawerOpen?: boolean;
  firmwareDrawerRoute?: FirmwareConfigRoute;
  firmwareDrawerStack?: FirmwareConfigRoute[];
}

export class SerialPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'serialagent.serialPanel';
  public static readonly panelViewType = 'serialagent.serialPanel.tab';

  private _view?: vscode.WebviewView;
  private _panel?: vscode.WebviewPanel;
  private _firmwareConfigSnapshot?: FirmwareConfigSnapshot;
  private _firmwareConfigSummary?: FirmwareConfigSummary;
  private readonly _portAutoRefresh: PortAutoRefresh;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _serialManager: SerialRuntime,
    private readonly _onStatusChange: (connected: boolean, portPath?: string, baudRate?: number) => void,
  ) {
    this._portAutoRefresh = new PortAutoRefresh(
      this._serialManager,
      (ports) => {
        this.postMessage({ type: 'updatePorts', ports });
      },
    );
  }

  dispose(): void {
    this._portAutoRefresh.dispose();
  }

  get panel(): vscode.WebviewPanel | undefined {
    return this._panel;
  }

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

    this._initializeView(webviewView.webview);

    webviewView.onDidChangeVisibility(() => {
      this._updatePortRefreshVisibility();
    });
    if (webviewView.visible) {
      this._updatePortRefreshVisibility();
    }
  }

  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    this._panel = panel;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };
    panel.webview.html = this._getHtmlForWebview(panel.webview);

    this._initializeView(panel.webview);

    panel.onDidChangeViewState(() => {
      this._updatePortRefreshVisibility();
    });
    if (panel.visible) {
      this._updatePortRefreshVisibility();
    }

    panel.onDidDispose(() => {
      this._panel = undefined;
      this._updatePortRefreshVisibility();
    });
  }

  public async refreshPortList(options?: { forceFull?: boolean; silent?: boolean }): Promise<void> {
    try {
      if (options?.forceFull) {
        const ports = await this._serialManager.listPorts({
          metadata: 'full',
          forceMetadata: true,
        });
        this._portAutoRefresh.syncFingerprints(ports);
        this.postMessage({ type: 'updatePorts', ports });
        return;
      }

      const ports = await this._portAutoRefresh.refreshOnce();
      if (ports) {
        this.postMessage({ type: 'updatePorts', ports });
      }
    } catch (err: unknown) {
      if (options?.silent) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`[Serial Agent] Scan failed: ${msg}`);
    }
  }

  public handlePortRefreshConfigChange(): void {
    this._portAutoRefresh.handleConfigChange();
  }

  private _isAnyViewVisible(): boolean {
    return !!(this._view?.visible || this._panel?.visible);
  }

  private _updatePortRefreshVisibility(): void {
    this._portAutoRefresh.onVisibilityChange(this._isAnyViewVisible());
  }

  public postMessage(message: Record<string, unknown>) {
    void this._view?.webview.postMessage(message);
    void this._panel?.webview.postMessage(message);
  }

  public clearPanel(): void {
    this._panel = undefined;
  }

  public setFirmwareConfigState(snapshot: FirmwareConfigSnapshot, summary: FirmwareConfigSummary): void {
    this._firmwareConfigSnapshot = snapshot;
    this._firmwareConfigSummary = summary;
    this.postMessage({ type: 'firmwareConfigSnapshot', snapshot });
    this.postMessage({ type: 'firmwareConfigSummary', summary });
  }

  private _saveConfig(partial: Partial<SerialConfig>): void {
    const saved = this._context.globalState.get<SerialConfig>('serialConfig', { ...DEFAULT_CONFIG });
    void this._context.globalState.update('serialConfig', { ...saved, ...partial });
  }

  private _loadConfig(): SerialConfig {
    const saved = this._context.globalState.get<Partial<SerialConfig>>('serialConfig', {});
    return { ...DEFAULT_CONFIG, ...saved };
  }

  private _saveSendHistory(history: string[]): void {
    void this._context.globalState.update('sendHistory', history.slice(0, MAX_SEND_HISTORY));
  }

  private _loadSendHistory(): string[] {
    return this._context.globalState.get<string[]>('sendHistory', []);
  }

  private _saveSerialProfiles(profiles: SerialProfile[]): void {
    void this._context.globalState.update('serialProfiles', profiles.slice(0, MAX_SERIAL_PROFILES));
  }

  private _loadSerialProfiles(): SerialProfile[] {
    return this._context.globalState.get<SerialProfile[]>('serialProfiles', []);
  }

  private _saveQuickCommands(commands: QuickCommand[]): void {
    void this._context.globalState.update('quickCommands', commands.slice(0, MAX_QUICK_COMMANDS));
  }

  private _loadQuickCommands(): QuickCommand[] {
    return this._context.globalState.get<QuickCommand[]>('quickCommands', []);
  }

  private _loadPanelUiState(): SerialPanelUiState {
    return this._normalizePanelUiState(this._context.globalState.get<SerialPanelUiState>('serialPanelUiState', {
      activePanel: 'monitor',
      firmwareDrawerOpen: false,
      firmwareDrawerRoute: 'home',
      firmwareDrawerStack: ['home'],
    }));
  }

  private _persistPanelUiState(partial: Partial<SerialPanelUiState>): void {
    const nextState = this._normalizePanelUiState({
      ...this._loadPanelUiState(),
      ...partial,
    });
    void this._context.globalState.update('serialPanelUiState', nextState);
    this.postMessage({ type: 'updateUiState', uiState: nextState });
  }

  private _normalizePanelUiState(state: Partial<SerialPanelUiState> & { focusMode?: boolean }): SerialPanelUiState {
    const activePanel = this._normalizeActivePanel(state.activePanel, state.focusMode);
    const route = this._normalizeFirmwareDrawerRoute(state.firmwareDrawerRoute);
    const stack = this._normalizeFirmwareDrawerStack(state.firmwareDrawerStack, route);
    const firmwareDrawerOpen = !!state.firmwareDrawerOpen
      && activePanel === 'firmware';

    return {
      activePanel,
      normalSendHeight: typeof state.normalSendHeight === 'number' ? state.normalSendHeight : undefined,
      firmwareDrawerOpen,
      firmwareDrawerRoute: firmwareDrawerOpen ? stack[stack.length - 1] : 'home',
      firmwareDrawerStack: firmwareDrawerOpen ? stack : ['home'],
    };
  }

  private _normalizeActivePanel(
    activePanel: unknown,
    legacyFocusMode?: boolean,
  ): AccordionPanel | null {
    if (activePanel === 'firmware' || activePanel === 'connection' || activePanel === 'monitor') {
      return activePanel;
    }
    if (activePanel === null || activePanel === 'none' || activePanel === '') {
      return null;
    }
    if (legacyFocusMode === true) {
      return 'monitor';
    }
    return 'monitor';
  }

  private _normalizeFirmwareDrawerRoute(route: unknown): FirmwareConfigRoute {
    return normalizeFirmwareConfigRoute(route);
  }

  private _normalizeFirmwareDrawerStack(
    stack: unknown,
    fallbackRoute: FirmwareConfigRoute,
  ): FirmwareConfigRoute[] {
    if (!Array.isArray(stack) || stack.length === 0) {
      return ['home'];
    }

    const normalized = stack
      .map((item) => this._normalizeFirmwareDrawerRoute(item))
      .filter((route, index, routes) => route !== routes[index - 1]);

    if (normalized.length === 0) {
      return ['home'];
    }

    if (normalized[normalized.length - 1] !== fallbackRoute) {
      normalized.push(fallbackRoute);
    }

    if (normalized[0] !== 'home') {
      normalized.unshift('home');
    }

    return normalized;
  }

  private async _saveLogToFile(logLines: string[]): Promise<void> {
    const target = await vscode.window.showSaveDialog({
      saveLabel: 'Save Serial Log',
      filters: {
        'Log Files': ['log', 'txt'],
        'All Files': ['*'],
      },
      defaultUri: vscode.Uri.file(`serial-agent-${Date.now()}.log`),
    });

    if (!target) {
      return;
    }

    const content = logLines.join('\n');
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    vscode.window.showInformationMessage(`[Serial Agent] Log saved: ${target.fsPath}`);
  }

  private _initializeView(webview: vscode.Webview): void {
    const savedConfig = this._loadConfig();
    this._serialManager.updateSettings(savedConfig);
    this._serialManager.setCallbacks({
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
        this._onStatusChange(connected, portPath, baudRate);
      },
      onError: (msg) => {
        vscode.window.showErrorMessage(`[Serial Agent] ${msg}`);
        this.postMessage({ type: 'appendLog', text: `[ERROR] ${msg}\n` });
      },
      onCounterUpdate: (rx, tx) => {
        this.postMessage({ type: 'updateCounters', rx, tx });
      },
    });

    this._setupWebviewMessageHandler(webview);

    void this.refreshPortList({ forceFull: true, silent: true });

    this.postMessage({
      type: 'restoreConfig',
      config: savedConfig,
      sendHistory: this._loadSendHistory(),
      serialProfiles: this._loadSerialProfiles(),
      quickCommands: this._loadQuickCommands(),
      uiState: this._loadPanelUiState(),
      firmwareConfigSnapshot: this._firmwareConfigSnapshot,
      firmwareConfigSummary: this._firmwareConfigSummary,
    });

    if (this._serialManager.isConnected) {
      this.postMessage({
        type: 'updateStatus',
        connected: true,
        port: this._serialManager.currentPath,
        baudRate: this._serialManager.currentBaudRate,
      });
      this.postMessage({
        type: 'updateCounters',
        rx: this._serialManager.rxBytes,
        tx: this._serialManager.txBytes,
      });
    }
  }

  private _setupWebviewMessageHandler(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'refreshPorts': {
          await this.refreshPortList({ forceFull: true });
          break;
        }

        case 'connect': {
          const { port, baudRate, dataBits, parity, stopBits, flowControl } = data;
          if (!port) {
            vscode.window.showWarningMessage('[Serial Agent] Please select a serial port first');
            return;
          }
          const currentCfg = this._serialManager.config;
          const normalizedFlowControl = this._normalizeFlowControl(flowControl ?? currentCfg.flowControl);
          const config: SerialConfig = {
            port,
            baudRate: baudRate ?? 115200,
            dataBits: dataBits ?? 8,
            parity: parity ?? 'none',
            stopBits: stopBits ?? 1,
            flowControl: normalizedFlowControl,
            lineEnding: currentCfg.lineEnding,
            showTimestamp: currentCfg.showTimestamp,
            hexMode: currentCfg.hexMode,
            encoding: currentCfg.encoding,
          };
          this._saveConfig(config);
          await this._serialManager.connect(config);
          break;
        }

        case 'disconnect': {
          await this._serialManager.disconnect();
          break;
        }

        case 'clearLog': {
          this._serialManager.clearLog();
          this._serialManager.resetCounters();
          this.postMessage({ type: 'clearLog' });
          break;
        }

        case 'sendData': {
          const cfg = this._serialManager.config;
          const hexSend = data.hexSend ?? false;
          await this._serialManager.send(data.text, hexSend, cfg.lineEnding);
          break;
        }

        case 'updateSettings': {
          const partial: Partial<SerialConfig> = {};
          if (data.showTimestamp !== undefined) { partial.showTimestamp = data.showTimestamp; }
          if (data.hexMode !== undefined) { partial.hexMode = data.hexMode; }
          if (data.lineEnding !== undefined) { partial.lineEnding = data.lineEnding; }
          if (data.encoding !== undefined) { partial.encoding = data.encoding === 'gbk' ? 'gbk' : 'utf8'; }
          if (data.flowControl !== undefined) { partial.flowControl = this._normalizeFlowControl(data.flowControl); }
          this._serialManager.updateSettings(partial);
          this._saveConfig(partial);
          break;
        }

        case 'saveSendHistory': {
          this._saveSendHistory(data.history ?? []);
          break;
        }

        case 'saveSerialProfiles': {
          this._saveSerialProfiles(data.profiles ?? []);
          break;
        }

        case 'saveQuickCommands': {
          this._saveQuickCommands(data.commands ?? []);
          break;
        }

        case 'saveConfig': {
          if (data.config) { this._saveConfig(data.config); }
          break;
        }

        case 'saveLogToFile': {
          await this._saveLogToFile(data.lines ?? []);
          break;
        }

        case 'savePanelLayout': {
          if (typeof data.normalSendHeight === 'number') {
            this._persistPanelUiState({ normalSendHeight: data.normalSendHeight });
          }
          break;
        }

        case 'savePanelUiState': {
          const partial: Partial<SerialPanelUiState> = {};
          if (data.activePanel !== undefined) {
            partial.activePanel = this._normalizeActivePanel(data.activePanel);
          }
          if (typeof data.firmwareDrawerOpen === 'boolean') {
            partial.firmwareDrawerOpen = data.firmwareDrawerOpen;
          }
          if (data.firmwareDrawerRoute !== undefined) {
            partial.firmwareDrawerRoute = this._normalizeFirmwareDrawerRoute(data.firmwareDrawerRoute);
          }
          if (Array.isArray(data.firmwareDrawerStack)) {
            partial.firmwareDrawerStack = this._normalizeFirmwareDrawerStack(
              data.firmwareDrawerStack,
              this._normalizeFirmwareDrawerRoute(data.firmwareDrawerRoute),
            );
          }
          if (Object.keys(partial).length > 0) {
            this._persistPanelUiState(partial);
          }
          break;
        }

        case 'keilBuild': {
          await vscode.commands.executeCommand('serialagent.keil.build');
          break;
        }

        case 'keilFlash': {
          await vscode.commands.executeCommand('serialagent.keil.flash');
          break;
        }

        case 'keilBuildFlash': {
          await vscode.commands.executeCommand('serialagent.keil.buildAndFlash');
          break;
        }

        case 'customRun': {
          await vscode.commands.executeCommand('serialagent.custom.run');
          break;
        }

        case 'keilOpenConfig': {
          this._persistPanelUiState({
            activePanel: 'firmware',
            firmwareDrawerOpen: true,
            firmwareDrawerRoute: 'home',
            firmwareDrawerStack: ['home'],
          });
          break;
        }

        case 'keilRunConfigCheck': {
          await vscode.commands.executeCommand('serialagent.keil.checkConfig');
          break;
        }

        case 'keilOpenAdvancedSettings': {
          await vscode.commands.executeCommand('serialagent.keil.openSettings');
          break;
        }

        case 'keilSelectCpu': {
          await vscode.commands.executeCommand('serialagent.keil.selectJlinkDevice');
          break;
        }

        case 'firmwareConfigAction': {
          if (typeof data.action === 'string') {
            await vscode.commands.executeCommand(
              'serialagent.keil.firmwareConfigAction',
              { action: data.action as FirmwareConfigAction },
            );
          }
          break;
        }
      }
    });
  }

  private _normalizeFlowControl(value: unknown): SerialConfig['flowControl'] {
    switch (value) {
      case 'rtscts':
      case 'xon':
      case 'xoff':
      case 'none':
        return value;
      default:
        return 'none';
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js'));
    const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'reset.css'));
    const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'vscode.css'));
    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.css'));
    const styleCodiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css',
      ),
    );

    const nonce = getNonce();
    const baudrateOptions = DEFAULT_BAUDRATES.map((baudrate) => `<option value="${baudrate}">`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleResetUri}" rel="stylesheet">
  <link href="${styleVSCodeUri}" rel="stylesheet">
  <link href="${styleMainUri}" rel="stylesheet">
  <link href="${styleCodiconsUri}" rel="stylesheet">
  <title>Serial Agent Monitor</title>
</head>
<body>
  <div class="accordion-root">
  <section id="panel-firmware" class="accordion-panel" data-panel="firmware">
    <header class="accordion-header" data-accordion="firmware" tabindex="0" role="button" aria-expanded="false">
      <span class="accordion-chevron codicon codicon-chevron-right" aria-hidden="true"></span>
      <span class="accordion-title">Firmware Program Config</span>
    </header>
    <div id="accordion-body-firmware" class="accordion-body hidden">
    <div class="action-bar firmware-bar">
      <button id="btn-keil-build" class="btn-secondary">Build</button>
      <button id="btn-keil-flash" class="btn-secondary">Flash</button>
      <button id="btn-custom-run" class="btn-secondary">Custom</button>
      <button id="btn-keil-build-flash" class="btn-primary">Build+Flash</button>
    </div>
    <div class="firmware-summary">
      <div class="firmware-summary-top">
        <span id="firmware-summary-status" class="firmware-summary-status">Checking Build/Flash config...</span>
      </div>
      <div id="firmware-summary-build" class="firmware-summary-line">Build: waiting for summary...</div>
      <div id="firmware-summary-flash" class="firmware-summary-line">Flash: waiting for summary...</div>
      <div id="firmware-summary-custom" class="firmware-summary-line">Custom: waiting for summary...</div>
      <div id="firmware-summary-hint" class="firmware-summary-hint">Use Configure to start the guided setup.</div>
      <div id="firmware-summary-warnings" class="firmware-summary-warnings hidden"></div>
      <div class="firmware-summary-actions">
        <button id="btn-keil-config-inline" class="btn-firmware-cta" type="button">
          <span class="codicon codicon-tools" aria-hidden="true"></span>
          Configure
        </button>
        <button id="btn-keil-check" class="btn-firmware-action" type="button">
          <span class="codicon codicon-check-all" aria-hidden="true"></span>
          Run Check
        </button>
        <button id="btn-keil-settings" class="btn-firmware-action" type="button">
          <span class="codicon codicon-gear" aria-hidden="true"></span>
          Settings
        </button>
      </div>
    </div>
    <div id="firmware-config-drawer" class="firmware-config-drawer hidden">
      <div class="firmware-config-drawer-header">
        <button id="btn-firmware-drawer-back" class="btn-firmware-back" type="button">
          <span class="codicon codicon-chevron-left" aria-hidden="true"></span>
          Back
        </button>
        <div class="firmware-config-drawer-heading">
          <span class="firmware-config-drawer-eyebrow">Firmware Config</span>
          <span id="firmware-drawer-route-title" class="firmware-config-drawer-title">Home</span>
        </div>
        <button id="btn-firmware-drawer-close" class="btn-secondary btn-compact" type="button">Close and Return to Serial</button>
      </div>

      <div id="firmware-route-home" class="firmware-config-route">
        <div class="firmware-config-intro">
          <div class="firmware-config-intro-title">Start from the area you want to fix.</div>
          <div class="firmware-config-intro-text">Summary stays visible above. Open Build or Flash, edit one field at a time, and close this drawer whenever you want to return to Serial Agent.</div>
        </div>
        <div class="firmware-config-grid">
          <button class="firmware-route-card" type="button" data-firmware-route="build">
            <span class="firmware-route-card-title">Build Essentials</span>
            <span class="firmware-route-card-text">UV4.exe path, optional ARMCC5 toolchain path, project file, target.</span>
          </button>
          <button class="firmware-route-card" type="button" data-firmware-route="flash">
            <span class="firmware-route-card-title">Flash Essentials</span>
            <span class="firmware-route-card-text">F7 action, flasher choice, backend details.</span>
          </button>
          <button class="firmware-route-card" type="button" data-firmware-route="custom">
            <span class="firmware-route-card-title">Custom Command</span>
            <span class="firmware-route-card-text">Python script, or paste a command / choose an executable.</span>
          </button>
        </div>
        <div class="firmware-config-actions">
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="runConfigCheck" data-keil-busy-lock="true">Run Check</button>
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="openAdvancedSettings">Settings</button>
        </div>
      </div>

      <div id="firmware-route-custom" class="firmware-config-route hidden">
        <div class="firmware-config-list">
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Mode</div>
              <div id="fw-custom-mode" class="firmware-config-item-text">Choose Python Script or Command.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickCustomMode" data-keil-busy-lock="true">Choose Mode</button>
          </div>
          <div class="firmware-config-item custom-python-only">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Python Interpreter</div>
              <div id="fw-custom-python" class="firmware-config-item-text">Choose python.exe from a uv venv, venv, or system Python.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickCustomPython" data-keil-busy-lock="true">Choose Python</button>
          </div>
          <div class="firmware-config-item custom-python-only">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Python Script</div>
              <div id="fw-custom-script" class="firmware-config-item-text">Choose the .py file to run.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickCustomScript" data-keil-busy-lock="true">Choose Script</button>
          </div>
          <div class="firmware-config-item custom-command-only hidden">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Command</div>
              <div id="fw-custom-command" class="firmware-config-item-text">Paste a command line, or choose an executable and add arguments.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickCustomCommand" data-keil-busy-lock="true">Edit Command</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Preview</div>
              <div id="fw-custom-preview" class="firmware-config-item-text">Choose a mode to preview the custom action.</div>
            </div>
          </div>
        </div>
        <div class="firmware-config-actions">
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="runConfigCheck" data-keil-busy-lock="true">Run Check</button>
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="openAdvancedSettings">Settings</button>
        </div>
      </div>

      <div id="firmware-route-build" class="firmware-config-route hidden">
        <div class="firmware-config-list">
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">UV4.exe Path</div>
              <div id="fw-build-uv4" class="firmware-config-item-text">填写 Keil 命令行构建使用的 UV4.exe 完整路径，例如 C:\\Keil_v5\\UV4\\UV4.exe</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickUv4Path" data-keil-busy-lock="true">Choose UV4.exe</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">ARMCC5 Toolchain Path</div>
              <div id="fw-build-armcc5" class="firmware-config-item-text">可选，填写 ARMCC5 的 bin 目录，不是 exe 文件，例如 C:\\Keil_v5\\ARM\\ARMCC\\bin</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickArmcc5Path" data-keil-busy-lock="true">Choose ARMCC5 Folder</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Project File</div>
              <div id="fw-build-project" class="firmware-config-item-text">支持直接选项目文件，也支持先选文件夹再扫描里面的 .uvprojx / .uvproj，例如 firmware\\app.uvprojx 或 D:\\work\\firmware\\app.uvprojx</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickProjectFile" data-keil-busy-lock="true">Choose Project File</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Target</div>
              <div id="fw-build-target" class="firmware-config-item-text">可选；留空就是 Auto，会使用当前项目里的第一个 Target；通常只有项目里有多个 Target 时，才需要手动选择。</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickTarget" data-keil-busy-lock="true">Choose Target</button>
          </div>
        </div>
        <div class="firmware-config-actions">
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="runConfigCheck" data-keil-busy-lock="true">Run Check</button>
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="openAdvancedSettings">Advanced Settings</button>
        </div>
      </div>

      <div id="firmware-route-flash" class="firmware-config-route hidden">
        <div class="firmware-config-list">
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">F7 Action</div>
              <div id="fw-flash-f7" class="firmware-config-item-text">Choose whether F7 does build only or build plus flash.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickF7Action" data-keil-busy-lock="true">Choose F7 Action</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Flash Method</div>
              <div id="fw-flash-method" class="firmware-config-item-text">Switch between JLink, ST-Link, and OpenOCD, then enter that backend page.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickFlashMethod" data-keil-busy-lock="true">Choose Flasher</button>
          </div>
        </div>
        <div class="firmware-config-grid firmware-config-grid-flash">
          <button class="firmware-route-card" type="button" data-firmware-route="jlink" data-firmware-action="selectJlinkFlasher" data-keil-busy-lock="true">
            <span class="firmware-route-card-title">JLink</span>
            <span class="firmware-route-card-text">Install path, CPU, interface, speed, base address.</span>
          </button>
          <button class="firmware-route-card" type="button" data-firmware-route="stlink" data-firmware-action="selectStlinkFlasher" data-keil-busy-lock="true">
            <span class="firmware-route-card-title">ST-Link</span>
            <span class="firmware-route-card-text">CLI path, interface, speed, reset mode, run after program.</span>
          </button>
          <button class="firmware-route-card" type="button" data-firmware-route="openocd" data-firmware-action="selectOpenOcdFlasher" data-keil-busy-lock="true">
            <span class="firmware-route-card-title">OpenOCD</span>
            <span class="firmware-route-card-text">Executable, Chip Config, Interface Config, sequence.</span>
          </button>
        </div>
      </div>

      <div id="firmware-route-jlink" class="firmware-config-route hidden">
        <div class="firmware-config-list">
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Install Directory</div>
              <div id="fw-jlink-install" class="firmware-config-item-text">填写 JLink 安装目录，不是 JLink.exe 文件，例如 C:\\Program Files\\SEGGER\\JLink 或 C:\\Program Files (x86)\\SEGGER\\JLink</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickJlinkInstallDir" data-keil-busy-lock="true">Choose Install Directory</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">JLink CPU</div>
              <div id="fw-jlink-device" class="firmware-config-item-text">Use the dedicated CPU selector instead of typing the device name manually.</div>
            </div>
            <button class="btn-primary btn-compact" type="button" data-firmware-action="pickJlinkDevice" data-keil-busy-lock="true">Select JLink CPU</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Interface</div>
              <div id="fw-jlink-interface" class="firmware-config-item-text">Choose the JLink interface type.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickJlinkInterface" data-keil-busy-lock="true">Choose Interface</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Speed</div>
              <div id="fw-jlink-speed" class="firmware-config-item-text">Choose the JLink speed in kHz.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickJlinkSpeed" data-keil-busy-lock="true">Choose Speed</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Base Address</div>
              <div id="fw-jlink-base" class="firmware-config-item-text">Choose the base address for .bin flashing.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickJlinkBaseAddr" data-keil-busy-lock="true">Choose Base Address</button>
          </div>
        </div>
        <div class="firmware-config-actions">
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="runConfigCheck" data-keil-busy-lock="true">Run Check</button>
        </div>
      </div>

      <div id="firmware-route-stlink" class="firmware-config-route hidden">
        <div class="firmware-config-list">
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">STM32 Programmer CLI</div>
              <div id="fw-stlink-exe" class="firmware-config-item-text">填写 STM32_Programmer_CLI.exe 完整路径，例如 C:\\ST\\STM32CubeCLT\\STM32CubeProgrammer\\bin\\STM32_Programmer_CLI.exe</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickStlinkExePath" data-keil-busy-lock="true">Choose CLI Path</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Interface</div>
              <div id="fw-stlink-interface" class="firmware-config-item-text">Choose the ST-Link interface type.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickStlinkInterface" data-keil-busy-lock="true">Choose Interface</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Speed</div>
              <div id="fw-stlink-speed" class="firmware-config-item-text">Choose the ST-Link speed in kHz.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickStlinkSpeed" data-keil-busy-lock="true">Choose Speed</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Base Address</div>
              <div id="fw-stlink-base" class="firmware-config-item-text">Choose the base address for .bin flashing.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickStlinkBaseAddr" data-keil-busy-lock="true">Choose Base Address</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Reset Mode</div>
              <div id="fw-stlink-reset" class="firmware-config-item-text">Choose the reset mode passed to STM32CubeProgrammer.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickStlinkResetMode" data-keil-busy-lock="true">Choose Reset Mode</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Run After Program</div>
              <div id="fw-stlink-run-after" class="firmware-config-item-text">Choose whether STM32CubeProgrammer should add --go after flashing.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickStlinkRunAfterProgram" data-keil-busy-lock="true">Choose Run After Program</button>
          </div>
        </div>
        <div class="firmware-config-actions">
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="openAdvancedSettings">Advanced Settings</button>
        </div>
      </div>

      <div id="firmware-route-openocd" class="firmware-config-route hidden">
        <div class="firmware-config-list">
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">OpenOCD Executable</div>
              <div id="fw-openocd-exe" class="firmware-config-item-text">填写 openocd.exe 完整路径，例如 C:\\OpenOCD\\bin\\openocd.exe；不要填 scripts 目录，也不要只填 openocd</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickOpenOcdExePath" data-keil-busy-lock="true">Choose openocd.exe</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Chip Config</div>
              <div id="fw-openocd-target" class="firmware-config-item-text">填写 short name，不是路径，例如 stm32f4x；不要填 target\\stm32f4x.cfg</div>
            </div>
            <button class="btn-primary btn-compact" type="button" data-firmware-action="pickOpenOcdTarget" data-keil-busy-lock="true">Choose Chip Config</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Interface Config</div>
              <div id="fw-openocd-interface" class="firmware-config-item-text">填写 short name，不是路径，例如 cmsis-dap；不要填 interface\\cmsis-dap.cfg</div>
            </div>
            <button class="btn-primary btn-compact" type="button" data-firmware-action="pickOpenOcdInterface" data-keil-busy-lock="true">Choose Interface Config</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Sequence</div>
              <div id="fw-openocd-sequence" class="firmware-config-item-text">Choose helper or low-reset depending on your board reset pattern.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickOpenOcdSequence" data-keil-busy-lock="true">Choose Sequence</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Base Address</div>
              <div id="fw-openocd-base" class="firmware-config-item-text">Choose the base address for .bin flashing.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickOpenOcdBaseAddr" data-keil-busy-lock="true">Choose Base Address</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Run After Program</div>
              <div id="fw-openocd-run-after" class="firmware-config-item-text">Choose whether OpenOCD should append reset run.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickOpenOcdRunAfterProgram" data-keil-busy-lock="true">Choose Run After Program</button>
          </div>
        </div>
        <div class="firmware-config-actions">
          <button class="btn-secondary btn-compact" type="button" data-firmware-action="runConfigCheck" data-keil-busy-lock="true">Run Check</button>
        </div>
      </div>
    </div>
    <div id="keil-status" class="keil-status">Keil: Idle</div>
    </div>
  </section>

  <section id="panel-connection" class="accordion-panel" data-panel="connection">
    <header class="accordion-header" data-accordion="connection" tabindex="0" role="button" aria-expanded="false">
      <span class="accordion-chevron codicon codicon-chevron-right" aria-hidden="true"></span>
      <span class="accordion-title">COM Port Config</span>
    </header>
    <div id="accordion-body-connection" class="accordion-body hidden">
    <div id="serial-config-section" class="panel-inner">
    <div class="config-section">
    <div class="config-row">
      <label>Port</label>
      <div class="config-control">
        <select id="port-select"><option value="">-- Refresh --</option></select>
        <button id="btn-refresh" class="icon-btn" title="Refresh Ports">&#x21bb;</button>
      </div>
    </div>
    <div class="config-row">
      <label>Baud</label>
      <div class="config-control">
        <input id="baudrate-input" type="number" list="baudrate-list" value="115200" min="1" />
        <datalist id="baudrate-list">${baudrateOptions}</datalist>
      </div>
    </div>
    <div class="config-row">
      <label>Parity</label>
      <div class="config-control">
        <select id="parity-select">
          <option value="none" selected>None</option><option value="even">Even</option>
          <option value="odd">Odd</option><option value="mark">Mark</option>
          <option value="space">Space</option>
        </select>
      </div>
    </div>
    <div id="advanced-config" class="config-section">
      <div class="config-row">
        <label>Data</label>
        <select id="databits-select">
          <option value="5">5</option><option value="6">6</option>
          <option value="7">7</option><option value="8" selected>8</option>
        </select>
      </div>
      <div class="config-row">
        <label>Stop</label>
        <select id="stopbits-select">
          <option value="1" selected>1</option><option value="1.5">1.5</option>
          <option value="2">2</option>
        </select>
      </div>
      <div class="config-row">
        <label>Flow</label>
        <select id="flow-control-select" title="Flow control">
          <option value="none" selected>None</option>
          <option value="rtscts">RTS/CTS</option>
          <option value="xon">XON/XOFF</option>
          <option value="xoff">XOFF only</option>
        </select>
      </div>
    </div>
    </div>

    <div class="action-bar">
      <button id="btn-connect" class="btn-primary">Open</button>
    </div>
    </div>
    </div>
  </section>

  <section id="panel-monitor" class="accordion-panel accordion-panel--monitor is-expanded" data-panel="monitor">
    <header class="accordion-header" data-accordion="monitor" tabindex="0" role="button" aria-expanded="true">
      <span class="accordion-chevron codicon codicon-chevron-right is-expanded" aria-hidden="true"></span>
      <span class="accordion-title">Serial Monitor</span>
    </header>
    <div id="accordion-body-monitor" class="accordion-body">
    <div class="monitor-panel-main">
    <div class="monitor-status-bar">
      <span id="status-dot" class="status-indicator status-disconnected"></span>
      <span id="status-text">Disconnected</span>
      <span id="monitor-port-chip" class="config-chip hidden"></span>
      <span id="monitor-baud-chip" class="config-chip hidden"></span>
      <span class="spacer"></span>
      <span id="rx-count" class="counter" title="Received bytes">RX: 0</span>
      <span id="tx-count" class="counter" title="Sent bytes">TX: 0</span>
      <button id="btn-monitor-connect" class="status-action-btn status-action-primary" type="button" title="Toggle serial connection">Open</button>
    </div>

    <div class="log-toolbar">
      <input id="log-search" class="log-search-input" type="text" placeholder="Search or filter logs" />
      <button id="btn-freeze" class="btn-secondary btn-compact" type="button">Freeze</button>
      <button id="btn-copy-log" class="btn-secondary btn-compact" type="button">Copy</button>
      <button id="btn-save-log" class="btn-secondary btn-compact" type="button">Save</button>
      <button id="btn-clear" class="btn-secondary btn-icon-compact" type="button" title="Clear logs" aria-label="Clear logs">
        <svg class="btn-icon-svg clear-broom" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor">
          <path d="M14.854 1.146a.5.5 0 0 0-.707 0L9.476 5.817A3.5 3.5 0 0 0 4.653 6.19l-.684.639-2.675 1.216a.5.5 0 0 0-.285.809l6 6a.5.5 0 0 0 .443.138.5.5 0 0 0 .366-.245l1.212-2.667.686-.686A3.5 3.5 0 0 0 10.184 6.524l4.67-4.67a.5.5 0 0 0 0-.707ZM4.141 7.849l4.01 4.01-.808 1.777L2.364 8.657 4.141 7.849Zm4.609 3.194L4.969 7.263l.372-.347.012-.012A2.5 2.5 0 0 1 9.146 6.854a2.5 2.5 0 0 1-1.793 4.189h-.003Z"/>
        </svg>
      </button>
    </div>

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
      <label class="option-item" title="Follow the latest log lines automatically">
        <input type="checkbox" id="opt-auto-scroll" checked />
        <span>Auto Scroll</span>
      </label>
      <label class="option-item send-ending-option" title="Text encoding for RX log decode and TX encode">
        <span>Encoding</span>
        <select id="encoding-select">
          <option value="utf8" selected>UTF-8</option>
          <option value="gbk">GBK</option>
        </select>
      </label>
    </div>

  <div class="content-wrapper">
    <div class="log-section">
      <div id="log-empty-state" class="empty-state">Waiting RX data...</div>
      <div id="log-area" class="log-area" tabindex="-1"></div>
    </div>
    <div id="resize-handle" class="resize-handle" title="Drag to resize"></div>
    <div class="send-section" id="send-section">
      <div class="quick-command-bar">
        <div id="quick-command-list" class="quick-command-list"></div>
      </div>

      <details id="quick-command-editor" class="quick-command-editor">
        <summary>Manage Quick Commands</summary>
        <div class="quick-command-form">
          <input id="quick-command-label" class="quick-command-input" type="text" placeholder="Label" />
          <textarea id="quick-command-value" class="quick-command-input quick-command-value" rows="3" placeholder="Command value"></textarea>
          <label class="option-item option-item-inline" title="Send the quick command as HEX bytes">
            <input type="checkbox" id="quick-command-hex" />
            <span>HEX</span>
          </label>
          <button id="btn-quick-command-save" class="btn-secondary btn-compact" type="button">Save</button>
          <button id="btn-quick-command-reset" class="btn-secondary btn-compact" type="button">Reset</button>
        </div>
        <div id="quick-command-manage-list" class="quick-command-manage-list"></div>
      </details>

      <div class="send-options-row">
        <label class="option-item" title="Send data as HEX bytes">
          <input type="checkbox" id="opt-hex-send" />
          <span>Hex</span>
        </label>
        <label class="option-item send-ending-option" title="Line ending for send">
          <span>End</span>
          <select id="line-ending-select">
            <option value="none" selected>None</option>
            <option value="lf">LF</option>
            <option value="crlf">CRLF</option>
            <option value="cr">CR</option>
          </select>
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
    </div>
  </section>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
