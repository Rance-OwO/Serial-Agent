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

describe('SerialPanelProvider log config layout', () => {
  it('keeps auto scroll with checkbox options and adds a second focus entry in logs config', () => {
    const provider = createProvider();
    const html = (provider as any)._getHtmlForWebview(createWebview());
    const logToolbar = extractBetween(html, '<div class="log-toolbar">', '</div>\n\n    <div class="options-bar">');
    const optionsBar = extractBetween(html, '<div class="options-bar">', '\n    </div>\n  </div>\n\n  <div class="content-wrapper">');

    expect(logToolbar).toContain('btn-freeze');
    expect(logToolbar).toContain('btn-copy-log');
    expect(logToolbar).toContain('btn-save-log');
    expect(logToolbar).toContain('btn-clear');
    expect(logToolbar).toContain('btn-icon-compact');
    expect(logToolbar).toContain('title="Clear logs"');
    expect(logToolbar).not.toContain('>Clear<');
    expect(logToolbar).not.toContain('opt-auto-scroll');

    expect(optionsBar).toContain('opt-timestamp');
    expect(optionsBar).toContain('opt-hex');
    expect(optionsBar).toContain('opt-echo');
    expect(optionsBar).toContain('opt-auto-scroll');
    expect(optionsBar).toContain('btn-log-focus-mode');

    expect(html).toContain('id="btn-focus-mode"');
    expect(html).toContain('id="btn-log-focus-mode"');
    expect(html).toContain('id="firmware-config-drawer"');
    expect(html).toContain('id="btn-firmware-drawer-close"');
    expect(html).toContain('Close and Return to Serial');
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
    expect(firmwareBar).not.toContain('id="btn-keil-cpu"');
    expect(firmwareBar).not.toContain('id="btn-keil-config"');

    expect(firmwareSummaryActions).toContain('id="btn-keil-config-inline"');
    expect(firmwareSummaryActions).toContain('>Configure<');
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
});

