import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const MACHINE_SCOPED_SETTINGS = new Set<string>([
  'keil.uv4Path',
  'keil.armcc5Path',
  'jlink.installDirectory',
  'jlink.device',
  'stlink.exePath',
  'openocd.exePath',
  'custom.pythonPath',
]);

export function resolveSerialAgentConfigurationTarget(key: string): vscode.ConfigurationTarget {
  if (MACHINE_SCOPED_SETTINGS.has(key)) {
    return vscode.ConfigurationTarget.Global;
  }

  return (vscode.workspace.workspaceFolders?.length || 0) > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function isMissingFile(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'FileNotFound' || /FileNotFound|ENOENT/i.test(message);
}

function isUnregisteredConfigurationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not a registered configuration/i.test(message);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectIndent(text: string): string {
  const match = text.match(/\n([ \t]+)"/);
  return match?.[1] || '    ';
}

function skipWhitespaceAndComments(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i += 1;
      continue;
    }
    if (text.startsWith('//', i)) {
      i += 2;
      while (i < text.length && text[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function consumeJsonValue(text: string, index: number): number {
  const i = skipWhitespaceAndComments(text, index);
  const ch = text[i];
  if (ch === '"') {
    let cursor = i + 1;
    while (cursor < text.length) {
      if (text[cursor] === '\\') {
        cursor += 2;
        continue;
      }
      if (text[cursor] === '"') {
        return cursor + 1;
      }
      cursor += 1;
    }
    throw new Error('Unterminated string in settings.json');
  }
  if (ch === '{' || ch === '[') {
    const close = ch === '{' ? '}' : ']';
    let cursor = i + 1;
    let depth = 1;
    while (cursor < text.length && depth > 0) {
      const current = text[cursor];
      if (current === '"') {
        cursor = consumeJsonValue(text, cursor);
        continue;
      }
      if (current === ch) {
        depth += 1;
      } else if (current === close) {
        depth -= 1;
      }
      cursor += 1;
    }
    return cursor;
  }

  const match = text.slice(i).match(/^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
  if (!match) {
    throw new Error('Unable to parse a settings.json value.');
  }
  return i + match[0].length;
}

function insertCommaIfNeeded(beforeClose: string): string {
  const open = beforeClose.indexOf('{');
  if (open < 0) {
    return beforeClose;
  }
  if (!beforeClose.slice(open + 1).trim()) {
    return beforeClose;
  }

  let i = beforeClose.length - 1;
  while (i >= 0 && /\s/.test(beforeClose[i])) {
    i -= 1;
  }
  if (i < 0 || beforeClose[i] === ',' || beforeClose[i] === '{') {
    return beforeClose;
  }
  return `${beforeClose.slice(0, i + 1)},${beforeClose.slice(i + 1)}`;
}

export function upsertJsoncProperty(text: string, key: string, value: unknown): string {
  const serialized = JSON.stringify(value);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = detectIndent(text);
  const trimmed = text.trim();
  if (!trimmed) {
    return `{${newline}${indent}"${key}": ${serialized}${newline}}${newline}`;
  }

  const keyPattern = new RegExp(`"${escapeRegExp(key)}"\\s*:`);
  const existing = keyPattern.exec(text);
  if (existing) {
    const valueStart = skipWhitespaceAndComments(text, existing.index + existing[0].length);
    const valueEnd = consumeJsonValue(text, valueStart);
    return `${text.slice(0, valueStart)}${serialized}${text.slice(valueEnd)}`;
  }

  const close = text.lastIndexOf('}');
  if (close < 0) {
    return `{${newline}${indent}"${key}": ${serialized}${newline}}${newline}`;
  }

  const withComma = insertCommaIfNeeded(text.slice(0, close));
  const needsNewline = !/\r?\n\s*$/.test(withComma);
  return `${withComma}${needsNewline ? newline : ''}${indent}"${key}": ${serialized}${newline}${text.slice(close)}`;
}

function parseJsoncObject(text: string): Record<string, unknown> {
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '');
  const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, '$1');
  const trimmed = withoutTrailingCommas.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export function readWorkspaceSerialAgentValue<T>(key: string): T | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }

  const settingsPath = path.join(folder.uri.fsPath, '.vscode', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return undefined;
  }

  try {
    const parsed = parseJsoncObject(fs.readFileSync(settingsPath, 'utf8'));
    const fullKey = `serialagent.${key}`;
    if (!Object.prototype.hasOwnProperty.call(parsed, fullKey)) {
      return undefined;
    }
    return parsed[fullKey] as T;
  } catch {
    return undefined;
  }
}

export function getSerialAgentSetting<T>(key: string, fallback: T): T {
  const fromWorkspace = readWorkspaceSerialAgentValue<T>(key);
  if (fromWorkspace !== undefined) {
    return fromWorkspace;
  }
  return vscode.workspace.getConfiguration('serialagent').get<T>(key, fallback);
}

async function readSettingsFile(uri: vscode.Uri): Promise<string> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return '';
    }
    throw error;
  }
}

async function writeWorkspaceSetting(fullKey: string, value: unknown): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Open a workspace folder before saving Serial Agent settings.');
  }

  const vscodeDir = vscode.Uri.joinPath(folder.uri, '.vscode');
  const settingsUri = vscode.Uri.joinPath(vscodeDir, 'settings.json');
  await vscode.workspace.fs.createDirectory(vscodeDir);
  const next = upsertJsoncProperty(await readSettingsFile(settingsUri), fullKey, value);
  await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(next, 'utf8'));
}

export async function updateSerialAgentSetting(
  key: string,
  value: unknown,
): Promise<vscode.ConfigurationTarget> {
  const configuration = vscode.workspace.getConfiguration('serialagent');
  const target = resolveSerialAgentConfigurationTarget(key);
  const fullKey = `serialagent.${key}`;

  if (target === vscode.ConfigurationTarget.Workspace) {
    await writeWorkspaceSetting(fullKey, value);
    return target;
  }

  try {
    await configuration.update(key, value, target);
    return target;
  } catch (error: unknown) {
    if (isUnregisteredConfigurationError(error) && (vscode.workspace.workspaceFolders?.length || 0) > 0) {
      await writeWorkspaceSetting(fullKey, value);
      return vscode.ConfigurationTarget.Workspace;
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export function describeConfigurationTarget(target: vscode.ConfigurationTarget): string {
  return target === vscode.ConfigurationTarget.Workspace
    ? 'Workspace Settings'
    : 'User Settings';
}
