import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import iconv from 'iconv-lite';

const {
  configStore,
  getConfigMock,
  findFilesMock,
  showQuickPickMock,
  spawnMock,
  spawnSyncMock,
  updateConfigMock,
} = vi.hoisted(() => ({
  configStore: new Map<string, unknown>(),
  getConfigMock: vi.fn((key: string, fallback: unknown) => (
    configStore.has(key) ? configStore.get(key) : fallback
  )),
  findFilesMock: vi.fn(async () => []),
  showQuickPickMock: vi.fn(),
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(() => ({
    stdout: Buffer.from('Active code page: 936\r\n', 'ascii'),
  })),
  updateConfigMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vi.fn(),
  },
  ConfigurationTarget: {
    Workspace: 1,
    Global: 2,
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: getConfigMock,
      update: updateConfigMock,
    })),
    workspaceFolders: [{ uri: { fsPath: 'D:/workspace' } }],
    findFiles: findFilesMock,
  },
  window: {
    showQuickPick: showQuickPickMock,
  },
  RelativePattern: class RelativePattern {
    constructor(
      public readonly base: unknown,
      public readonly pattern: string,
    ) {}
  },
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

import { KeilToolchainService } from '../packages/serialagent-vscode/src/keil-toolchain';

function createOutput() {
  return {
    append: vi.fn(),
    appendLine: vi.fn(),
  };
}

function createService(output = createOutput()) {
  return new KeilToolchainService(output as any);
}

function setConfig(overrides: Record<string, unknown>) {
  configStore.clear();
  for (const [key, value] of Object.entries(overrides)) {
    configStore.set(key, value);
  }
}

function toOpenOcdPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

beforeEach(() => {
  updateConfigMock.mockReset();
  showQuickPickMock.mockReset();
});

