import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (...parts: Array<{ path?: string } | string>) => ({
      path: parts.map((part) => typeof part === 'string' ? part : (part.path ?? '')).join('/'),
    }),
    file: (path: string) => ({ fsPath: path, path }),
  },
  window: {
    showSaveDialog: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    fs: {
      writeFile: vi.fn(),
    },
  },
}));

import { SerialPanelProvider } from '../packages/serialagent-vscode/src/serial-panel-provider';

function createProvider() {
  const context = {
    extensionUri: { path: '/extension-root' },
    globalState: {
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
      update: vi.fn(),
    },
  };

  return new SerialPanelProvider(context as any, {} as any, vi.fn());
}

function createWebview() {
  return {
    cspSource: 'vscode-resource:',
    asWebviewUri: (uri: { path?: string }) => `webview:${uri.path ?? ''}`,
  };
}

function extractBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Failed to extract section between "${start}" and "${end}"`);
  }

  return source.slice(startIndex + start.length, endIndex);
}

describe('SerialPanelProvider accordion layout', () => {
  it('renders mutually exclusive accordion panels with strict titles', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());

    expect(html).toContain('class="accordion-root"');
    expect(html).toContain('data-panel="firmware"');
    expect(html).toContain('data-panel="connection"');
    expect(html).toContain('data-panel="monitor"');
    expect(html).toContain('>Firmware Program Config<');
    expect(html).toContain('>COM Port Config<');
    expect(html).toContain('>Serial Monitor<');
    expect(html).toContain('accordion-panel--monitor is-expanded');
    expect(html).toContain('class="accordion-chevron codicon codicon-chevron-right"');
    expect(html).toContain('font-src vscode-resource:');
    expect(html).toContain('codicon.css');
    expect(html).not.toContain('btn-focus-mode');
    expect(html).not.toContain('btn-log-focus-mode');
    expect(html).not.toContain('Logs Config');
    expect(html).not.toContain('class="status-bar"');
  });

  it('keeps log toolbar inside Serial Monitor without a separate logs config card', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());
    const monitorSection = extractBetween(html, 'id="panel-monitor"', '</section>');
    const logToolbar = extractBetween(monitorSection, '<div class="log-toolbar">', '</div>\n\n    <div class="options-bar">');
    const optionsBar = extractBetween(monitorSection, '<div class="options-bar">', '\n\n  <div class="content-wrapper">');

    expect(logToolbar).toContain('btn-freeze');
    expect(logToolbar).toContain('btn-copy-log');
    expect(logToolbar).toContain('btn-save-log');
    expect(logToolbar).toContain('btn-clear');
    expect(logToolbar).toContain('clear-broom');
    expect(logToolbar).toContain('M14.854 1.146');
    expect(logToolbar).not.toContain('M10 12.6l.7.7');
    expect(logToolbar).not.toContain('opt-auto-scroll');

    expect(optionsBar).toContain('opt-timestamp');
    expect(optionsBar).toContain('opt-hex');
    expect(optionsBar).toContain('opt-echo');
    expect(optionsBar).toContain('opt-auto-scroll');
    expect(optionsBar).not.toContain('btn-log-focus-mode');
  });

  it('places parity and flow control on COM config rows and line ending in send row', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());
    const connectionBody = extractBetween(html, 'id="accordion-body-connection"', 'id="panel-monitor"');

    expect(connectionBody).toContain('id="parity-select"');
    expect(connectionBody).toContain('id="flow-control-select"');
    expect(connectionBody).not.toContain('id="line-ending-select"');
    expect(connectionBody).not.toContain('>Advanced<');
    expect(connectionBody).not.toContain('<details id="advanced-config">');

    const sendRow = extractBetween(html, '<div class="send-options-row">', '</div>\n      <div class="send-input-row">');
    expect(sendRow).toContain('id="line-ending-select"');
    expect(sendRow).toContain('id="opt-hex-send"');
    expect(sendRow).toContain('<span>Hex</span>');
    expect(sendRow).not.toContain('HEX Send');
  });

  it('keeps only build actions in the firmware top bar and preserves summary configure entry', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());
    const firmwareBar = extractBetween(
      html,
      '<div class="action-bar firmware-bar">',
      '</div>\n    <div class="firmware-summary">'
    );
    const firmwareSummaryActions = extractBetween(
      html,
      '<div class="firmware-summary-actions">',
      '\n      </div>\n    </div>'
    );

    expect(firmwareBar).toContain('id="btn-keil-build"');
    expect(firmwareBar).toContain('id="btn-keil-flash"');
    expect(firmwareBar).toContain('id="btn-keil-build-flash"');
    expect(firmwareBar).toContain('id="btn-custom-run"');
    expect(firmwareBar).toContain('id="btn-keil-build" class="btn-secondary"');
    expect(firmwareBar).toContain('id="btn-keil-flash" class="btn-secondary"');
    expect(firmwareBar).toContain('id="btn-custom-run" class="btn-secondary"');
    expect(firmwareBar.indexOf('id="btn-custom-run"')).toBeLessThan(
      firmwareBar.indexOf('id="btn-keil-build-flash"'),
    );
    expect(html).toContain('id="firmware-route-custom"');
    expect(html).toContain('data-firmware-route="custom"');
    expect(html).toContain('Custom Command');
    expect(html).toContain('data-firmware-action="pickCustomMode"');
    expect(html).toContain('data-firmware-action="pickCustomPython"');
    expect(html).toContain('data-firmware-action="pickCustomCommand"');
    expect(html).not.toContain('data-firmware-action="pickCustomExtraArgs"');
    expect(html).not.toContain('data-firmware-action="pickCustomCwd"');
    expect(firmwareBar).not.toContain('id="btn-keil-cpu"');
    expect(firmwareBar).not.toContain('id="btn-keil-config"');

    expect(firmwareSummaryActions).toContain('id="btn-keil-config-inline"');
    expect(firmwareSummaryActions).toContain('class="btn-firmware-cta"');
    expect(firmwareSummaryActions).toContain('codicon-tools');
    expect(firmwareSummaryActions).toContain('Configure');
    expect(firmwareSummaryActions).toContain('id="btn-keil-check"');
    expect(firmwareSummaryActions).toContain('class="btn-firmware-action"');
    expect(firmwareSummaryActions).toContain('codicon-check-all');
    expect(firmwareSummaryActions).toContain('Run Check');
    expect(firmwareSummaryActions).toContain('id="btn-keil-settings"');
    expect(firmwareSummaryActions).toContain('codicon-gear');
    expect(firmwareSummaryActions).toContain('Settings');
    expect(html).toContain('id="btn-firmware-drawer-back"');
    expect(html).toContain('class="btn-firmware-back"');
    expect(html).toContain('codicon-chevron-left');
    expect(html).toContain('UV4.exe path, optional ARMCC5 toolchain path, project file, target.');
    expect(html).toContain('id="fw-build-armcc5"');
    expect(html).toContain('Choose ARMCC5 Folder');
    expect(html).toContain('ARMCC5 Toolchain Path');
    expect(html).not.toContain('UV4 or MDK Path');
  });

  it('wires flasher cards to config actions instead of pure route navigation', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());
    const flashRouteGrid = extractBetween(
      html,
      '<div class="firmware-config-grid firmware-config-grid-flash">',
      '</div>\n      </div>\n\n      <div id="firmware-route-jlink"'
    );

    expect(flashRouteGrid).toContain('data-firmware-action="selectJlinkFlasher"');
    expect(flashRouteGrid).toContain('data-firmware-action="selectStlinkFlasher"');
    expect(flashRouteGrid).toContain('data-firmware-action="selectOpenOcdFlasher"');
  });

  it('explains project file, target, and flasher reference paths clearly in the webview copy', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());

    expect(html).toContain('支持直接选项目文件，也支持先选文件夹再扫描里面的 .uvprojx / .uvproj');
    expect(html).toContain('可选；留空就是 Auto，会使用当前项目里的第一个 Target；通常只有项目里有多个 Target 时，才需要手动选择。');
    expect(html).toContain('例如 C:\\Program Files\\SEGGER\\JLink');
    expect(html).toContain('例如 C:\\ST\\STM32CubeCLT\\STM32CubeProgrammer\\bin\\STM32_Programmer_CLI.exe');
    expect(html).toContain('例如 C:\\OpenOCD\\bin\\openocd.exe');
    expect(html).toContain('例如 stm32f4x；不要填 target\\stm32f4x.cfg');
    expect(html).toContain('例如 cmsis-dap；不要填 interface\\cmsis-dap.cfg');
    expect(html).toContain('Choose Project File');
    expect(html).toContain('Choose Target');
  });

  it('uses a multiline textarea for quick command values', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());

    expect(html).toContain('<textarea id="quick-command-value"');
    expect(html).not.toMatch(/<input[^>]*id="quick-command-value"/);
  });

  it('includes monitor status bar with connect button linked to COM config', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());

    expect(html).toContain('class="monitor-status-bar"');
    expect(html).toContain('id="btn-monitor-connect"');
    expect(html).toContain('id="btn-connect"');
    expect(html).toContain('id="firmware-config-drawer"');
    expect(html).toContain('id="btn-firmware-drawer-close"');
    expect(html).toContain('Close and Return to Serial');
  });

  it('only keeps firmware drawer open while the firmware accordion is active', () => {
    const provider = createProvider();
    const normalize = (provider as any)._normalizePanelUiState.bind(provider);

    expect(normalize({
      activePanel: 'monitor',
      firmwareDrawerOpen: true,
      firmwareDrawerRoute: 'build',
      firmwareDrawerStack: ['home', 'build'],
    })).toEqual({
      activePanel: 'monitor',
      normalSendHeight: undefined,
      firmwareDrawerOpen: false,
      firmwareDrawerRoute: 'home',
      firmwareDrawerStack: ['home'],
    });

    expect(normalize({
      activePanel: 'firmware',
      firmwareDrawerOpen: true,
      firmwareDrawerRoute: 'build',
      firmwareDrawerStack: ['home', 'build'],
    })).toEqual({
      activePanel: 'firmware',
      normalSendHeight: undefined,
      firmwareDrawerOpen: true,
      firmwareDrawerRoute: 'build',
      firmwareDrawerStack: ['home', 'build'],
    });
  });
});
