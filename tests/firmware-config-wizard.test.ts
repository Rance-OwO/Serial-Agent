import { beforeEach, describe, expect, it, vi } from 'vitest';

const { showQuickPickMock, showOpenDialogMock, showWarningMessageMock, updateSerialAgentSettingMock } = vi.hoisted(() => ({
  showQuickPickMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  showWarningMessageMock: vi.fn(),
  updateSerialAgentSettingMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showQuickPick: showQuickPickMock,
    showInformationMessage: vi.fn(),
    showWarningMessage: showWarningMessageMock,
    showErrorMessage: vi.fn(),
    showOpenDialog: showOpenDialogMock,
    showInputBox: vi.fn(),
  },
}));

vi.mock('../packages/serialagent-vscode/src/config-target', () => ({
  updateSerialAgentSetting: updateSerialAgentSettingMock,
}));

import { FirmwareConfigController } from '../packages/serialagent-vscode/src/firmware-config-wizard';
import { FirmwareConfigSnapshot } from '../packages/serialagent-vscode/src/firmware-config-model';

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
    flash: {
      method: 'stlink',
      jlink: {
        installDirectory: 'C:\\Program Files (x86)\\SEGGER\\JLink',
        device: 'STM32F411CEUx',
        interface: 'SWD',
        speed: 4000,
        baseAddr: '0x08000000',
      },
      stlink: {
        exePath: 'C:\\ST\\STM32_Programmer_CLI.exe',
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
        interface: 'cmsis-dap',
        target: 'stm32f4x',
        baseAddr: '0x08000000',
        runAfterProgram: false,
        sequence: 'helper',
      },
    },
  };
}

function createToolchain() {
  return {
    getConfigSnapshot: vi.fn(() => createSnapshot()),
    getWorkspaceRootPath: vi.fn(() => 'D:/workspace'),
    toWorkspaceRelativePath: vi.fn((value: string) => value),
    openSettings: vi.fn(),
    checkConfig: vi.fn(),
    listProjectTargets: vi.fn(),
    listProjectFiles: vi.fn(async () => []),
    listProjectFilesInFolder: vi.fn(),
    listOpenOcdConfigs: vi.fn(),
    selectJLinkDeviceFromProject: vi.fn(),
  };
}