describe('KeilToolchainService JLink selection', () => {
  it('writes serialagent.jlink.device to user settings even when a workspace is open', async () => {
    const output = createOutput();
    const service = createService(output);
    const serviceAny = service as any;

    showQuickPickMock.mockResolvedValue({
      label: 'STM32F411CEUx',
      description: 'STMicroelectronics',
      detail: 'Project Target Device',
    });
    serviceAny.resolveProjectFile = vi.fn(async () => 'D:/workspace/demo.uvprojx');
    serviceAny.parseUvprojx = vi.fn(() => ({
      targets: [{ name: 'Target 1', deviceName: 'STM32F411CEUx' }],
    }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.loadJLinkDeviceCandidates = vi.fn(() => ([
      {
        cpuName: 'STM32F411CEUx',
        vendor: 'STMicroelectronics',
        source: 'project',
      },
    ]));

    await expect(service.selectJLinkDeviceFromProject()).resolves.toBe(true);

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(updateConfigMock).toHaveBeenCalledWith(
      'jlink.device',
      'STM32F411CEUx',
      2,
    );
    expect(output.appendLine).toHaveBeenCalledWith('[JLink] Saved to: User Settings');
  });
});

describe('KeilToolchainService ST-Link support', () => {
  beforeEach(() => {
    configStore.clear();
    getConfigMock.mockClear();
    findFilesMock.mockClear();
    spawnMock.mockReset();
    spawnSyncMock.mockClear();
  });

  it('flashes hex artifacts through STM32_Programmer_CLI using default ST-Link settings', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialagent-stlink-'));
    const stlinkExe = path.join(tempDir, 'STM32_Programmer_CLI.exe');
    const artifactPath = path.join(tempDir, 'demo.hex');
    const projectFile = path.join(tempDir, 'demo.uvprojx');

    fs.writeFileSync(stlinkExe, '');
    fs.writeFileSync(artifactPath, '');
    fs.writeFileSync(projectFile, '');

    setConfig({
      'flash.method': 'stlink',
      'stlink.exePath': stlinkExe,
      'stlink.interface': 'SWD',
      'stlink.speed': 4000,
      'stlink.baseAddr': '0x08000000',
      'stlink.resetMode': 'default',
      'stlink.runAfterProgram': true,
      'stlink.externalLoader': '',
      'stlink.optionBytesFile': '',
      'stlink.additionalArgs': '',
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => projectFile);
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.runProcess = vi.fn(async () => 0);

    const result = await service.flash(artifactPath);

    expect(result.flasher).toBe('stlink');
    expect(serviceAny.runProcess).toHaveBeenCalledWith(
      stlinkExe,
      ['-c', 'port=SWD', 'freq=4000', '-q', '--download', artifactPath, '-v', '--go'],
      process.env,
    );
  });

  it('adds base address, external loader, option bytes, reset mode, and extra args for bin artifacts', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialagent-stlink-'));
    const stlinkExe = path.join(tempDir, 'STM32_Programmer_CLI.exe');
    const artifactPath = path.join(tempDir, 'demo.bin');
    const projectFile = path.join(tempDir, 'demo.uvprojx');
    const loaderDir = path.join(tempDir, 'ExternalLoader');
    const loaderPath = path.join(loaderDir, 'custom.stldr');
    const optionBytesPath = path.join(tempDir, 'st.option.ini');

    fs.writeFileSync(stlinkExe, '');
    fs.writeFileSync(artifactPath, '');
    fs.writeFileSync(projectFile, '');
    fs.mkdirSync(loaderDir, { recursive: true });
    fs.writeFileSync(loaderPath, '');
    fs.writeFileSync(optionBytesPath, 'TZEN=1\nRDP=0xAA\n');

    setConfig({
      'flash.method': 'stlink',
      'stlink.exePath': stlinkExe,
      'stlink.interface': 'JTAG',
      'stlink.speed': 8000,
      'stlink.baseAddr': '0x08020000',
      'stlink.resetMode': 'SWrst',
      'stlink.runAfterProgram': false,
      'stlink.externalLoader': '<stlink>/custom.stldr',
      'stlink.optionBytesFile': optionBytesPath,
      'stlink.additionalArgs': '--skipErase "quoted value"',
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => projectFile);
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.runProcess = vi.fn(async () => 0);

    await service.flash(artifactPath);

    expect(serviceAny.runProcess).toHaveBeenCalledWith(
      stlinkExe,
      [
        '-c', 'port=JTAG', 'freq=8000',
        'reset=SWrst',
        '-el', loaderPath,
        '-q',
        '-ob', 'TZEN=1', 'RDP=0xAA', '-ob', 'displ',
        '--download', artifactPath, '0x08020000',
        '-v',
        '--skipErase', 'quoted value',
      ],
      process.env,
    );
  });

  it('checkConfig reports missing STM32_Programmer_CLI when ST-Link is selected', async () => {
    setConfig({
      'flash.method': 'stlink',
      'stlink.exePath': '',
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => 'D:/demo.uvprojx');
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.resolveUv4Path = vi.fn(() => 'C:/Keil_v5/UV4/UV4.exe');

    const result = await service.checkConfig();
    const stlinkCheck = result.checks.find((item) => item.key === 'stlink.exePath');

    expect(result.ready).toBe(false);
    expect(stlinkCheck?.ok).toBe(false);
    expect(stlinkCheck?.message).toContain('serialagent.stlink.exePath');
  });
});

describe('KeilToolchainService OpenOCD support', () => {
  beforeEach(() => {
    configStore.clear();
    getConfigMock.mockClear();
    findFilesMock.mockClear();
    spawnMock.mockReset();
    spawnSyncMock.mockClear();
  });

  it('flashes hex artifacts through OpenOCD using official interface/target short names', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialagent-openocd-'));
    const openocdExe = path.join(tempDir, 'bin', 'openocd.exe');
    const scriptsDir = path.join(tempDir, 'share', 'openocd', 'scripts');
    const artifactPath = path.join(tempDir, 'demo.hex');
    const projectFile = path.join(tempDir, 'demo.uvprojx');

    fs.mkdirSync(path.dirname(openocdExe), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'interface'), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'target'), { recursive: true });
    fs.writeFileSync(openocdExe, '');
    fs.writeFileSync(path.join(scriptsDir, 'interface', 'cmsis-dap.cfg'), '');
    fs.writeFileSync(path.join(scriptsDir, 'target', 'stm32f4x.cfg'), '');
    fs.writeFileSync(artifactPath, '');
    fs.writeFileSync(projectFile, '');

    setConfig({
      'flash.method': 'openocd',
      'openocd.exePath': openocdExe,
      'openocd.interface': 'cmsis-dap',
      'openocd.target': 'stm32f4x',
      'openocd.baseAddr': '0x08000000',
      'openocd.sequence': 'helper',
      'openocd.runAfterProgram': false,
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => projectFile);
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.runProcess = vi.fn(async () => 0);

    const result = await service.flash(artifactPath);

    expect(result.flasher).toBe('openocd');
    expect(serviceAny.runProcess).toHaveBeenCalledWith(
      openocdExe,
      [
        '-s', scriptsDir,
        '-f', 'interface/cmsis-dap.cfg',
        '-f', 'target/stm32f4x.cfg',
        '-c', `program "${toOpenOcdPath(artifactPath)}" verify`,
        '-c', 'exit',
      ],
      process.env,
    );
  });

  it('adds base address and optional reset run for bin artifacts', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialagent-openocd-'));
    const openocdExe = path.join(tempDir, 'bin', 'openocd.exe');
    const scriptsDir = path.join(tempDir, 'share', 'openocd', 'scripts');
    const artifactPath = path.join(tempDir, 'demo.bin');
    const projectFile = path.join(tempDir, 'demo.uvprojx');

    fs.mkdirSync(path.dirname(openocdExe), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'interface'), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'target'), { recursive: true });
    fs.writeFileSync(openocdExe, '');
    fs.writeFileSync(path.join(scriptsDir, 'interface', 'cmsis-dap.cfg'), '');
    fs.writeFileSync(path.join(scriptsDir, 'target', 'stm32f4x.cfg'), '');
    fs.writeFileSync(artifactPath, '');
    fs.writeFileSync(projectFile, '');

    setConfig({
      'flash.method': 'openocd',
      'openocd.exePath': openocdExe,
      'openocd.interface': 'cmsis-dap.cfg',
      'openocd.target': 'stm32f4x.cfg',
      'openocd.baseAddr': '0x08020000',
      'openocd.sequence': 'helper',
      'openocd.runAfterProgram': true,
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => projectFile);
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.runProcess = vi.fn(async () => 0);

    await service.flash(artifactPath);

    expect(serviceAny.runProcess).toHaveBeenCalledWith(
      openocdExe,
      [
        '-s', scriptsDir,
        '-f', 'interface/cmsis-dap.cfg',
        '-f', 'target/stm32f4x.cfg',
        '-c', `program "${toOpenOcdPath(artifactPath)}" 0x08020000 verify`,
        '-c', 'reset run',
        '-c', 'exit',
      ],
      process.env,
    );
  });

  it('normalizes Windows artifact paths before passing them to OpenOCD Tcl program command', async () => {
    const openocdExe = 'F:\\openocd\\bin\\openocd.exe';
    const projectFile = 'D:\\workspace\\demo.uvprojx';
    const artifactPath = 'D:\\_Code\\__selfproject\\01-Serial Agent\\Serial Agent\\_KeilProject\\freertos_hello\\MDK-ARM\\freertos_hello\\freertos_hello.hex';

    setConfig({
      'flash.method': 'openocd',
      'openocd.exePath': openocdExe,
      'openocd.interface': 'cmsis-dap',
      'openocd.target': 'stm32f4x',
      'openocd.baseAddr': '0x08000000',
      'openocd.sequence': 'helper',
      'openocd.runAfterProgram': false,
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => projectFile);
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.resolveOpenOcdExePath = vi.fn(() => openocdExe);
    serviceAny.resolveOpenOcdScriptsDir = vi.fn(() => 'F:/openocd/share/openocd/scripts');
    serviceAny.resolveOpenOcdConfigPath = vi.fn();
    serviceAny.runProcess = vi.fn(async () => 0);

    await service.flash(artifactPath);

    expect(serviceAny.runProcess).toHaveBeenCalledWith(
      openocdExe,
      [
        '-s', 'F:/openocd/share/openocd/scripts',
        '-f', 'interface/cmsis-dap.cfg',
        '-f', 'target/stm32f4x.cfg',
        '-c', `program "${toOpenOcdPath(artifactPath)}" verify`,
        '-c', 'exit',
      ],
      process.env,
    );
  });

  it('checkConfig reports invalid OpenOCD base address when OpenOCD is selected', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialagent-openocd-'));
    const openocdExe = path.join(tempDir, 'bin', 'openocd.exe');
    const scriptsDir = path.join(tempDir, 'share', 'openocd', 'scripts');

    fs.mkdirSync(path.dirname(openocdExe), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'interface'), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'target'), { recursive: true });
    fs.writeFileSync(openocdExe, '');
    fs.writeFileSync(path.join(scriptsDir, 'interface', 'cmsis-dap.cfg'), '');
    fs.writeFileSync(path.join(scriptsDir, 'target', 'stm32f4x.cfg'), '');

    setConfig({
      'flash.method': 'openocd',
      'openocd.exePath': openocdExe,
      'openocd.interface': 'cmsis-dap',
      'openocd.target': 'stm32f4x',
      'openocd.baseAddr': '08000000',
      'openocd.sequence': 'helper',
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => 'D:/demo.uvprojx');
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.resolveUv4Path = vi.fn(() => 'C:/Keil_v5/UV4/UV4.exe');

    const result = await service.checkConfig();
    const baseAddrCheck = result.checks.find((item) => item.key === 'openocd.baseAddr');

    expect(result.ready).toBe(false);
    expect(baseAddrCheck?.ok).toBe(false);
    expect(baseAddrCheck?.message).toContain('serialagent.openocd.baseAddr');
  });

  it('uses explicit low-reset OpenOCD sequence for hex artifacts when configured', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialagent-openocd-'));
    const openocdExe = path.join(tempDir, 'bin', 'openocd.exe');
    const scriptsDir = path.join(tempDir, 'share', 'openocd', 'scripts');
    const artifactPath = path.join(tempDir, 'demo.hex');
    const projectFile = path.join(tempDir, 'demo.uvprojx');

    fs.mkdirSync(path.dirname(openocdExe), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'interface'), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'target'), { recursive: true });
    fs.writeFileSync(openocdExe, '');
    fs.writeFileSync(path.join(scriptsDir, 'interface', 'cmsis-dap.cfg'), '');
    fs.writeFileSync(path.join(scriptsDir, 'target', 'stm32f4x.cfg'), '');
    fs.writeFileSync(artifactPath, '');
    fs.writeFileSync(projectFile, '');

    setConfig({
      'flash.method': 'openocd',
      'openocd.exePath': openocdExe,
      'openocd.interface': 'cmsis-dap',
      'openocd.target': 'stm32f4x',
      'openocd.baseAddr': '0x08000000',
      'openocd.sequence': 'low-reset',
      'openocd.runAfterProgram': true,
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => projectFile);
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.runProcess = vi.fn(async () => 0);

    await service.flash(artifactPath);

    expect(serviceAny.runProcess).toHaveBeenCalledWith(
      openocdExe,
      [
        '-s', scriptsDir,
        '-f', 'interface/cmsis-dap.cfg',
        '-f', 'target/stm32f4x.cfg',
        '-c', 'init',
        '-c', 'reset init',
        '-c', `flash write_image erase "${toOpenOcdPath(artifactPath)}"`,
        '-c', `flash verify_image "${toOpenOcdPath(artifactPath)}"`,
        '-c', 'reset run',
        '-c', 'exit',
      ],
      process.env,
    );
  });

  it('uses explicit low-reset OpenOCD sequence for bin artifacts with base address', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialagent-openocd-'));
    const openocdExe = path.join(tempDir, 'bin', 'openocd.exe');
    const scriptsDir = path.join(tempDir, 'share', 'openocd', 'scripts');
    const artifactPath = path.join(tempDir, 'demo.bin');
    const projectFile = path.join(tempDir, 'demo.uvprojx');

    fs.mkdirSync(path.dirname(openocdExe), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'interface'), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir, 'target'), { recursive: true });
    fs.writeFileSync(openocdExe, '');
    fs.writeFileSync(path.join(scriptsDir, 'interface', 'cmsis-dap.cfg'), '');
    fs.writeFileSync(path.join(scriptsDir, 'target', 'stm32f4x.cfg'), '');
    fs.writeFileSync(artifactPath, '');
    fs.writeFileSync(projectFile, '');

    setConfig({
      'flash.method': 'openocd',
      'openocd.exePath': openocdExe,
      'openocd.interface': 'cmsis-dap',
      'openocd.target': 'stm32f4x',
      'openocd.baseAddr': '0x08020000',
      'openocd.sequence': 'low-reset',
      'openocd.runAfterProgram': false,
    });

    const service = createService();
    const serviceAny = service as any;
    serviceAny.resolveProjectFile = vi.fn(async () => projectFile);
    serviceAny.parseUvprojx = vi.fn(() => ({ targets: [{ name: 'Target 1' }] }));
    serviceAny.resolveTargetName = vi.fn(() => 'Target 1');
    serviceAny.runProcess = vi.fn(async () => 0);

    await service.flash(artifactPath);

    expect(serviceAny.runProcess).toHaveBeenCalledWith(
      openocdExe,
      [
        '-s', scriptsDir,
        '-f', 'interface/cmsis-dap.cfg',
        '-f', 'target/stm32f4x.cfg',
        '-c', 'init',
        '-c', 'reset init',
        '-c', `flash write_image erase "${toOpenOcdPath(artifactPath)}" 0x08020000 bin`,
        '-c', `flash verify_image "${toOpenOcdPath(artifactPath)}" 0x08020000 bin`,
        '-c', 'exit',
      ],
      process.env,
    );
  });
});

