import * as vscode from 'vscode';

const MACHINE_SCOPED_SETTINGS = new Set<string>([
  'keil.uv4Path',
  'keil.armcc5Path',
  'jlink.installDirectory',
  'jlink.device',
  'stlink.exePath',
  'openocd.exePath',
]);

export function resolveSerialAgentConfigurationTarget(key: string): vscode.ConfigurationTarget {
  if (MACHINE_SCOPED_SETTINGS.has(key)) {
    return vscode.ConfigurationTarget.Global;
  }

  return (vscode.workspace.workspaceFolders?.length || 0) > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

export async function updateSerialAgentSetting(
  key: string,
  value: unknown,
): Promise<vscode.ConfigurationTarget> {
  const configuration = vscode.workspace.getConfiguration('serialagent');
  const target = resolveSerialAgentConfigurationTarget(key);
  await configuration.update(key, value, target);
  return target;
}

export function describeConfigurationTarget(target: vscode.ConfigurationTarget): string {
  return target === vscode.ConfigurationTarget.Workspace
    ? 'Workspace Settings'
    : 'User Settings';
}
