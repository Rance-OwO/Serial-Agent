import * as vscode from 'vscode';
import {
  portPathsFingerprint,
  portsContentFingerprint,
  type SerialRuntime,
} from './serial-manager';
import type { PortInfo } from './types';

export interface PortAutoRefreshConfig {
  enabled: boolean;
  intervalMs: number;
  metadataIntervalMs: number;
}

export function readPortAutoRefreshConfig(): PortAutoRefreshConfig {
  const config = vscode.workspace.getConfiguration('serialagent');
  return {
    enabled: config.get<boolean>('portAutoRefresh', true),
    intervalMs: Math.min(
      30_000,
      Math.max(1_000, config.get<number>('portRefreshIntervalMs', 3_000)),
    ),
    metadataIntervalMs: Math.max(
      5_000,
      config.get<number>('portRefreshMetadataIntervalMs', 30_000),
    ),
  };
}

export class PortAutoRefresh implements vscode.Disposable {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _visible = false;
  private _lastPathsFingerprint = '';
  private _lastContentFingerprint = '';
  private _lastFullMetadataAt = 0;
  private _refreshInFlight = false;

  constructor(
    private readonly _serialManager: SerialRuntime,
    private readonly _onPortsChanged: (ports: PortInfo[]) => void,
  ) {}

  dispose(): void {
    this.stop();
  }

  onVisibilityChange(visible: boolean): void {
    this._visible = visible;
    if (visible) {
      const cfg = readPortAutoRefreshConfig();
      if (cfg.enabled) {
        void this.refreshOnce({ forceFull: true }).then((ports) => {
          if (ports) {
            this._onPortsChanged(ports);
          }
        });
        this.start();
      }
      return;
    }
    this.stop();
  }

  handleConfigChange(): void {
    if (this._visible) {
      this.start();
    }
  }

  syncFingerprints(ports: PortInfo[]): void {
    this._lastPathsFingerprint = portPathsFingerprint(ports);
    this._lastContentFingerprint = portsContentFingerprint(ports);
    this._lastFullMetadataAt = Date.now();
  }

  async refreshOnce(options?: { forceFull?: boolean }): Promise<PortInfo[] | null> {
    if (this._refreshInFlight) {
      return null;
    }

    this._refreshInFlight = true;
    try {
      const cfg = readPortAutoRefreshConfig();
      let ports: PortInfo[];

      if (options?.forceFull) {
        ports = await this._serialManager.listPorts({
          metadata: 'full',
          forceMetadata: true,
        });
        this._lastFullMetadataAt = Date.now();
      } else {
        const quickPorts = await this._serialManager.listPorts({ metadata: 'skip' });
        const pathsFingerprint = portPathsFingerprint(quickPorts);
        const pathsChanged = pathsFingerprint !== this._lastPathsFingerprint;
        const metadataStale = Date.now() - this._lastFullMetadataAt >= cfg.metadataIntervalMs;

        if (!pathsChanged && !metadataStale) {
          return null;
        }

        ports = await this._serialManager.listPorts({
          metadata: 'full',
          forceMetadata: pathsChanged,
        });
        this._lastFullMetadataAt = Date.now();
      }

      const contentFingerprint = portsContentFingerprint(ports);
      if (options?.forceFull || contentFingerprint !== this._lastContentFingerprint) {
        this._lastPathsFingerprint = portPathsFingerprint(ports);
        this._lastContentFingerprint = contentFingerprint;
        return ports;
      }

      return null;
    } catch {
      return null;
    } finally {
      this._refreshInFlight = false;
    }
  }

  start(): void {
    const cfg = readPortAutoRefreshConfig();
    if (!cfg.enabled || !this._visible) {
      this.stop();
      return;
    }

    if (this._timer) {
      clearInterval(this._timer);
    }

    this._timer = setInterval(() => {
      void this._tick();
    }, cfg.intervalMs);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _tick(): Promise<void> {
    const ports = await this.refreshOnce();
    if (ports) {
      this._onPortsChanged(ports);
    }
  }
}