describe('KeilToolchainService external text decoding', () => {
  beforeEach(() => {
    configStore.clear();
    getConfigMock.mockClear();
    findFilesMock.mockClear();
    spawnMock.mockReset();
    spawnSyncMock.mockClear();
  });

  it('decodes process output with the resolved Windows code page', async () => {
    const output = createOutput();
    const service = createService(output);
    const serviceAny = service as any;
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const stdoutText = '\u4e0b\u8f7d\u5b8c\u6210';
    const stderrText = '\u6821\u9a8c\u6210\u529f';

    spawnMock.mockReturnValue(child);
    serviceAny.resolveExternalTextEncoding = vi.fn(() => 'cp936');

    const runPromise = serviceAny.runProcess('tool.exe', ['--version'], process.env);
    child.stdout.emit('data', iconv.encode(stdoutText, 'cp936'));
    child.stderr.emit('data', iconv.encode(stderrText, 'cp936'));
    child.stdout.emit('end');
    child.stderr.emit('end');
    child.emit('close', 0);

    await expect(runPromise).resolves.toBe(0);
    expect(output.append).toHaveBeenCalledWith(stdoutText);
    expect(output.append).toHaveBeenCalledWith(stderrText);
  });

  it('decodes Keil build log files with the same external text encoding', () => {
    const output = createOutput();
    const service = createService(output);
    const serviceAny = service as any;
    const logFile = path.join(os.tmpdir(), `serialagent-keil-log-${Date.now()}.log`);
    const logText = '\u7f16\u8bd1\u5b8c\u6210';

    serviceAny.resolveExternalTextEncoding = vi.fn(() => 'cp936');
    fs.writeFileSync(
      logFile,
      iconv.encode(`${logText}\r\n0 Error(s), 0 Warning(s).\r\n`, 'cp936'),
    );

    const summary = serviceAny.appendBuildLog(logFile);

    expect(output.appendLine).toHaveBeenCalledWith(logText);
    expect(summary.errorCount).toBe(0);
    expect(summary.warningCount).toBe(0);
  });
});
