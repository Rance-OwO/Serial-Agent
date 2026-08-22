import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import iconv from 'iconv-lite';

export type CustomCommandMode = 'python' | 'command';

export interface CustomCommandConfig {
  mode: CustomCommandMode;
  pythonPath: string;
  script: string;
  command: string;
}

export interface CustomCommandHost {
  workspaceRoot?: string;
  isTrusted: boolean;
  platform?: NodeJS.Platform;
  pathExists(filePath: string): boolean;
  isDirectory(filePath: string): boolean;
  resolvePath(...parts: string[]): string;
  isAbsolute(filePath: string): boolean;
  comSpec?: string;
}

export interface CustomCommandCheckItem {
  key: string;
  ok: boolean;
  message: string;
  value?: string;
}

export interface CustomCommandResolution {
  executable: string;
  argv: string[];
  cwd: string;
  preview: string;
  windowsVerbatimArguments?: boolean;
}

export interface CustomCommandResolveResult {
  ready: boolean;
  checks: CustomCommandCheckItem[];
  resolution?: CustomCommandResolution;
}

export interface CustomCommandRunResult {
  success: boolean;
  preview: string;
  cwd: string;
  exitCode: number;
}

export interface CustomCommandOutput {
  append(value: string): void;
  appendLine(value: string): void;
}

const WINDOWS_CODE_PAGE_ENCODINGS: Record<string, string> = {
  '65001': 'utf8',
  '1200': 'utf16le',
  '1201': 'utf16-be',
};

export function mapWindowsCodePageToEncoding(codePage?: string): string {
  if (!codePage) {
    return 'utf8';
  }
  const mapped = WINDOWS_CODE_PAGE_ENCODINGS[codePage] || `cp${codePage}`;
  return iconv.encodingExists(mapped) ? mapped : 'utf8';
}

type CodePageProbe = typeof spawnSync;

export function detectWindowsCodePage(
  comSpec = process.env.ComSpec || 'cmd.exe',
  run: CodePageProbe = spawnSync,
): string | undefined {
  const result = run(comSpec, ['/d', '/c', 'chcp'], {
    windowsHide: true,
    encoding: 'buffer',
  });
  if (result.error) {
    return undefined;
  }
  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout.toString('ascii')
    : `${result.stdout ?? ''}`;
  return stdout.match(/(\d{3,5})/)?.[1];
}

export function resolveCustomCommandOutputEncoding(
  platform: NodeJS.Platform = process.platform,
  codePage?: string,
): string {
  if (platform !== 'win32') {
    return 'utf8';
  }
  return mapWindowsCodePageToEncoding(codePage);
}

let cachedWindowsOutputEncoding: string | undefined;

function resolveSpawnOutputEncoding(): string {
  if (process.platform !== 'win32') {
    return 'utf8';
  }
  if (!cachedWindowsOutputEncoding) {
    cachedWindowsOutputEncoding = resolveCustomCommandOutputEncoding('win32', detectWindowsCodePage());
  }
  return cachedWindowsOutputEncoding;
}

