import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  detectWindowsCodePage,
  formatCustomCommandPreview,
  mapWindowsCodePageToEncoding,
  resolveCustomCommand,
  resolveCustomCommandOutputEncoding,
} from '../packages/serialagent-vscode/src/custom-command';

function posixResolve(...parts: string[]): string {
  return path.posix.resolve(...parts.map((part) => part.replace(/\\/g, '/')));
}

describe('CustomCommandService.run', () => {
  it('rejects non-zero exit codes', async () => {
    const { CustomCommandService } = await import('../packages/serialagent-vscode/src/custom-command');
    const workspaceRoot = path.resolve('/workspace');
    const python = path.resolve('/tools/python');
    const script = path.join(workspaceRoot, 'tools', 'flash.py');
    const service = new CustomCommandService(
      { append: () => undefined, appendLine: () => undefined },
      async () => 7,
    );

    await expect(service.run({
      mode: 'python',
      pythonPath: python,
      script: 'tools/flash.py',
      command: '',
    }, {
      workspaceRoot,
      isTrusted: true,
      pathExists: (filePath) => [python, script, workspaceRoot].includes(path.resolve(filePath)),
      isDirectory: (filePath) => path.resolve(filePath) === workspaceRoot,
      resolvePath: (...parts) => path.resolve(...parts),
      isAbsolute: (filePath) => path.isAbsolute(filePath),
    })).rejects.toThrow(/exit code 7/);
  });
});

describe('resolveCustomCommand', () => {
  const workspaceRoot = path.resolve('/workspace');
  const python = path.resolve('/tools/.venv/Scripts/python.exe');
  const script = path.join(workspaceRoot, 'tools', 'flash.py');
  const existing = new Set([python, script, workspaceRoot]);

  const host = {
    workspaceRoot,
    isTrusted: true,
    pathExists: (filePath: string) => existing.has(path.resolve(filePath)),
    isDirectory: (filePath: string) => path.resolve(filePath) === workspaceRoot,
    resolvePath: (...parts: string[]) => path.resolve(...parts),
    isAbsolute: (filePath: string) => path.isAbsolute(filePath),
    comSpec: 'C:\\Windows\\System32\\cmd.exe',
  };

  it('runs python mode as interpreter plus script', () => {
    const result = resolveCustomCommand({
      mode: 'python',
      pythonPath: python,
      script: 'tools/flash.py',
      command: 'echo unused',
    }, host);

    expect(result.ready).toBe(true);
    expect(result.resolution?.executable).toBe(python);
    expect(result.resolution?.argv).toEqual([script]);
    expect(result.resolution?.cwd).toBe(workspaceRoot);
    expect(result.resolution?.preview).toBe(formatCustomCommandPreview(python, [script]));
  });

  it('fails python mode without an interpreter', () => {
    const result = resolveCustomCommand({
      mode: 'python',
      pythonPath: '',
      script: 'tools/flash.py',
      command: '',
    }, host);

    expect(result.ready).toBe(false);
    expect(result.checks.some((item) => item.key === 'custom.pythonPath' && !item.ok)).toBe(true);
  });

  it('fails python mode without a .py script', () => {
    const result = resolveCustomCommand({
      mode: 'python',
      pythonPath: python,
      script: '',
      command: '',
    }, host);

    expect(result.ready).toBe(false);
    expect(result.checks.some((item) => item.key === 'custom.script' && !item.ok)).toBe(true);
  });

  it('runs command mode through cmd.exe on Windows', () => {
    const command = '"D:\\Software\\Keil_v5\\UV4\\UV4.exe" -j0 -b demo.uvprojx && echo done';
    const result = resolveCustomCommand({
      mode: 'command',
      pythonPath: '',
      script: '',
      command,
    }, { ...host, platform: 'win32' });

    expect(result.ready).toBe(true);
    expect(result.resolution?.executable).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(result.resolution?.argv).toEqual(['/d', '/s', '/c', `"${command}"`]);
    expect(result.resolution?.windowsVerbatimArguments).toBe(true);
    expect(result.resolution?.preview).toBe(command);
  });

  it('wraps a quoted .cmd path so cmd.exe /s /c can run it', () => {
    const command = '"d:\\_Code\\Serial Agent\\_KeilProject\\freertos_hello\\Tool\\build-and-flash.cmd"';
    const result = resolveCustomCommand({
      mode: 'command',
      pythonPath: '',
      script: '',
      command,
    }, { ...host, platform: 'win32' });

    expect(result.resolution?.argv).toEqual(['/d', '/s', '/c', `"${command}"`]);
  });

  it('runs command mode through sh on posix', () => {
    const command = 'uv run python tools/flash.py';
    const result = resolveCustomCommand({
      mode: 'command',
      pythonPath: '',
      script: '',
      command,
    }, {
      workspaceRoot: '/home/dev/fw',
      isTrusted: true,
      platform: 'linux',
      pathExists: (filePath: string) => filePath === posixResolve('/home/dev/fw'),
      isDirectory: (filePath: string) => filePath === posixResolve('/home/dev/fw'),
      resolvePath: posixResolve,
      isAbsolute: path.posix.isAbsolute,
    });

    expect(result.ready).toBe(true);
    expect(result.resolution?.executable).toBe('/bin/sh');
    expect(result.resolution?.argv).toEqual(['-lc', command]);
    expect(result.resolution?.preview).toBe(command);
  });

  it('fails command mode when the command is empty', () => {
    const result = resolveCustomCommand({
      mode: 'command',
      pythonPath: python,
      script: 'tools/flash.py',
      command: '   ',
    }, host);

    expect(result.ready).toBe(false);
    expect(result.checks.some((item) => item.key === 'custom.command' && !item.ok)).toBe(true);
  });

  it('fails when the workspace is not trusted', () => {
    const result = resolveCustomCommand({
      mode: 'python',
      pythonPath: python,
      script: 'tools/flash.py',
      command: '',
    }, { ...host, isTrusted: false });

    expect(result.ready).toBe(false);
    expect(result.checks.some((item) => item.key === 'custom.workspaceTrust' && !item.ok)).toBe(true);
  });
});

describe('custom command output encoding', () => {
  it('maps the active Windows code page to iconv-lite', () => {
    expect(mapWindowsCodePageToEncoding('936')).toBe('cp936');
    expect(mapWindowsCodePageToEncoding('65001')).toBe('utf8');
    expect(mapWindowsCodePageToEncoding()).toBe('utf8');
  });

  it('keeps posix custom-command output as UTF-8', () => {
    expect(resolveCustomCommandOutputEncoding('linux', '936')).toBe('utf8');
    expect(resolveCustomCommandOutputEncoding('win32', '936')).toBe('cp936');
  });

  it('reads the numeric code page from chcp output', () => {
    const codePage = detectWindowsCodePage('cmd.exe', (() => ({
      stdout: Buffer.from('Active code page: 936\r\n', 'ascii'),
    })) as typeof import('child_process').spawnSync);

    expect(codePage).toBe('936');
  });
});
