import * as vscode from 'vscode';
import { BridgeServer } from './bridge-server';
import { KeilToolchainService } from './keil-toolchain';
import { SerialPanelProvider } from './serial-panel-provider';
import { SerialManager } from './serial-manager';

const serialManager = new SerialManager();
const bridgeOutputChannel = vscode.window.createOutputChannel('Serial Agent Bridge');
const keilOutputChannel = vscode.window.createOutputChannel('Serial Agent Build');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const extensionPkgVersion: string = (require('../package.json') as { version: string }).version;
const bridgeServer = new BridgeServer(serialManager, bridgeOutputChannel, true, extensionPkgVersion);
const keilToolchain = new KeilToolchainService(keilOutputChannel);

let statusBarItem: vscode.StatusBarItem;
let bridgeStatusBarItem: vscode.StatusBarItem;
let bridgeRunning = false;
let keilTaskRunning = false;

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

export function activate(context: vscode.ExtensionContext) {
  bridgeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  bridgeStatusBarItem.command = 'serialagent.toggleBridge';
  updateBridgeStatusBar();
  bridgeStatusBarItem.show();
  context.subscriptions.push(bridgeStatusBarItem);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'serialagent.toggleConnection';
  updateStatusBar(false);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(bridgeOutputChannel);
  context.subscriptions.push(keilOutputChannel);

  const provider = new SerialPanelProvider(context, serialManager, updateStatusBar);

  const withKeilTaskLock = async <T>(
    taskName: string,
    runner: () => Promise<T>,
    revealOutput: boolean,
  ): Promise<T> => {
    if (keilTaskRunning) {
      throw new Error('KEIL_TASK_BUSY: Build/Flash task is running, please wait...');
    }

    keilTaskRunning = true;
    provider.postMessage({ type: 'keilBusy', busy: true, task: taskName });
    if (revealOutput) { keilOutputChannel.show(true); }
    keilOutputChannel.appendLine(`[Serial Agent] ${taskName} started at ${new Date().toLocaleString()}`);

    try {
      const result = await runner();
      keilOutputChannel.appendLine(`[Serial Agent] ${taskName} finished successfully.`);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      keilOutputChannel.appendLine(`[Serial Agent] ${taskName} failed: ${msg}`);
      throw err;
    } finally {
      keilTaskRunning = false;
      provider.postMessage({ type: 'keilBusy', busy: false, task: taskName });
    }
  };

  const runKeilTaskUi = async (taskName: string, runner: () => Promise<void>): Promise<void> => {
    try {
      await withKeilTaskLock(taskName, runner, true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('KEIL_TASK_BUSY')) {
        vscode.window.showWarningMessage('[Serial Agent] Build/Flash task is running, please wait...');
        return;
      }
      vscode.window.showErrorMessage(`[Serial Agent] ${taskName} failed: ${msg}`);
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SerialPanelProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  bridgeServer.setOnUiClear(() => {
    provider.postMessage({ type: 'clearLog' });
  });
  bridgeServer.setKeilApi({
    isBusy: () => keilTaskRunning,
    checkConfig: async () => keilToolchain.checkConfig(),
    build: async () => withKeilTaskLock('Keil Build(API)', () => keilToolchain.build(), false),
    flash: async (artifactPath?: string) => withKeilTaskLock('JLink Flash(API)', () => keilToolchain.flash(artifactPath), false),
    buildAndFlash: async () => withKeilTaskLock('Build + Flash(API)', () => keilToolchain.buildAndFlash(), false),
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

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.refreshPorts', async () => {
      try {
        const ports = await serialManager.listPorts();
        provider.postMessage({ type: 'updatePorts', ports });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`[Serial Agent] Scan failed: ${msg}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.toggleConnection', () => {
      if (serialManager.isConnected) {
        void vscode.commands.executeCommand('serialagent.disconnect');
      } else {
        void vscode.commands.executeCommand('serialagent.serialPanel.focus');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.disconnect', async () => {
      await serialManager.disconnect();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.clearLog', () => {
      serialManager.clearLog();
      serialManager.resetCounters();
      provider.postMessage({ type: 'clearLog' });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.openSettings', () => {
      keilToolchain.openSettings();
    }),
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
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.build', async () => {
      await runKeilTaskUi('Keil Build', async () => {
        const result = await keilToolchain.build();
        vscode.window.showInformationMessage(`[Serial Agent] Build OK: ${result.artifactPath}`);
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.flash', async () => {
      await runKeilTaskUi('JLink Flash', async () => {
        const result = await keilToolchain.flash();
        vscode.window.showInformationMessage(`[Serial Agent] Flash OK: ${result.artifactPath}`);
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.keil.buildAndFlash', async () => {
      await runKeilTaskUi('Build + Flash', async () => {
        const result = await keilToolchain.buildAndFlash();
        vscode.window.showInformationMessage(`[Serial Agent] Build+Flash OK: ${result.artifactPath}`);
      });
    }),
  );

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
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialagent.openInTab', async () => {
      if (provider.panel) {
        provider.panel.reveal(vscode.ViewColumn.Two);
        return;
      }

      const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0;
      if (hasVisibleEditors) {
        await vscode.commands.executeCommand('workbench.action.newGroupRight');
      }

      const panel = vscode.window.createWebviewPanel(
        SerialPanelProvider.panelViewType,
        'Serial Agent',
        hasVisibleEditors ? vscode.ViewColumn.Two : vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        },
      );

      panel.iconPath = {
        light: vscode.Uri.joinPath(context.extensionUri, 'media', 'SerialAgent.png'),
        dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'SerialAgent.png'),
      };

      provider.resolveWebviewPanel(panel);
      panel.onDidDispose(() => {
        provider.clearPanel();
      });
    }),
  );
}

export async function deactivate(): Promise<void> {
  await bridgeServer.stop();
  await serialManager.disconnect();
}
