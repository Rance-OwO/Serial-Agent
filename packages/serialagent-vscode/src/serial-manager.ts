import { execFile } from 'child_process';
import { PortInfo, SerialConfig, DEFAULT_CONFIG, ISerialManager } from './types';

type SerialPortClass = import('serialport').SerialPort;
type SerialPortStatic = typeof import('serialport').SerialPort;

let cachedSerialPort: SerialPortStatic | null = null;
let serialportError: string | null = null;

const MAX_LOG_LINES = 5000;
const MAX_RX_BUFFER = 1024 * 1024;
const RECONNECT_INTERVAL_MS = 2000;
const PORT_METADATA_TIMEOUT_MS = 3000;

interface RawSerialPortInfo {
  path: string;
  manufacturer?: string;
  productId?: string;
  vendorId?: string;
  serialNumber?: string;
  pnpId?: string;
}

interface WindowsPortMetadata {
  path: string;
  friendlyName?: string;
  driverLabel?: string;
  pnpId?: string;
}

export interface SerialManagerCallbacks {
  onLog: (text: string) => void;
  onStatus: (connected: boolean, portPath?: string, baudRate?: number) => void;
  onError: (msg: string) => void;
  onCounterUpdate?: (rx: number, tx: number) => void;
}

export interface SerialRuntime extends ISerialManager {
  setCallbacks(opts: SerialManagerCallbacks): void;
  updateSettings(partial: Partial<SerialConfig>): void;
}

