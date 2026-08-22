import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildFirmwareConfigSummary,
  FIRMWARE_CONFIG_ROUTES,
  FirmwareConfigSnapshot,
  normalizeFirmwareConfigRoute,
} from '../packages/serialagent-vscode/src/firmware-config-model';
import { KeilConfigCheckResult } from '../packages/serialagent-vscode/src/types';

function createSnapshot(): FirmwareConfigSnapshot {
  return {
    keil: {
      projectFile: 'demo/demo.uvprojx',
      target: 'App',
      uv4Path: 'C:\\Keil_v5\\UV4\\UV4.exe',
      armcc5Path: '',
      resultPolicy: 'log-and-artifact',
      strictExitCode: false,
      f7Action: 'buildAndFlash',
    },
    custom: {
      mode: 'python',
      pythonPath: 'python3',
      script: 'tools/flash.py',
      command: '',
      preview: 'python3 tools/flash.py',
      ready: true,
    },
    flash: {
      method: 'openocd',
      jlink: {
        installDirectory: 'C:\\Program Files (x86)\\SEGGER\\JLink',
        device: '',
        interface: 'SWD',
        speed: 4000,
        baseAddr: '0x08000000',
      },
      stlink: {
        exePath: '',
        interface: 'SWD',
        speed: 4000,
        baseAddr: '0x08000000',
        resetMode: 'default',
        runAfterProgram: true,
        externalLoader: '',
        optionBytesFile: '',
        additionalArgs: '',
      },
      openocd: {
        exePath: 'D:\\OpenOCD\\bin\\openocd.exe',
        interface: 'cmsis-dap-v1',
        target: 'stm32f4x',
        baseAddr: '0x08000000',
        runAfterProgram: false,
        sequence: 'helper',
      },
    },
  };
}

describe('buildFirmwareConfigSummary', () => {
  it('builds a ready summary for a complete configuration', () => {
    const report: KeilConfigCheckResult = {
      ready: true,
      projectFile: 'D:\\repo\\demo\\demo.uvprojx',
      target: 'App',
      checks: [
        { key: 'keil.projectFile', ok: true, message: 'Project file found' },
        { key: 'keil.target', ok: true, message: 'Target resolved' },
        { key: 'keil.uv4Path', ok: true, message: 'UV4 executable found' },
        { key: 'flash.method', ok: true, message: 'Flash backend selected', value: 'openocd' },
        { key: 'openocd.exePath', ok: true, message: 'OpenOCD executable found' },
        { key: 'openocd.interface', ok: true, message: 'OpenOCD interface config found' },
        { key: 'openocd.target', ok: true, message: 'OpenOCD target config found' },
      ],
    };

    const summary = buildFirmwareConfigSummary(createSnapshot(), report);

    expect(summary.ready).toBe(true);
    expect(summary.statusText).toBe('Ready to build and flash');
    expect(summary.buildText).toContain('UV4 ready');
    expect(summary.buildText).toContain('demo.uvprojx');
    expect(summary.flashText).toContain('Flasher: OpenOCD');
    expect(summary.flashText).toContain('Chip: stm32f4x.cfg');
    expect(summary.flashText).toContain('Interface: cmsis-dap-v1.cfg');
    expect(summary.customText).toBe('Custom: python3 tools/flash.py');
    expect(summary.warnings).toEqual([]);
  });

  it('surfaces friendly warnings for missing configuration', () => {
    const snapshot = createSnapshot();
    snapshot.flash.method = 'jlink';

    const report: KeilConfigCheckResult = {
      ready: false,
      checks: [
        { key: 'keil.uv4Path', ok: false, message: 'Cannot find UV4 executable. Please configure serialagent.keil.uv4Path.' },
        { key: 'keil.projectFile', ok: false, message: 'No .uvprojx/.uvproj file found. Please configure serialagent.keil.projectFile.' },
        { key: 'jlink.device', ok: false, message: 'Missing JLink device name. Please configure serialagent.jlink.device, or set Device in .uvprojx target.' },
      ],
    };

    const summary = buildFirmwareConfigSummary(snapshot, report);

    expect(summary.ready).toBe(false);
    expect(summary.statusText).toBe('3 item(s) need attention');
    expect(summary.buildText).toContain('Need UV4.exe');
    expect(summary.flashText).toContain('Flasher: JLink');
    expect(summary.flashText).toContain('CPU: not selected');
    expect(summary.warnings).toEqual([
      'Choose UV4.exe: Cannot find UV4 executable. Please configure serialagent.keil.uv4Path.',
      'Choose a Keil project file: No .uvprojx/.uvproj file found. Please configure serialagent.keil.projectFile.',
      'Select JLink CPU: Missing JLink device name. Please configure serialagent.jlink.device, or set Device in .uvprojx target.',
    ]);
  });
});

describe('normalizeFirmwareConfigRoute', () => {
  it('keeps custom as a first-class drawer route', () => {
    expect(normalizeFirmwareConfigRoute('custom')).toBe('custom');
    expect(normalizeFirmwareConfigRoute('unknown')).toBe('home');
  });

  it('keeps the webview drawer switch aligned with every firmware config route', () => {
    const source = fs.readFileSync(
      path.resolve('packages/serialagent-vscode/media/main.js'),
      'utf8',
    );
    const start = source.indexOf('function normalizeFirmwareDrawerRoute');
    const end = source.indexOf('function normalizeFirmwareDrawerStack');
    const fn = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    for (const route of FIRMWARE_CONFIG_ROUTES) {
      if (route === 'home') {
        continue;
      }
      expect(fn).toContain(`case '${route}':`);
    }
  });
});
