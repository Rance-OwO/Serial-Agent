import * as path from 'path';
import { KeilConfigCheckResult } from './types';

export type FirmwareFlashMethod = 'jlink' | 'stlink' | 'openocd';
export type FirmwareF7Action = 'build' | 'flash' | 'buildAndFlash' | 'custom';
export type FirmwareConfigRoute = 'home' | 'build' | 'flash' | 'jlink' | 'stlink' | 'openocd' | 'custom';

export const FIRMWARE_CONFIG_ROUTES: FirmwareConfigRoute[] = [
  'home',
  'build',
  'flash',
  'jlink',
  'stlink',
  'openocd',
  'custom',
];

export function normalizeFirmwareConfigRoute(route: unknown): FirmwareConfigRoute {
  return FIRMWARE_CONFIG_ROUTES.includes(route as FirmwareConfigRoute)
    ? route as FirmwareConfigRoute
    : 'home';
}

export type FirmwareConfigAction =
  | 'pickUv4Path'
  | 'pickArmcc5Path'
  | 'pickProjectFile'
  | 'pickTarget'
  | 'pickF7Action'
  | 'pickFlashMethod'
  | 'selectJlinkFlasher'
  | 'selectStlinkFlasher'
  | 'selectOpenOcdFlasher'
  | 'pickJlinkInstallDir'
  | 'pickJlinkDevice'
  | 'pickJlinkInterface'
  | 'pickJlinkSpeed'
  | 'pickJlinkBaseAddr'
  | 'pickStlinkExePath'
  | 'pickStlinkInterface'
  | 'pickStlinkSpeed'
  | 'pickStlinkBaseAddr'
  | 'pickStlinkResetMode'
  | 'pickStlinkRunAfterProgram'
  | 'pickOpenOcdExePath'
  | 'pickOpenOcdTarget'
  | 'pickOpenOcdInterface'
  | 'pickOpenOcdBaseAddr'
  | 'pickOpenOcdRunAfterProgram'
  | 'pickOpenOcdSequence'
  | 'pickCustomMode'
  | 'pickCustomPython'
  | 'pickCustomScript'
  | 'pickCustomCommand'
  | 'runConfigCheck'
  | 'openAdvancedSettings';

export interface FirmwareConfigSnapshot {
  keil: {
    projectFile: string;
    target: string;
    uv4Path: string;
    armcc5Path: string;
    resultPolicy: string;
    strictExitCode: boolean;
    f7Action: FirmwareF7Action;
  };
  custom: {
    mode: 'python' | 'command';
    pythonPath: string;
    script: string;
    command: string;
    preview: string;
    ready: boolean;
  };
  flash: {
    method: FirmwareFlashMethod;
    jlink: {
      installDirectory: string;
      device: string;
      interface: string;
      speed: number;
      baseAddr: string;
    };
    stlink: {
      exePath: string;
      interface: string;
      speed: number;
      baseAddr: string;
      resetMode: string;
      runAfterProgram: boolean;
      externalLoader: string;
      optionBytesFile: string;
      additionalArgs: string;
    };
    openocd: {
      exePath: string;
      interface: string;
      target: string;
      baseAddr: string;
      runAfterProgram: boolean;
      sequence: string;
    };
  };
}

export interface FirmwareConfigSummary {
  ready: boolean;
  statusKind: 'ready' | 'warning';
  statusText: string;
  buildText: string;
  flashText: string;
  customText: string;
  hintText: string;
  warnings: string[];
}

export interface FirmwareConfigUiState {
  firmwareDrawerOpen: boolean;
  firmwareDrawerRoute: FirmwareConfigRoute;
  firmwareDrawerStack: FirmwareConfigRoute[];
}

const CHECK_LABELS: Record<string, string> = {
  'keil.projectFile': 'Choose a Keil project file',
  'keil.target': 'Select a target from the project',
  'keil.uv4Path': 'Choose UV4.exe',
  'jlink.installDirectory': 'Choose the JLink install directory',
  'jlink.device': 'Select JLink CPU',
  'stlink.exePath': 'Choose STM32_Programmer_CLI.exe',
  'stlink.externalLoader': 'Check the ST-Link external loader path',
  'stlink.optionBytesFile': 'Check the ST-Link option bytes file',
  'openocd.exePath': 'Choose openocd.exe',
  'openocd.interface': 'Select Interface Config',
  'openocd.target': 'Select Chip Config',
  'openocd.baseAddr': 'Check the OpenOCD base address',
  'openocd.scriptsDir': 'Check the OpenOCD scripts directory',
  'custom.pythonPath': 'Choose a Python interpreter',
  'custom.script': 'Choose a Python script',
  'custom.command': 'Enter a custom command',
  'custom.workspaceTrust': 'Trust this workspace to run a custom command',
};