describe('FirmwareConfigController flasher selection', () => {
  beforeEach(() => {
    showQuickPickMock.mockReset();
    showOpenDialogMock.mockReset();
    showWarningMessageMock.mockReset();
    updateSerialAgentSettingMock.mockReset();
  });

  it('updates flash.method and returns the JLink route when selecting the JLink flasher card action', async () => {
    const refreshState = vi.fn(async () => undefined);
    const controller = new FirmwareConfigController(createToolchain() as any, refreshState);

    const result = await controller.handleAction('selectJlinkFlasher');

    expect(updateSerialAgentSettingMock).toHaveBeenCalledWith('flash.method', 'jlink');
    expect(refreshState).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ nextRoute: 'jlink' });
  });

  it('updates flash.method and returns the OpenOCD route when selecting the OpenOCD flasher card action', async () => {
    const refreshState = vi.fn(async () => undefined);
    const controller = new FirmwareConfigController(createToolchain() as any, refreshState);

    const result = await controller.handleAction('selectOpenOcdFlasher');

    expect(updateSerialAgentSettingMock).toHaveBeenCalledWith('flash.method', 'openocd');
    expect(refreshState).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ nextRoute: 'openocd' });
  });

  it('keeps the existing quick pick flow for Choose Flasher', async () => {
    const refreshState = vi.fn(async () => undefined);
    const controller = new FirmwareConfigController(createToolchain() as any, refreshState);

    showQuickPickMock.mockResolvedValue({ value: 'stlink' });

    const result = await controller.handleAction('pickFlashMethod');

    expect(updateSerialAgentSettingMock).toHaveBeenCalledWith('flash.method', 'stlink');
    expect(refreshState).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ nextRoute: 'stlink' });
  });

  it('shows direct project-file and folder browse entries before discovered project candidates', async () => {
    const refreshState = vi.fn(async () => undefined);
    const toolchain = createToolchain();
    const controller = new FirmwareConfigController(toolchain as any, refreshState);

    toolchain.listProjectFiles.mockResolvedValue([
      'D:/workspace/projects/app1.uvprojx',
      'D:/workspace/projects/app2.uvprojx',
    ]);
    showQuickPickMock.mockResolvedValue(undefined);

    await controller.handleAction('pickProjectFile');

    const [items, options] = showQuickPickMock.mock.calls[0];
    expect(items[0]).toMatchObject({
      label: 'Browse for project file...',
      value: '__browse__',
    });
    expect(items[1]).toMatchObject({
      label: 'Browse for folder...',
      value: '__browse_folder__',
    });
    expect(items[2]).toMatchObject({
      label: 'app1.uvprojx',
      value: 'D:/workspace/projects/app1.uvprojx',
    });
    expect(items[3]).toMatchObject({
      label: 'app2.uvprojx',
      value: 'D:/workspace/projects/app2.uvprojx',
    });
    expect(options).toMatchObject({
      title: 'Build: Project File',
      placeHolder: 'Choose a .uvprojx / .uvproj directly, or choose a folder and let Serial Agent scan it for project files.',
    });
  });

  it('lets Project File browse a folder and pick a discovered project file', async () => {
    const refreshState = vi.fn(async () => undefined);
    const toolchain = createToolchain();
    const controller = new FirmwareConfigController(toolchain as any, refreshState);

    showQuickPickMock.mockResolvedValueOnce({ value: '__browse_folder__' });
    showOpenDialogMock.mockResolvedValue([{ fsPath: 'D:/workspace/projects' }]);
    toolchain.listProjectFilesInFolder.mockResolvedValue(['D:/workspace/projects/demo.uvprojx']);

    await controller.handleAction('pickProjectFile');

    expect(toolchain.listProjectFilesInFolder).toHaveBeenCalledWith('D:/workspace/projects');
    expect(updateSerialAgentSettingMock).toHaveBeenCalledWith('keil.projectFile', 'D:/workspace/projects/demo.uvprojx');
    expect(refreshState).toHaveBeenCalledTimes(1);
  });

  it('warns when Project File folder scan finds no Keil project files', async () => {
    const refreshState = vi.fn(async () => undefined);
    const toolchain = createToolchain();
    const controller = new FirmwareConfigController(toolchain as any, refreshState);

    showQuickPickMock.mockResolvedValueOnce({ value: '__browse_folder__' });
    showOpenDialogMock.mockResolvedValue([{ fsPath: 'D:/workspace/empty' }]);
    toolchain.listProjectFilesInFolder.mockResolvedValue([]);

    await controller.handleAction('pickProjectFile');

    expect(showWarningMessageMock).toHaveBeenCalledWith('[Serial Agent] No .uvprojx/.uvproj files were found in the selected folder.');
    expect(updateSerialAgentSettingMock).not.toHaveBeenCalled();
    expect(refreshState).not.toHaveBeenCalled();
  });

  it('lets Project File pick one file after scanning a folder with multiple projects', async () => {
    const refreshState = vi.fn(async () => undefined);
    const toolchain = createToolchain();
    const controller = new FirmwareConfigController(toolchain as any, refreshState);

    showQuickPickMock
      .mockResolvedValueOnce({ value: '__browse_folder__' })
      .mockResolvedValueOnce({ value: 'D:/workspace/projects/app2.uvprojx' });
    showOpenDialogMock.mockResolvedValue([{ fsPath: 'D:/workspace/projects' }]);
    toolchain.listProjectFilesInFolder.mockResolvedValue([
      'D:/workspace/projects/app1.uvprojx',
      'D:/workspace/projects/app2.uvprojx',
    ]);

    await controller.handleAction('pickProjectFile');

    expect(showQuickPickMock).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({ value: 'D:/workspace/projects/app1.uvprojx' }),
        expect.objectContaining({ value: 'D:/workspace/projects/app2.uvprojx' }),
      ]),
      expect.objectContaining({
        title: 'Build: Project File in Folder',
        placeHolder: 'Choose the project file found under D:/workspace/projects.',
      }),
    );
    expect(updateSerialAgentSettingMock).toHaveBeenCalledWith('keil.projectFile', 'D:/workspace/projects/app2.uvprojx');
    expect(refreshState).toHaveBeenCalledTimes(1);
  });

  it('lets Target fall back to auto mode by clearing keil.target', async () => {
    const refreshState = vi.fn(async () => undefined);
    const toolchain = createToolchain();
    const controller = new FirmwareConfigController(toolchain as any, refreshState);

    toolchain.listProjectTargets.mockResolvedValue(['App', 'Bootloader']);
    showQuickPickMock.mockResolvedValue({ value: '__auto__' });

    await controller.handleAction('pickTarget');

    expect(showQuickPickMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Auto',
          detail: 'Leave this empty to use Auto. Serial Agent will use the first target in demo.uvprojx, and you usually only need to choose one manually when the project has multiple targets.',
          value: '__auto__',
        }),
      ]),
      expect.objectContaining({
        title: 'Build: Select Target',
        placeHolder: 'Optional. Leave this empty to use Auto and build the first target from demo.uvprojx. Only choose one manually when the project has multiple targets.',
      }),
    );
    expect(updateSerialAgentSettingMock).toHaveBeenCalledWith('keil.target', '');
    expect(refreshState).toHaveBeenCalledTimes(1);
  });

  it('uses clear picker copy for JLink, ST-Link, and OpenOCD path actions', async () => {
    const refreshState = vi.fn(async () => undefined);
    const controller = new FirmwareConfigController(createToolchain() as any, refreshState);

    showQuickPickMock.mockResolvedValue(undefined);

    await controller.handleAction('pickJlinkInstallDir');
    await controller.handleAction('pickStlinkExePath');
    await controller.handleAction('pickOpenOcdExePath');

    expect(showQuickPickMock).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Browse for folder...',
          detail: 'Select the JLink install directory, not JLink.exe. Example: C:\\Program Files\\SEGGER\\JLink',
          value: '__browse__',
        }),
      ]),
      expect.objectContaining({
        title: 'JLink: Install Directory',
        placeHolder: 'Choose the SEGGER JLink installation directory. Example: C:\\Program Files\\SEGGER\\JLink',
      }),
    );
    expect(showQuickPickMock).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Browse for executable...',
          detail: 'Select the STM32CubeProgrammer CLI executable. Example: C:\\ST\\STM32CubeCLT\\STM32CubeProgrammer\\bin\\STM32_Programmer_CLI.exe',
          value: '__browse__',
        }),
      ]),
      expect.objectContaining({
        title: 'ST-Link: STM32_Programmer_CLI.exe',
        placeHolder: 'Choose STM32_Programmer_CLI.exe. Example: C:\\ST\\STM32CubeCLT\\STM32CubeProgrammer\\bin\\STM32_Programmer_CLI.exe',
      }),
    );
    expect(showQuickPickMock).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Browse for executable...',
          detail: 'Select the OpenOCD executable from your installation. Example: C:\\OpenOCD\\bin\\openocd.exe',
          value: '__browse__',
        }),
      ]),
      expect.objectContaining({
        title: 'OpenOCD: openocd.exe',
        placeHolder: 'Choose the OpenOCD executable from an official package. Example: C:\\OpenOCD\\bin\\openocd.exe',
      }),
    );
  });
});
