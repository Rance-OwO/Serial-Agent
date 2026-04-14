import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { updateSerialAgentSetting } from './config-target';
import {
  FirmwareConfigAction,
  FirmwareConfigRoute,
  FirmwareConfigSnapshot,
  FirmwareFlashMethod,
} from './firmware-config-model';
import { KeilToolchainService } from './keil-toolchain';

interface ActionItem extends vscode.QuickPickItem {
  value: string;
}

function getRouteForFlashMethod(method: FirmwareFlashMethod): FirmwareConfigRoute {
  switch (method) {
    case 'stlink':
      return 'stlink';
    case 'openocd':
      return 'openocd';
    default:
      return 'jlink';
  }
}

export interface FirmwareConfigActionResult {
  nextRoute?: FirmwareConfigRoute;
}

export class FirmwareConfigController {
  constructor(
    private readonly toolchain: KeilToolchainService,
    private readonly refreshState: () => Promise<unknown>,
  ) {}

  async handleAction(action: FirmwareConfigAction): Promise<FirmwareConfigActionResult | undefined> {
    switch (action) {
      case 'pickUv4Path':
        await this.editUv4Path();
        return undefined;
      case 'pickProjectFile':
        await this.editProjectFile();
        return undefined;
      case 'pickTarget':
        await this.editTarget();
        return undefined;
      case 'pickF7Action':
        await this.editF7Action();
        return undefined;
      case 'pickFlashMethod':
        return this.editFlashMethod();
      case 'pickJlinkInstallDir':
        await this.editJLinkInstallDirectory();
        return undefined;
      case 'pickJlinkDevice':
        await this.editJLinkDevice();
        return undefined;
      case 'pickJlinkInterface':
        await this.editJLinkInterface();
        return undefined;
      case 'pickJlinkSpeed':
        await this.editJLinkSpeed();
        return undefined;
      case 'pickJlinkBaseAddr':
        await this.editJLinkBaseAddr();
        return undefined;
      case 'pickStlinkExePath':
        await this.editStLinkExePath();
        return undefined;
      case 'pickStlinkInterface':
        await this.editStLinkInterface();
        return undefined;
      case 'pickStlinkSpeed':
        await this.editStLinkSpeed();
        return undefined;
      case 'pickStlinkBaseAddr':
        await this.editStLinkBaseAddr();
        return undefined;
      case 'pickStlinkResetMode':
        await this.editStLinkResetMode();
        return undefined;
      case 'pickStlinkRunAfterProgram':
        await this.editStLinkRunAfterProgram();
        return undefined;
      case 'pickOpenOcdExePath':
        await this.editOpenOcdExePath();
        return undefined;
      case 'pickOpenOcdTarget':
        await this.editOpenOcdTarget();
        return undefined;
      case 'pickOpenOcdInterface':
        await this.editOpenOcdInterface();
        return undefined;
      case 'pickOpenOcdBaseAddr':
        await this.editOpenOcdBaseAddr();
        return undefined;
      case 'pickOpenOcdRunAfterProgram':
        await this.editOpenOcdRunAfterProgram();
        return undefined;
      case 'pickOpenOcdSequence':
        await this.editOpenOcdSequence();
        return undefined;
      case 'runConfigCheck':
        await this.runCheck(true);
        return undefined;
      case 'openAdvancedSettings':
        this.toolchain.openSettings();
        return undefined;
      default:
        return undefined;
    }
  }

  async runCheck(showToast: boolean): Promise<void> {
    const report = await this.toolchain.checkConfig();
    await this.refreshState();

    if (!showToast) {
      return;
    }

    if (report.ready) {
      vscode.window.showInformationMessage('[Serial Agent] Build/Flash config is ready.');
      return;
    }

    const firstIssues = report.checks
      .filter((item) => !item.ok)
      .slice(0, 3)
      .map((item) => item.message);
    const summary = firstIssues.length > 0 ? ` ${firstIssues.join(' | ')}` : '';
    vscode.window.showWarningMessage(`[Serial Agent] Build/Flash config needs attention.${summary}`);
  }