function getF7ActionLabel(action: FirmwareF7Action): string {
  switch (action) {
    case 'buildAndFlash':
      return 'Build+Flash';
    case 'flash':
      return 'Flash';
    case 'custom':
      return 'Custom';
    default:
      return 'Build';
  }
}

function getFlashMethodLabel(method: FirmwareFlashMethod): string {
  switch (method) {
    case 'stlink':
      return 'ST-Link';
    case 'openocd':
      return 'OpenOCD';
    default:
      return 'JLink';
  }
}

function toDisplayName(filePath: string): string {
  if (!filePath) {
    return '';
  }
  return path.basename(filePath);
}

function getFriendlyWarning(key: string, message: string): string {
  const prefix = CHECK_LABELS[key] || message;
  if (!CHECK_LABELS[key]) {
    return prefix;
  }

  if (!message) {
    return prefix;
  }

  return `${prefix}: ${message}`;
}

function buildBuildText(snapshot: FirmwareConfigSnapshot, report: KeilConfigCheckResult): string {
  const parts: string[] = [];
  const uv4Ready = report.checks.find((item) => item.key === 'keil.uv4Path')?.ok ?? false;
  parts.push(uv4Ready ? 'UV4 ready' : 'Need UV4.exe');

  const projectFile = report.projectFile || snapshot.keil.projectFile;
  if (projectFile) {
    parts.push(`Project: ${toDisplayName(projectFile)}`);
  } else {
    parts.push('Project: not selected');
  }

  const target = report.target || snapshot.keil.target;
  if (target) {
    parts.push(`Target: ${target}`);
  } else {
    parts.push('Target: auto');
  }

  return parts.join(' | ');
}

function buildCustomText(snapshot: FirmwareConfigSnapshot): string {
  if (snapshot.custom.preview) {
    return snapshot.custom.preview;
  }
  if (snapshot.custom.mode === 'command') {
    return snapshot.custom.command || 'not configured';
  }
  if (snapshot.custom.pythonPath || snapshot.custom.script) {
    return [snapshot.custom.pythonPath, snapshot.custom.script].filter(Boolean).join(' ');
  }
  return 'not configured';
}

function buildFlashText(snapshot: FirmwareConfigSnapshot): string {
  const parts = [
    `F7: ${getF7ActionLabel(snapshot.keil.f7Action)}`,
    `Flasher: ${getFlashMethodLabel(snapshot.flash.method)}`,
  ];

  if (snapshot.flash.method === 'jlink') {
    parts.push(snapshot.flash.jlink.device ? `CPU: ${snapshot.flash.jlink.device}` : 'CPU: not selected');
  } else if (snapshot.flash.method === 'stlink') {
    parts.push(`Reset: ${snapshot.flash.stlink.resetMode}`);
  } else {
    parts.push(snapshot.flash.openocd.target ? `Chip: ${snapshot.flash.openocd.target}.cfg` : 'Chip: not selected');
    parts.push(snapshot.flash.openocd.interface ? `Interface: ${snapshot.flash.openocd.interface}.cfg` : 'Interface: not selected');
  }

  return parts.join(' | ');
}

export function buildFirmwareConfigSummary(
  snapshot: FirmwareConfigSnapshot,
  report: KeilConfigCheckResult,
): FirmwareConfigSummary {
  const failedChecks = report.checks.filter((item) => !item.ok);
  const warnings = failedChecks
    .slice(0, 4)
    .map((item) => getFriendlyWarning(item.key, item.message));

  return {
    ready: report.ready,
    statusKind: report.ready ? 'ready' : 'warning',
    statusText: report.ready
      ? 'Ready to build and flash'
      : `${failedChecks.length} item(s) need attention`,
    buildText: buildBuildText(snapshot, report),
    flashText: buildFlashText(snapshot),
    customText: `Custom: ${buildCustomText(snapshot)}`,
    hintText: report.ready
      ? 'Use Configure to adjust Build or Flash options without leaving the panel.'
      : 'Open Configure, fill the missing items, then use Close and Return to Serial whenever you want to go back.',
    warnings,
  };
}