function stripWrappedQuotes(input: string): string {
  const trimmed = input.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function normalizeCustomMode(value: unknown): CustomCommandMode {
  return value === 'command' ? 'command' : 'python';
}

export function formatCustomCommandPreview(executable: string, argv: string[]): string {
  return [executable, ...argv]
    .map((token) => quoteForPreview(token))
    .join(' ')
    .trim();
}

function quoteForPreview(token: string): string {
  if (!token) {
    return '""';
  }
  if (/[\s"]/.test(token)) {
    return `"${token.replace(/"/g, '\\"')}"`;
  }
  return token;
}

function resolveConfiguredPath(
  rawValue: string,
  workspaceRoot: string | undefined,
  host: Pick<CustomCommandHost, 'resolvePath' | 'isAbsolute'>,
): string {
  const value = stripWrappedQuotes(rawValue.trim());
  if (!value) {
    return '';
  }
  if (host.isAbsolute(value)) {
    return host.resolvePath(value);
  }
  if (!workspaceRoot) {
    return value;
  }
  return host.resolvePath(workspaceRoot, value);
}

function pushTrustCheck(checks: CustomCommandCheckItem[], host: CustomCommandHost): void {
  if (!host.isTrusted) {
    checks.push({
      key: 'custom.workspaceTrust',
      ok: false,
      message: 'Trust this workspace before running a custom command.',
    });
    return;
  }
  checks.push({
    key: 'custom.workspaceTrust',
    ok: true,
    message: 'Workspace is trusted',
  });
}

function resolveWorkspaceCwd(checks: CustomCommandCheckItem[], host: CustomCommandHost): string {
  if (!host.workspaceRoot) {
    checks.push({
      key: 'custom.cwd',
      ok: false,
      message: 'Open a workspace folder before running a custom command.',
    });
    return '';
  }

  const cwd = host.resolvePath(host.workspaceRoot);
  checks.push({
    key: 'custom.cwd',
    ok: true,
    message: 'Using workspace root',
    value: cwd,
  });
  return cwd;
}

function resolvePythonMode(
  config: CustomCommandConfig,
  host: CustomCommandHost,
  checks: CustomCommandCheckItem[],
): CustomCommandResolution | undefined {
  const pythonRaw = stripWrappedQuotes(config.pythonPath.trim());
  const scriptRaw = stripWrappedQuotes(config.script.trim());

  let pythonPath = pythonRaw;
  if (!pythonRaw) {
    checks.push({
      key: 'custom.pythonPath',
      ok: false,
      message: 'Choose a Python interpreter, such as a uv venv python.exe.',
    });
  } else {
    pythonPath = resolveConfiguredPath(pythonRaw, host.workspaceRoot, host);
    if (!host.pathExists(pythonPath) || host.isDirectory(pythonPath)) {
      checks.push({
        key: 'custom.pythonPath',
        ok: false,
        message: 'Python interpreter was not found.',
        value: pythonPath,
      });
    } else {
      checks.push({
        key: 'custom.pythonPath',
        ok: true,
        message: 'Python interpreter found',
        value: pythonPath,
      });
    }
  }

  let scriptPath = '';
  if (!scriptRaw) {
    checks.push({
      key: 'custom.script',
      ok: false,
      message: 'Choose a Python script.',
    });
  } else if (!host.workspaceRoot && !host.isAbsolute(scriptRaw)) {
    checks.push({
      key: 'custom.script',
      ok: false,
      message: 'Open a workspace folder before using a relative script path.',
      value: scriptRaw,
    });
  } else {
    scriptPath = resolveConfiguredPath(scriptRaw, host.workspaceRoot, host);
    if (!host.pathExists(scriptPath) || host.isDirectory(scriptPath)) {
      checks.push({
        key: 'custom.script',
        ok: false,
        message: 'Python script was not found.',
        value: scriptPath,
      });
    } else if (path.extname(scriptPath).toLowerCase() !== '.py') {
      checks.push({
        key: 'custom.script',
        ok: false,
        message: 'Choose a .py script for Python mode.',
        value: scriptPath,
      });
    } else {
      checks.push({
        key: 'custom.script',
        ok: true,
        message: 'Python script found',
        value: scriptPath,
      });
    }
  }

  const cwd = resolveWorkspaceCwd(checks, host);
  if (checks.some((item) => !item.ok)) {
    return undefined;
  }

  return {
    executable: pythonPath,
    argv: [scriptPath],
    cwd,
    preview: formatCustomCommandPreview(pythonPath, [scriptPath]),
  };
}

function resolveCommandMode(
  config: CustomCommandConfig,
  host: CustomCommandHost,
  checks: CustomCommandCheckItem[],
): CustomCommandResolution | undefined {
  const command = config.command.trim();
  const platform = host.platform ?? process.platform;

  if (!command) {
    checks.push({
      key: 'custom.command',
      ok: false,
      message: 'Enter a custom command.',
    });
  } else {
    checks.push({
      key: 'custom.command',
      ok: true,
      message: 'Command entered',
      value: command,
    });
  }

  const cwd = resolveWorkspaceCwd(checks, host);
  if (checks.some((item) => !item.ok)) {
    return undefined;
  }

  if (platform === 'win32') {
    const executable = host.comSpec || process.env.ComSpec || 'cmd.exe';
    return {
      executable,
      argv: ['/d', '/s', '/c', `"${command}"`],
      cwd,
      preview: command,
      windowsVerbatimArguments: true,
    };
  }

  return {
    executable: '/bin/sh',
    argv: ['-lc', command],
    cwd,
    preview: command,
  };
}

export function resolveCustomCommand(
  config: CustomCommandConfig,
  host: CustomCommandHost,
): CustomCommandResolveResult {
  const checks: CustomCommandCheckItem[] = [];
  const mode = normalizeCustomMode(config.mode);
  pushTrustCheck(checks, host);

  const resolution = mode === 'command'
    ? resolveCommandMode(config, host, checks)
    : resolvePythonMode(config, host, checks);

  if (!resolution || checks.some((item) => !item.ok)) {
    return { ready: false, checks };
  }

  return { ready: true, checks, resolution };
}

export function createFileSystemHost(options: {
  workspaceRoot?: string;
  isTrusted: boolean;
  platform?: NodeJS.Platform;
}): CustomCommandHost {
  return {
    workspaceRoot: options.workspaceRoot,
    isTrusted: options.isTrusted,
    platform: options.platform,
    pathExists: (filePath: string) => fs.existsSync(filePath),
    isDirectory: (filePath: string) => {
      try {
        return fs.statSync(filePath).isDirectory();
      } catch {
        return false;
      }
    },
    resolvePath: (...parts: string[]) => path.resolve(...parts),
    isAbsolute: (filePath: string) => path.isAbsolute(filePath),
    comSpec: process.env.ComSpec,
  };
}

export function readCustomCommandConfig(
  getValue: <T>(key: string, defaultValue: T) => T,
): CustomCommandConfig {
  return {
    mode: normalizeCustomMode(getValue<string>('custom.mode', 'python')),
    pythonPath: getValue<string>('custom.pythonPath', ''),
    script: getValue<string>('custom.script', ''),
    command: getValue<string>('custom.command', ''),
  };
}

export class CustomCommandService {
  constructor(
    private readonly output: CustomCommandOutput,
    private readonly runProcess: (
      command: string,
      args: string[],
      cwd: string,
      options?: { windowsVerbatimArguments?: boolean },
    ) => Promise<number> = (command, args, cwd, options) => this.spawnProcess(command, args, cwd, options),
  ) {}

  resolve(config: CustomCommandConfig, host: CustomCommandHost): CustomCommandResolveResult {
    return resolveCustomCommand(config, host);
  }

  async run(config: CustomCommandConfig, host: CustomCommandHost): Promise<CustomCommandRunResult> {
    const resolved = resolveCustomCommand(config, host);
    if (!resolved.ready || !resolved.resolution) {
      const firstIssue = resolved.checks.find((item) => !item.ok)?.message || 'Custom command is not configured.';
      throw new Error(firstIssue);
    }

    const { executable, argv, cwd, preview, windowsVerbatimArguments } = resolved.resolution;
    this.output.appendLine(`[Custom] ${preview}`);
    this.output.appendLine(`[Custom] cwd: ${cwd}`);
    const exitCode = await this.runProcess(executable, argv, cwd, { windowsVerbatimArguments });
    if (exitCode !== 0) {
      throw new Error(`Custom command failed with exit code ${exitCode}: ${preview}`);
    }

    this.output.appendLine('[Custom] Done (exit code 0)');
    return {
      success: true,
      preview,
      cwd,
      exitCode,
    };
  }

  private spawnProcess(
    command: string,
    args: string[],
    cwd: string,
    options?: { windowsVerbatimArguments?: boolean },
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const encoding = resolveSpawnOutputEncoding();
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: options?.windowsVerbatimArguments === true,
      });

      const stdoutDecoder = iconv.getDecoder(encoding);
      const stderrDecoder = iconv.getDecoder(encoding);
      let stdoutFlushed = false;
      let stderrFlushed = false;
      const appendDecoded = (text: string | undefined) => {
        if (text) {
          this.output.append(text);
        }
      };
      const flushStdout = () => {
        if (stdoutFlushed) {
          return;
        }
        stdoutFlushed = true;
        appendDecoded(stdoutDecoder.end());
      };
      const flushStderr = () => {
        if (stderrFlushed) {
          return;
        }
        stderrFlushed = true;
        appendDecoded(stderrDecoder.end());
      };

      child.stdout.on('data', (chunk: Buffer) => {
        appendDecoded(stdoutDecoder.write(chunk));
      });
      child.stderr.on('data', (chunk: Buffer) => {
        appendDecoded(stderrDecoder.write(chunk));
      });
      child.stdout.on('end', () => {
        flushStdout();
      });
      child.stderr.on('end', () => {
        flushStderr();
      });
      child.on('error', (error) => {
        reject(error);
      });
      child.on('close', (code) => {
        flushStdout();
        flushStderr();
        resolve(code ?? 1);
      });
    });
  }
}