  private async editUv4Path(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const uv4Path = await this.pickExecutablePath({
      title: 'Build: UV4.exe',
      placeHolder: 'Choose the MDK UV4 executable used for command-line build.',
      currentValue: snapshot.keil.uv4Path,
      suggestions: ['C:\\Keil_v5\\UV4\\UV4.exe'],
      filters: { Executable: ['exe'] },
    });
    if (uv4Path) {
      await this.updateSetting('keil.uv4Path', uv4Path);
    }
  }

  private async editProjectFile(): Promise<void> {
    const projectFile = await this.pickProjectFile();
    if (projectFile) {
      await this.updateSetting('keil.projectFile', this.toolchain.toWorkspaceRelativePath(projectFile));
    }
  }

  private async editTarget(): Promise<void> {
    let projectFile = this.resolveSnapshotProjectFile(this.toolchain.getConfigSnapshot());
    if (!projectFile) {
      await this.editProjectFile();
      projectFile = this.resolveSnapshotProjectFile(this.toolchain.getConfigSnapshot());
    }
    if (!projectFile) {
      return;
    }

    const targets = await this.toolchain.listProjectTargets(projectFile);
    if (targets.length === 0) {
      vscode.window.showErrorMessage('[Serial Agent] No Keil targets found in the selected project file.');
      return;
    }

    const target = await this.pickChoice({
      title: 'Build: Select Target',
      placeHolder: `Choose the target from ${path.basename(projectFile)}.`,
      items: targets.map((item) => ({
        label: item,
        description: item === this.toolchain.getConfigSnapshot().keil.target ? 'Current' : undefined,
        value: item,
      })),
    });
    if (target) {
      await this.updateSetting('keil.target', target);
    }
  }

  private async editF7Action(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const action = await this.pickChoice({
      title: 'Flash: F7 Action',
      placeHolder: 'Choose what F7 should do.',
      items: [
        {
          label: 'Build',
          description: snapshot.keil.f7Action === 'build' ? 'Current' : undefined,
          detail: 'Run Keil build only.',
          value: 'build',
        },
        {
          label: 'Build+Flash',
          description: snapshot.keil.f7Action === 'buildAndFlash' ? 'Current' : undefined,
          detail: 'Build first, then flash with the selected flasher.',
          value: 'buildAndFlash',
        },
      ],
    });
    if (action) {
      await this.updateSetting('keil.f7Action', action);
    }
  }

  private async editFlashMethod(): Promise<FirmwareConfigActionResult | undefined> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const flashMethod = await this.pickChoice({
      title: 'Flash: Choose Flasher',
      placeHolder: 'Select the active firmware flasher.',
      items: [
        {
          label: 'JLink',
          description: snapshot.flash.method === 'jlink' ? 'Current' : undefined,
          detail: 'SEGGER JLink.exe flow with JLink CPU selection.',
          value: 'jlink',
        },
        {
          label: 'ST-Link',
          description: snapshot.flash.method === 'stlink' ? 'Current' : undefined,
          detail: 'STM32_Programmer_CLI.exe flow.',
          value: 'stlink',
        },
        {
          label: 'OpenOCD',
          description: snapshot.flash.method === 'openocd' ? 'Current' : undefined,
          detail: 'Choose Chip Config and Interface Config from the OpenOCD package.',
          value: 'openocd',
        },
      ],
    });
    if (!flashMethod) {
      return undefined;
    }