function requireSerialPort(): SerialPortStatic | null {
  if (cachedSerialPort) { return cachedSerialPort; }
  if (serialportError) { return null; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sp = require('serialport') as { SerialPort: SerialPortStatic };
    cachedSerialPort = sp.SerialPort;
    return cachedSerialPort;
  } catch (error: unknown) {
    serialportError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export class SerialManager implements SerialRuntime {
  private _port: SerialPortClass | null = null;
  private _logBuffer: string[] = [];
  private _rxBuffer: Buffer = Buffer.alloc(0);
  private _config: SerialConfig = { ...DEFAULT_CONFIG };

  private _rxBytes = 0;
  private _txBytes = 0;

  private _onLog: ((text: string) => void) | null = null;
  private _onStatus: ((connected: boolean, portPath?: string, baudRate?: number) => void) | null = null;
  private _onError: ((msg: string) => void) | null = null;
  private _onCounterUpdate: ((rx: number, tx: number) => void) | null = null;

  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _autoReconnect = false;
  private _reconnecting = false;
  private _lastConfig: SerialConfig | null = null;

  private _newLogSubscribers: Array<(line: string) => void> = [];

  setCallbacks(opts: SerialManagerCallbacks): void {
    this._onLog = opts.onLog;
    this._onStatus = opts.onStatus;
    this._onError = opts.onError;
    this._onCounterUpdate = opts.onCounterUpdate ?? null;
  }

  async listPorts(): Promise<PortInfo[]> {
    const serialPort = requireSerialPort();
    if (!serialPort) {
      throw new Error(
        `serialport native module load failed: ${serialportError}\nPlease check extension is properly installed (with prebuilt binaries)`,
      );
    }
    const ports = await serialPort.list() as RawSerialPortInfo[];
    const windowsMetadata = await loadWindowsPortMetadata();

    return ports.map((port) => {
      const metadata = windowsMetadata.get(port.path.toUpperCase());
      return {
        path: port.path,
        manufacturer: port.manufacturer,
        productId: port.productId,
        vendorId: port.vendorId,
        serialNumber: port.serialNumber,
        pnpId: port.pnpId ?? metadata?.pnpId,
        friendlyName: metadata?.friendlyName,
        driverLabel: metadata?.driverLabel,
      };
    });
  }

  async connect(config: SerialConfig): Promise<boolean> {
    this._stopReconnect();
    if (this._port?.isOpen) { await this.disconnect(); }

    this._config = { ...config };
    this._lastConfig = { ...config };

    return new Promise<boolean>((resolve) => {
      try {
        const serialPort = requireSerialPort();
        if (!serialPort) {
          this._onError?.(`serialport native module load failed: ${serialportError}`);
          this._onStatus?.(false);
          resolve(false);
          return;
        }

        this._port = new serialPort({
          path: config.port,
          baudRate: config.baudRate,
          dataBits: config.dataBits,
          stopBits: config.stopBits,
          parity: config.parity,
          autoOpen: false,
        });

        this._port.on('data', (chunk: Buffer) => {
          this._rxBytes += chunk.length;
          this._onCounterUpdate?.(this._rxBytes, this._txBytes);
          this._processReceivedData(chunk);
        });

        this._port.on('error', (err: Error) => {
          this._onError?.(err.message);
        });

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
        const message = err instanceof Error ? err.message : String(err);
        this._onError?.(`Connect error: ${message}`);
        this._cleanupPort();
        this._onStatus?.(false);
        resolve(false);
      }
    });
  }

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

  async send(data: string, hexMode: boolean, lineEnding: string): Promise<boolean> {
    if (!this._port?.isOpen) { return false; }

    let buffer: Buffer;
    if (hexMode) {
      const hexStr = data.replace(/\s+/g, '');
      if (!hexStr.length || !/^[0-9a-fA-F]*$/.test(hexStr) || hexStr.length % 2 !== 0) {
        this._onError?.('Invalid HEX format (e.g. "41 42 0D 0A")');
        return false;
      }
      buffer = Buffer.from(hexStr, 'hex');
    } else {
      const trimmed = data.replace(/\r?\n/g, '');
      if (!trimmed.length) { return false; }
      const suffixes: Record<string, string> = { lf: '\n', crlf: '\r\n', cr: '\r', none: '' };
      buffer = Buffer.from(data + (suffixes[lineEnding] ?? '\n'), 'utf8');
    }

    return new Promise<boolean>((resolve) => {
      this._port!.write(buffer, (err) => {
        if (err) {
          this._onError?.(err.message);
          resolve(false);
          return;
        }
        this._txBytes += buffer.length;
        this._onCounterUpdate?.(this._rxBytes, this._txBytes);
        resolve(true);
      });
    });
  }

  updateSettings(partial: Partial<SerialConfig>): void {
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

  injectLog(line: string): void {
    this._appendLogLine(line);
  }

  onNewLog(callback: (line: string) => void): void {
    this._newLogSubscribers.push(callback);
  }

  offNewLog(callback: (line: string) => void): void {
    const idx = this._newLogSubscribers.indexOf(callback);
    if (idx !== -1) { this._newLogSubscribers.splice(idx, 1); }
  }

  private _appendLogLine(line: string): void {
    this._logBuffer.push(line);
    if (this._logBuffer.length > MAX_LOG_LINES) { this._logBuffer.shift(); }
    this._onLog?.(line + '\n');
    for (const callback of this._newLogSubscribers) {
      callback(line);
    }
  }

  private _processReceivedData(chunk: Buffer): void {
    if (this._config.hexMode) {
      const hex = Array.from(chunk)
        .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');

      let line = hex;
      if (this._config.showTimestamp) {
        const now = new Date();
        const ts = `[${now.toTimeString().split(' ')[0]}.${String(now.getMilliseconds()).padStart(3, '0')}]`;
        line = `${ts} ${hex}`;
      }
      this._appendLogLine(line);
      return;
    }

    this._rxBuffer = Buffer.concat([this._rxBuffer, chunk]);
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

      if (this._config.showTimestamp) {
        const now = new Date();
        const ts = `[${now.toTimeString().split(' ')[0]}.${String(now.getMilliseconds()).padStart(3, '0')}]`;
        text = `${ts} ${text}`;
      }

      this._appendLogLine(text);
    }
  }

  private _cleanupPort(): void {
    if (this._port) {
      this._port.removeAllListeners();
      this._port = null;
    }
    this._rxBuffer = Buffer.alloc(0);
  }

  private _startReconnect(): void {
    if (this._reconnectTimer || this._reconnecting) { return; }
    this._onError?.('Connection lost, attempting to reconnect...');
    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (!this._autoReconnect || !this._lastConfig) { return; }
      this._reconnecting = true;
      try {
        const ports = await this.listPorts();
        if (ports.some((port) => port.path === this._lastConfig!.port)) {
          const ok = await this.connect(this._lastConfig!);
          if (ok) {
            this._onLog?.('[Serial Agent] Reconnected successfully\n');
            this._reconnecting = false;
            return;
          }
        }
      } catch {
        // Keep trying on the next reconnect tick.
      }
      this._reconnecting = false;
      if (this._autoReconnect && this._lastConfig) {
        this._scheduleReconnect();
      }
    }, RECONNECT_INTERVAL_MS);
  }

  private _stopReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnecting = false;
  }
}

async function loadWindowsPortMetadata(): Promise<Map<string, WindowsPortMetadata>> {
  if (process.platform !== 'win32') {
    return new Map();
  }

  const powershell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe';
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$items = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match "\\((COM\\d+)\\)" } | ForEach-Object {',
    '  [pscustomobject]@{',
    '    path = $Matches[1].ToUpper()',
    '    friendlyName = $_.Name',
    '    driverLabel = ($_.Name -replace "\\s*\\(COM\\d+\\)\\s*$", "").Trim()',
    '    pnpId = $_.PNPDeviceID',
    '  }',
    '}',
    '$items | ConvertTo-Json -Compress',
  ].join('; ');

  const stdout = await new Promise<string>((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: PORT_METADATA_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, output) => {
        if (error || !output) {
          resolve('');
          return;
        }
        resolve(output.trim());
      },
    );
  });

  if (!stdout) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(stdout) as WindowsPortMetadata | WindowsPortMetadata[];
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return new Map(
      items
        .filter((item) => typeof item.path === 'string' && item.path.length > 0)
        .map((item) => [item.path.toUpperCase(), item]),
    );
  } catch {
    return new Map();
  }
}
