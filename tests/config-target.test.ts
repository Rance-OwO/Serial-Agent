import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { files, updateConfigMock } = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  updateConfigMock: vi.fn(),
}));

function toUri(fsPath: string) {
  return {
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => fsPath,
  };
}

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Workspace: 1,
    Global: 2,
  },
  Uri: {
    file: (fsPath: string) => toUri(fsPath),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => toUri(path.join(base.fsPath, ...parts)),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      update: updateConfigMock,
    })),
    workspaceFolders: [{ uri: toUri('D:/workspace') }],
    fs: {
      createDirectory: vi.fn(async () => undefined),
      readFile: vi.fn(async (uri: { fsPath: string }) => {
        const data = files.get(uri.fsPath);
        if (!data) {
          throw new Error('FileNotFound');
        }
        return data;
      }),
      writeFile: vi.fn(async (uri: { fsPath: string }, data: Uint8Array) => {
        files.set(uri.fsPath, data);
      }),
    },
  },
}));

import {
  updateSerialAgentSetting,
  upsertJsoncProperty,
} from '../packages/serialagent-vscode/src/config-target';

describe('upsertJsoncProperty', () => {
  it('creates a settings object when the file is empty', () => {
    expect(upsertJsoncProperty('', 'serialagent.custom.mode', 'command')).toBe(
      '{\n    "serialagent.custom.mode": "command"\n}\n',
    );
  });

  it('inserts a new key while keeping comments', () => {
    const text = `{
    // flash
    "serialagent.flash.method": "jlink"
}
`;
    expect(upsertJsoncProperty(text, 'serialagent.custom.mode', 'command')).toBe(
      `{
    // flash
    "serialagent.flash.method": "jlink",
    "serialagent.custom.mode": "command"
}
`,
    );
  });

  it('replaces an existing string value', () => {
    const text = `{
    "serialagent.custom.mode": "python"
}
`;
    expect(upsertJsoncProperty(text, 'serialagent.custom.mode', 'command')).toBe(
      `{
    "serialagent.custom.mode": "command"
}
`,
    );
  });
});

describe('updateSerialAgentSetting', () => {
  beforeEach(() => {
    files.clear();
    updateConfigMock.mockReset();
  });

  it('writes workspace-scoped custom settings into .vscode/settings.json', async () => {
    const target = await updateSerialAgentSetting('custom.mode', 'command');
    const settingsPath = path.join('D:/workspace', '.vscode', 'settings.json');
    const written = Buffer.from(files.get(settingsPath) || new Uint8Array()).toString('utf8');

    expect(target).toBe(1);
    expect(updateConfigMock).not.toHaveBeenCalled();
    expect(written).toContain('"serialagent.custom.mode": "command"');
  });

  it('keeps machine-scoped settings on the configuration API', async () => {
    updateConfigMock.mockResolvedValue(undefined);

    const target = await updateSerialAgentSetting('keil.uv4Path', 'D:\\\\Keil\\\\UV4.exe');

    expect(target).toBe(2);
    expect(updateConfigMock).toHaveBeenCalledWith('keil.uv4Path', 'D:\\\\Keil\\\\UV4.exe', 2);
    expect(files.size).toBe(0);
  });

  it('falls back to writing the workspace file when a machine setting is unregistered', async () => {
    updateConfigMock.mockRejectedValue(
      new Error('Unable to write to User Settings because serialagent.custom.pythonPath is not a registered configuration.'),
    );

    const target = await updateSerialAgentSetting('custom.pythonPath', 'C:\\Python\\python.exe');
    const settingsPath = path.join('D:/workspace', '.vscode', 'settings.json');
    const written = Buffer.from(files.get(settingsPath) || new Uint8Array()).toString('utf8');

    expect(target).toBe(1);
    expect(written).toContain('"serialagent.custom.pythonPath": "C:\\\\Python\\\\python.exe"');
  });
});