    await this.updateSetting('flash.method', flashMethod);
    return { nextRoute: getRouteForFlashMethod(flashMethod as FirmwareFlashMethod) };
  }

  private async editJLinkInstallDirectory(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const installDirectory = await this.pickDirectoryPath({
      title: 'JLink: Install Directory',
      placeHolder: 'Choose the SEGGER JLink installation directory.',
      currentValue: snapshot.flash.jlink.installDirectory,
      suggestions: [
        'C:\\Program Files\\SEGGER\\JLink',
        'C:\\Program Files (x86)\\SEGGER\\JLink',
      ],
    });
    if (installDirectory) {
      await this.updateSetting('jlink.installDirectory', installDirectory);
    }
  }

  private async editJLinkDevice(): Promise<void> {
    try {
      const updated = await this.toolchain.selectJLinkDeviceFromProject();
      await this.refreshState();
      if (updated) {
        vscode.window.showInformationMessage('[Serial Agent] JLink CPU Name saved to User Settings.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`[Serial Agent] Select JLink CPU failed: ${msg}`);
    }
  }

  private async editJLinkInterface(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const jlinkInterface = await this.pickChoice({
      title: 'JLink: Interface',
      placeHolder: 'Choose the JLink interface type.',
      items: [
        { label: 'SWD', description: snapshot.flash.jlink.interface === 'SWD' ? 'Current' : undefined, value: 'SWD' },
        { label: 'JTAG', description: snapshot.flash.jlink.interface === 'JTAG' ? 'Current' : undefined, value: 'JTAG' },
      ],
    });
    if (jlinkInterface) {
      await this.updateSetting('jlink.interface', jlinkInterface);
    }
  }

  private async editJLinkSpeed(): Promise<void> {
    const speed = await this.pickTextValue({
      title: 'JLink: Speed',
      prompt: 'Enter the JLink speed in kHz.',
      currentValue: String(this.toolchain.getConfigSnapshot().flash.jlink.speed || 4000),
      validate: (value) => /^\d+$/.test(value.trim()) ? undefined : 'Speed must be an integer in kHz.',
    });
    if (speed) {
      await this.updateSetting('jlink.speed', parseInt(speed, 10));
    }
  }

  private async editJLinkBaseAddr(): Promise<void> {
    const baseAddr = await this.pickTextValue({
      title: 'JLink: Base Address',
      prompt: 'Enter the base address used when flashing a .bin file.',
      currentValue: this.toolchain.getConfigSnapshot().flash.jlink.baseAddr || '0x08000000',
      validate: this.validateHexAddress,
    });
    if (baseAddr) {
      await this.updateSetting('jlink.baseAddr', baseAddr);
    }
  }

  private async editStLinkExePath(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const exePath = await this.pickExecutablePath({
      title: 'ST-Link: STM32_Programmer_CLI.exe',
      placeHolder: 'Choose STM32_Programmer_CLI.exe.',
      currentValue: snapshot.flash.stlink.exePath,
      suggestions: [],
      filters: { Executable: ['exe'] },
    });
    if (exePath) {
      await this.updateSetting('stlink.exePath', exePath);
    }
  }

  private async editStLinkInterface(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const stlinkInterface = await this.pickChoice({
      title: 'ST-Link: Interface',
      placeHolder: 'Choose the ST-Link interface type.',
      items: [
        { label: 'SWD', description: snapshot.flash.stlink.interface === 'SWD' ? 'Current' : undefined, value: 'SWD' },
        { label: 'JTAG', description: snapshot.flash.stlink.interface === 'JTAG' ? 'Current' : undefined, value: 'JTAG' },
      ],
    });
    if (stlinkInterface) {
      await this.updateSetting('stlink.interface', stlinkInterface);
    }
  }

  private async editStLinkSpeed(): Promise<void> {
    const speed = await this.pickTextValue({
      title: 'ST-Link: Speed',
      prompt: 'Enter the ST-Link speed in kHz.',
      currentValue: String(this.toolchain.getConfigSnapshot().flash.stlink.speed || 4000),
      validate: (value) => /^\d+$/.test(value.trim()) ? undefined : 'Speed must be an integer in kHz.',
    });
    if (speed) {
      await this.updateSetting('stlink.speed', parseInt(speed, 10));
    }
  }

  private async editStLinkBaseAddr(): Promise<void> {
    const baseAddr = await this.pickTextValue({
      title: 'ST-Link: Base Address',
      prompt: 'Enter the base address used when flashing a .bin file.',
      currentValue: this.toolchain.getConfigSnapshot().flash.stlink.baseAddr || '0x08000000',
      validate: this.validateHexAddress,
    });
    if (baseAddr) {
      await this.updateSetting('stlink.baseAddr', baseAddr);
    }
  }

  private async editStLinkResetMode(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const resetMode = await this.pickChoice({
      title: 'ST-Link: Reset Mode',
      placeHolder: 'Choose the reset mode passed to STM32CubeProgrammer.',
      items: [
        { label: 'default', description: snapshot.flash.stlink.resetMode === 'default' ? 'Current' : undefined, detail: 'Keep STM32CubeProgrammer default reset behavior.', value: 'default' },
        { label: 'SWrst', description: snapshot.flash.stlink.resetMode === 'SWrst' ? 'Current' : undefined, detail: 'Software system reset.', value: 'SWrst' },
        { label: 'HWrst', description: snapshot.flash.stlink.resetMode === 'HWrst' ? 'Current' : undefined, detail: 'Hardware reset.', value: 'HWrst' },
        { label: 'Crst', description: snapshot.flash.stlink.resetMode === 'Crst' ? 'Current' : undefined, detail: 'Core reset.', value: 'Crst' },
      ],
    });
    if (resetMode) {
      await this.updateSetting('stlink.resetMode', resetMode);
    }
  }

  private async editStLinkRunAfterProgram(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const runAfterProgram = await this.pickChoice({
      title: 'ST-Link: Run After Program',
      placeHolder: 'Choose whether STM32CubeProgrammer should add --go after flashing.',
      items: [
        { label: 'Yes', description: snapshot.flash.stlink.runAfterProgram ? 'Current' : undefined, value: 'true' },
        { label: 'No', description: !snapshot.flash.stlink.runAfterProgram ? 'Current' : undefined, value: 'false' },
      ],
    });
    if (runAfterProgram) {
      await this.updateSetting('stlink.runAfterProgram', runAfterProgram === 'true');
    }
  }

  private async editOpenOcdExePath(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const exePath = await this.pickExecutablePath({
      title: 'OpenOCD: openocd.exe',
      placeHolder: 'Choose the OpenOCD executable from an official package.',
      currentValue: snapshot.flash.openocd.exePath,
      suggestions: [],
      filters: { Executable: ['exe'] },
    });
    if (exePath) {
      await this.updateSetting('openocd.exePath', exePath);
    }
  }

  private async editOpenOcdTarget(): Promise<void> {
    const chipConfig = await this.pickChoice({
      title: 'OpenOCD: Chip Config',
      placeHolder: 'Choose the target config, for example stm32f4x.cfg.',
      items: this.createCfgItems(
        this.safeListOpenOcdConfigs('target'),
        this.toolchain.getConfigSnapshot().flash.openocd.target,
      ),
    });
    if (chipConfig) {
      await this.updateSetting('openocd.target', chipConfig);
    }
  }

  private async editOpenOcdInterface(): Promise<void> {
    const interfaceConfig = await this.pickChoice({
      title: 'OpenOCD: Interface Config',
      placeHolder: 'Choose the interface config, for example cmsis-dap-v1.cfg.',
      items: this.createCfgItems(
        this.safeListOpenOcdConfigs('interface'),
        this.toolchain.getConfigSnapshot().flash.openocd.interface,
      ),
    });
    if (interfaceConfig) {
      await this.updateSetting('openocd.interface', interfaceConfig);
    }
  }

  private async editOpenOcdBaseAddr(): Promise<void> {
    const baseAddr = await this.pickTextValue({
      title: 'OpenOCD: Base Address',
      prompt: 'Enter the base address used when flashing a .bin file.',
      currentValue: this.toolchain.getConfigSnapshot().flash.openocd.baseAddr || '0x08000000',
      validate: this.validateHexAddress,
    });
    if (baseAddr) {
      await this.updateSetting('openocd.baseAddr', baseAddr);
    }
  }

  private async editOpenOcdRunAfterProgram(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const runAfterProgram = await this.pickChoice({
      title: 'OpenOCD: Run After Program',
      placeHolder: 'Choose whether OpenOCD should append reset run after flashing.',
      items: [
        { label: 'Yes', description: snapshot.flash.openocd.runAfterProgram ? 'Current' : undefined, value: 'true' },
        { label: 'No', description: !snapshot.flash.openocd.runAfterProgram ? 'Current' : undefined, value: 'false' },
      ],
    });
    if (runAfterProgram) {
      await this.updateSetting('openocd.runAfterProgram', runAfterProgram === 'true');
    }
  }

  private async editOpenOcdSequence(): Promise<void> {
    const snapshot = this.toolchain.getConfigSnapshot();
    const sequence = await this.pickChoice({
      title: 'OpenOCD: Sequence',
      placeHolder: 'Choose the OpenOCD flash sequence.',
      items: [
        { label: 'helper', description: snapshot.flash.openocd.sequence === 'helper' ? 'Current' : undefined, detail: 'Use OpenOCD program helper.', value: 'helper' },
        { label: 'low-reset', description: snapshot.flash.openocd.sequence === 'low-reset' ? 'Current' : undefined, detail: 'Use explicit flash commands and try to reduce visible resets.', value: 'low-reset' },
      ],
    });
    if (sequence) {
      await this.updateSetting('openocd.sequence', sequence);
    }
  }

  private async updateSetting(key: string, value: unknown): Promise<void> {
    await updateSerialAgentSetting(key, value);
    await this.refreshState();
  }

  private resolveSnapshotProjectFile(snapshot: FirmwareConfigSnapshot): string | undefined {
    const projectFile = snapshot.keil.projectFile.trim();
    if (!projectFile) {
      return undefined;
    }
    if (path.isAbsolute(projectFile)) {
      return projectFile;
    }
    const workspaceRoot = this.toolchain.getWorkspaceRootPath();
    if (!workspaceRoot) {
      return undefined;
    }
    return path.resolve(workspaceRoot, projectFile);
  }

  private async pickExecutablePath(options: {
    title: string;
    placeHolder: string;
    currentValue: string;
    suggestions: string[];
    filters: Record<string, string[]>;
  }): Promise<string | undefined> {
    return this.pickPathLikeValue({
      title: options.title,
      placeHolder: options.placeHolder,
      currentValue: options.currentValue,
      suggestions: options.suggestions,
      browseLabel: 'Browse for executable...',
      browseDetail: 'Open a file picker and select the executable.',
      pickPath: async () => {
        const files = await vscode.window.showOpenDialog({
          title: options.title,
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          openLabel: 'Use this executable',
          filters: options.filters,
        });
        return files?.[0]?.fsPath;
      },
    });
  }

  private async pickDirectoryPath(options: {
    title: string;
    placeHolder: string;
    currentValue: string;
    suggestions: string[];
  }): Promise<string | undefined> {
    return this.pickPathLikeValue({
      title: options.title,
      placeHolder: options.placeHolder,
      currentValue: options.currentValue,
      suggestions: options.suggestions,
      browseLabel: 'Browse for folder...',
      browseDetail: 'Open a folder picker and select the install directory.',
      pickPath: async () => {
        const folders = await vscode.window.showOpenDialog({
          title: options.title,
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Use this folder',
        });
        return folders?.[0]?.fsPath;
      },
    });
  }

  private async pickProjectFile(): Promise<string | undefined> {
    const candidates = await this.toolchain.listProjectFiles();
    const currentValue = this.toolchain.getConfigSnapshot().keil.projectFile;
    const workspaceRoot = this.toolchain.getWorkspaceRootPath();
    const currentResolved = currentValue
      ? (path.isAbsolute(currentValue)
        ? currentValue
        : path.resolve(workspaceRoot || '', currentValue))
      : '';

    const items: ActionItem[] = candidates.map((candidate) => ({
      label: path.basename(candidate),
      description: candidate === currentResolved ? 'Current' : this.toolchain.toWorkspaceRelativePath(candidate),
      detail: candidate,
      value: candidate,
    }));
    items.push({
      label: 'Browse for project file...',
      description: 'Select a .uvprojx or .uvproj file manually.',
      value: '__browse__',
    });

    const picked = await this.pickChoice({
      title: 'Build: Project File',
      placeHolder: 'Choose the Keil project file used for build and artifact resolution.',
      items,
    });
    if (!picked) {
      return undefined;
    }
    if (picked !== '__browse__') {
      return picked;
    }

    const files = await vscode.window.showOpenDialog({
      title: 'Build: Project File',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Use this project',
      filters: {
        'Keil Project': ['uvprojx', 'uvproj'],
      },
    });

    return files?.[0]?.fsPath;
  }

  private async pickPathLikeValue(options: {
    title: string;
    placeHolder: string;
    currentValue: string;
    suggestions: string[];
    browseLabel: string;
    browseDetail: string;
    pickPath: () => Promise<string | undefined>;
  }): Promise<string | undefined> {
    const items: ActionItem[] = [];
    const seen = new Set<string>();

    const pushExisting = (value: string, label: string, description: string) => {
      if (!value || seen.has(value) || !fs.existsSync(value)) {
        return;
      }
      seen.add(value);
      items.push({
        label,
        description,
        detail: value,
        value,
      });
    };

    pushExisting(options.currentValue, 'Keep current value', 'Configured');
    for (const suggestion of options.suggestions) {
      pushExisting(suggestion, 'Use detected path', 'Suggested');
    }
    items.push({
      label: options.browseLabel,
      detail: options.browseDetail,
      value: '__browse__',
    });

    const picked = await this.pickChoice({
      title: options.title,
      placeHolder: options.placeHolder,
      items,
    });
    if (!picked) {
      return undefined;
    }
    if (picked !== '__browse__') {
      return picked;
    }
    return options.pickPath();
  }

  private async pickTextValue(options: {
    title: string;
    prompt: string;
    currentValue: string;
    validate: (value: string) => string | undefined;
  }): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
      title: options.title,
      prompt: options.prompt,
      value: options.currentValue,
      ignoreFocusOut: true,
      validateInput: options.validate,
    });
    return value?.trim();
  }

  private async pickChoice(options: {
    title: string;
    placeHolder: string;
    items: ActionItem[];
  }): Promise<string | undefined> {
    const picked = await vscode.window.showQuickPick(options.items, {
      title: options.title,
      placeHolder: options.placeHolder,
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return picked?.value;
  }

  private createCfgItems(values: string[], currentValue: string): ActionItem[] {
    if (values.length === 0) {
      throw new Error('No .cfg candidates were found. Please check the OpenOCD installation path first.');
    }

    return values.map((value) => ({
      label: `${value}.cfg`,
      description: value === currentValue ? 'Current' : undefined,
      detail: 'Pick this .cfg name instead of typing it manually.',
      value,
    }));
  }

  private safeListOpenOcdConfigs(group: 'interface' | 'target'): string[] {
    try {
      return this.toolchain.listOpenOcdConfigs(group);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Unable to list OpenOCD ${group} configs: ${msg}`);
    }
  }

  private validateHexAddress(value: string): string | undefined {
    return /^0x[0-9a-f]+$/i.test(value.trim())
      ? undefined
      : 'Use a hex address like 0x08000000.';
  }
}
