import * as crypto from 'crypto';
import * as vscode from 'vscode';
import {
  FirmwareConfigAction,
  FirmwareConfigRoute,
  FirmwareConfigSnapshot,
  FirmwareConfigSummary,
} from './firmware-config-model';
import type { SerialRuntime } from './serial-manager';
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

interface SerialPanelUiState {
  focusMode: boolean;
  normalSendHeight?: number;
  focusSendHeight?: number;
  firmwareDrawerOpen?: boolean;
  firmwareDrawerRoute?: FirmwareConfigRoute;
  firmwareDrawerStack?: FirmwareConfigRoute[];
}

export class SerialPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'serialagent.serialPanel';
  public static readonly panelViewType = 'serialagent.serialPanel.tab';

  private _view?: vscode.WebviewView;
  private _panel?: vscode.WebviewPanel;
  private _firmwareConfigSnapshot?: FirmwareConfigSnapshot;
  private _firmwareConfigSummary?: FirmwareConfigSummary;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _serialManager: SerialRuntime,
    private readonly _onStatusChange: (connected: boolean, portPath?: string, baudRate?: number) => void,
  ) {}

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
  }

  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    this._panel = panel;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };
    panel.webview.html = this._getHtmlForWebview(panel.webview);

    this._initializeView(panel.webview);

    panel.onDidDispose(() => {
      this._panel = undefined;
    });
  }

  public postMessage(message: Record<string, unknown>) {
    void this._view?.webview.postMessage(message);
    void this._panel?.webview.postMessage(message);
  }

  public clearPanel(): void {
    this._panel = undefined;
  }

  public toggleFocusMode(force?: boolean): void {
    const current = this._loadPanelUiState();
    const focusMode = force ?? !current.focusMode;
    this._persistPanelUiState({ focusMode });
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
    return this._context.globalState.get<SerialConfig>('serialConfig', { ...DEFAULT_CONFIG });
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
      focusMode: false,
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

  private _normalizePanelUiState(state: Partial<SerialPanelUiState>): SerialPanelUiState {
    const focusMode = !!state.focusMode;
    const route = this._normalizeFirmwareDrawerRoute(state.firmwareDrawerRoute);
    const stack = this._normalizeFirmwareDrawerStack(state.firmwareDrawerStack, route);
    const firmwareDrawerOpen = focusMode ? false : !!state.firmwareDrawerOpen;

    return {
      focusMode,
      normalSendHeight: typeof state.normalSendHeight === 'number' ? state.normalSendHeight : undefined,
      focusSendHeight: typeof state.focusSendHeight === 'number' ? state.focusSendHeight : undefined,
      firmwareDrawerOpen,
      firmwareDrawerRoute: firmwareDrawerOpen ? stack[stack.length - 1] : 'home',
      firmwareDrawerStack: firmwareDrawerOpen ? stack : ['home'],
    };
  }

  private _normalizeFirmwareDrawerRoute(route: unknown): FirmwareConfigRoute {
    switch (route) {
      case 'build':
      case 'flash':
      case 'jlink':
      case 'stlink':
      case 'openocd':
        return route;
      case 'home':
      default:
        return 'home';
    }
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

    this._serialManager.listPorts().then((ports) => {
      this.postMessage({ type: 'updatePorts', ports });
    }).catch(() => {
      // Ignore port-scan failures during initialization.
    });

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
          try {
            const ports = await this._serialManager.listPorts();
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
          const currentCfg = this._serialManager.config;
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

        case 'toggleFocusMode': {
          const focusMode = typeof data.focusMode === 'boolean'
            ? data.focusMode
            : !this._loadPanelUiState().focusMode;
          this._persistPanelUiState({
            focusMode,
            firmwareDrawerOpen: focusMode ? false : undefined,
            firmwareDrawerRoute: focusMode ? 'home' : undefined,
            firmwareDrawerStack: focusMode ? ['home'] : undefined,
          });
          break;
        }

        case 'saveFocusLayout': {
          const partial: Partial<SerialPanelUiState> = {};
          if (typeof data.normalSendHeight === 'number') {
            partial.normalSendHeight = data.normalSendHeight;
          }
          if (typeof data.focusSendHeight === 'number') {
            partial.focusSendHeight = data.focusSendHeight;
          }
          if (Object.keys(partial).length > 0) {
            this._persistPanelUiState(partial);
          }
          break;
        }

        case 'savePanelUiState': {
          const partial: Partial<SerialPanelUiState> = {};
          if (typeof data.focusMode === 'boolean') {
            partial.focusMode = data.focusMode;
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

        case 'keilOpenConfig': {
          this._persistPanelUiState({
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

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js'));
    const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'reset.css'));
    const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'vscode.css'));
    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.css'));

    const nonce = getNonce();
    const baudrateOptions = DEFAULT_BAUDRATES.map((baudrate) => `<option value="${baudrate}">`).join('');

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
  <div class="status-bar">
    <span id="status-dot" class="status-indicator status-disconnected"></span>
    <span id="status-text">Disconnected</span>
    <span class="spacer"></span>
    <span id="rx-count" class="counter" title="Received bytes">RX: 0</span>
    <span id="tx-count" class="counter" title="Sent bytes">TX: 0</span>
    <div class="status-actions">
      <button id="btn-focus-mode" class="status-action-btn" type="button" title="Toggle focus mode">Focus</button>
      <button id="btn-focus-connect" class="status-action-btn" type="button" title="Toggle serial connection" hidden>Open</button>
    </div>
  </div>

  <div id="serial-config-section" class="section-block section-block-serial">
    <div class="section-heading">
      <span class="section-title">COM Port Config</span>
    </div>

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

    <div class="action-bar">
      <button id="btn-connect" class="btn-primary">Open</button>
    </div>
  </div>

  <div id="firmware-config-section" class="section-block section-block-firmware">
    <div class="section-heading">
      <span class="section-title">Firmware Program Config</span>
    </div>
    <div class="action-bar firmware-bar">
      <button id="btn-keil-build" class="btn-secondary">Build</button>
      <button id="btn-keil-flash" class="btn-secondary">Flash</button>
      <button id="btn-keil-build-flash" class="btn-primary">Build+Flash</button>
    </div>
    <div class="firmware-summary">
      <div class="firmware-summary-top">
        <span id="firmware-summary-status" class="firmware-summary-status">Checking Build/Flash config...</span>
      </div>
      <div id="firmware-summary-build" class="firmware-summary-line">Build: waiting for summary...</div>
      <div id="firmware-summary-flash" class="firmware-summary-line">Flash: waiting for summary...</div>
      <div id="firmware-summary-hint" class="firmware-summary-hint">Use Configure to start the guided setup.</div>
      <div id="firmware-summary-warnings" class="firmware-summary-warnings hidden"></div>
      <div class="firmware-summary-actions">
        <button id="btn-keil-config-inline" class="btn-secondary btn-compact" type="button">Configure</button>
        <button id="btn-keil-check" class="btn-secondary btn-compact" type="button">Run Check</button>
        <button id="btn-keil-settings" class="btn-secondary btn-compact" type="button">Settings</button>
      </div>
    </div>
    <div id="firmware-config-drawer" class="firmware-config-drawer hidden">
      <div class="firmware-config-drawer-header">
        <button id="btn-firmware-drawer-back" class="btn-secondary btn-compact" type="button">Back</button>
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
            <span class="firmware-route-card-text">UV4 or MDK path, project file, target.</span>
          </button>
          <button class="firmware-route-card" type="button" data-firmware-route="flash">
            <span class="firmware-route-card-title">Flash Essentials</span>
            <span class="firmware-route-card-text">F7 action, flasher choice, backend details.</span>
          </button>
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
              <div class="firmware-config-item-title">UV4 or MDK Path</div>
              <div id="fw-build-uv4" class="firmware-config-item-text">Pick UV4.exe first so build can run from the extension.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickUv4Path" data-keil-busy-lock="true">Choose UV4.exe</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Project File</div>
              <div id="fw-build-project" class="firmware-config-item-text">Select the active .uvprojx or .uvproj file.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickProjectFile" data-keil-busy-lock="true">Choose Project File</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Target</div>
              <div id="fw-build-target" class="firmware-config-item-text">Use the target picker instead of free text.</div>
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
          <button class="firmware-route-card" type="button" data-firmware-route="jlink">
            <span class="firmware-route-card-title">JLink</span>
            <span class="firmware-route-card-text">Install path, CPU, interface, speed, base address.</span>
          </button>
          <button class="firmware-route-card" type="button" data-firmware-route="stlink">
            <span class="firmware-route-card-title">ST-Link</span>
            <span class="firmware-route-card-text">CLI path, interface, speed, reset mode, run after program.</span>
          </button>
          <button class="firmware-route-card" type="button" data-firmware-route="openocd">
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
              <div id="fw-jlink-install" class="firmware-config-item-text">Choose the JLink install directory.</div>
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
              <div id="fw-stlink-exe" class="firmware-config-item-text">Choose STM32_Programmer_CLI.exe and the matching flash parameters.</div>
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
              <div id="fw-openocd-exe" class="firmware-config-item-text">Point to openocd.exe before selecting configs.</div>
            </div>
            <button class="btn-secondary btn-compact" type="button" data-firmware-action="pickOpenOcdExePath" data-keil-busy-lock="true">Choose openocd.exe</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Chip Config</div>
              <div id="fw-openocd-target" class="firmware-config-item-text">Choose the target cfg from detected OpenOCD scripts.</div>
            </div>
            <button class="btn-primary btn-compact" type="button" data-firmware-action="pickOpenOcdTarget" data-keil-busy-lock="true">Choose Chip Config</button>
          </div>
          <div class="firmware-config-item">
            <div class="firmware-config-item-copy">
              <div class="firmware-config-item-title">Interface Config</div>
              <div id="fw-openocd-interface" class="firmware-config-item-text">Choose the interface cfg from detected OpenOCD scripts.</div>
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

  <div class="section-block section-block-log">
    <div class="section-heading">
      <span class="section-title">Logs Config</span>
    </div>

    <div class="log-toolbar">
      <input id="log-search" class="log-search-input" type="text" placeholder="Search or filter logs" />
      <button id="btn-freeze" class="btn-secondary btn-compact" type="button">Freeze</button>
      <button id="btn-copy-log" class="btn-secondary btn-compact" type="button">Copy</button>
      <button id="btn-save-log" class="btn-secondary btn-compact" type="button">Save</button>
      <button id="btn-clear" class="btn-secondary btn-compact" type="button">Clear</button>
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
      <div class="options-actions">
        <button id="btn-log-focus-mode" class="status-action-btn options-action-btn" type="button" title="Toggle focus mode">Focus</button>
      </div>
    </div>
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
          <input id="quick-command-value" class="quick-command-input quick-command-value" type="text" placeholder="Command value" />
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

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
