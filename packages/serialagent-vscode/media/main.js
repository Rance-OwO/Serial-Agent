// @ts-check

/**
 * Serial Agent 侧边栏 Webview 脚本
 *
 * P0 目标：
 * - 日志工具条：搜索、冻结、自动滚动、复制、保存
 * - 常用发送区：命令预设的一键发送和管理
 * - 连接配置预设：保存和快速切换常用串口配置
 * - 空状态引导：未连接时给出下一步提示
 */

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const MAX_HISTORY = 20;
  const MAX_RENDER_ENTRIES = 5000;
  const DEFAULT_NORMAL_SEND_HEIGHT = 38;
  const DEFAULT_FOCUS_SEND_HEIGHT = 30;

  /**
   * @typedef {{ id: string; label: string; value: string; hexSend?: boolean }} QuickCommand
   */

  /**
   * @typedef {{ text: string; kind: 'text' | 'echo' }} LogEntry
   */

  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const rxCountEl = document.getElementById('rx-count');
  const txCountEl = document.getElementById('tx-count');
  const focusModeBtn = document.getElementById('btn-focus-mode');
  const logFocusModeBtn = document.getElementById('btn-log-focus-mode');
  const focusConnectBtn = document.getElementById('btn-focus-connect');

  /** @type {HTMLSelectElement | null} */
  const portSelect = /** @type {HTMLSelectElement} */ (document.getElementById('port-select'));
  /** @type {HTMLInputElement | null} */
  const baudrateInput = /** @type {HTMLInputElement} */ (document.getElementById('baudrate-input'));
  /** @type {HTMLSelectElement | null} */
  const databitsSelect = /** @type {HTMLSelectElement} */ (document.getElementById('databits-select'));
  /** @type {HTMLSelectElement | null} */
  const paritySelect = /** @type {HTMLSelectElement} */ (document.getElementById('parity-select'));
  /** @type {HTMLSelectElement | null} */
  const stopbitsSelect = /** @type {HTMLSelectElement} */ (document.getElementById('stopbits-select'));
  /** @type {HTMLSelectElement | null} */
  const lineEndingSelect = /** @type {HTMLSelectElement} */ (document.getElementById('line-ending-select'));

  const refreshBtn = document.getElementById('btn-refresh');
  const connectBtn = document.getElementById('btn-connect');
  const clearBtn = document.getElementById('btn-clear');
  const keilBuildBtn = document.getElementById('btn-keil-build');
  const keilFlashBtn = document.getElementById('btn-keil-flash');
  const keilBuildFlashBtn = document.getElementById('btn-keil-build-flash');
  const keilConfigInlineBtn = document.getElementById('btn-keil-config-inline');
  const keilCheckBtn = document.getElementById('btn-keil-check');
  const keilSettingsBtn = document.getElementById('btn-keil-settings');
  const keilStatusEl = document.getElementById('keil-status');
  const firmwareSummaryStatusEl = document.getElementById('firmware-summary-status');
  const firmwareSummaryBuildEl = document.getElementById('firmware-summary-build');
  const firmwareSummaryFlashEl = document.getElementById('firmware-summary-flash');
  const firmwareSummaryHintEl = document.getElementById('firmware-summary-hint');
  const firmwareSummaryWarningsEl = document.getElementById('firmware-summary-warnings');
  const firmwareConfigDrawer = document.getElementById('firmware-config-drawer');
  const firmwareDrawerTitleEl = document.getElementById('firmware-drawer-route-title');
  const firmwareDrawerBackBtn = document.getElementById('btn-firmware-drawer-back');
  const firmwareDrawerCloseBtn = document.getElementById('btn-firmware-drawer-close');
  const firmwareRouteViews = Array.from(document.querySelectorAll('.firmware-config-route'));
  const firmwareRouteButtons = Array.from(document.querySelectorAll('[data-firmware-route]'));
  const firmwareActionButtons = Array.from(document.querySelectorAll('[data-firmware-action]'));

  /** @type {HTMLInputElement | null} */
  const optTimestamp = /** @type {HTMLInputElement} */ (document.getElementById('opt-timestamp'));
  /** @type {HTMLInputElement | null} */
  const optHex = /** @type {HTMLInputElement} */ (document.getElementById('opt-hex'));
  /** @type {HTMLInputElement | null} */
  const optHexSend = /** @type {HTMLInputElement} */ (document.getElementById('opt-hex-send'));
  /** @type {HTMLInputElement | null} */
  const optEcho = /** @type {HTMLInputElement} */ (document.getElementById('opt-echo'));
  /** @type {HTMLInputElement | null} */
  const optAutoScroll = /** @type {HTMLInputElement} */ (document.getElementById('opt-auto-scroll'));

  const logArea = document.getElementById('log-area');
  const logEmptyState = document.getElementById('log-empty-state');
  /** @type {HTMLInputElement | null} */
  const logSearchInput = /** @type {HTMLInputElement} */ (document.getElementById('log-search'));
  const freezeBtn = document.getElementById('btn-freeze');
  const copyLogBtn = document.getElementById('btn-copy-log');
  const saveLogBtn = document.getElementById('btn-save-log');

  /** @type {HTMLTextAreaElement | null} */
  const sendInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('send-input'));
  /** @type {HTMLButtonElement | null} */
  const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-send'));
  const historyDropdown = document.getElementById('history-dropdown');
  const historyToggle = document.getElementById('history-toggle');
  const historyMenu = document.getElementById('history-menu');
  const resizeHandle = document.getElementById('resize-handle');
  const sendSection = document.getElementById('send-section');
  const contentWrapper = document.querySelector('.content-wrapper');

  const quickCommandBar = document.querySelector('.quick-command-bar');
  const quickCommandList = document.getElementById('quick-command-list');
  const quickCommandManageList = document.getElementById('quick-command-manage-list');
  /** @type {HTMLInputElement | null} */
  const quickCommandLabelInput = /** @type {HTMLInputElement} */ (document.getElementById('quick-command-label'));
  /** @type {HTMLInputElement | null} */
  const quickCommandValueInput = /** @type {HTMLInputElement} */ (document.getElementById('quick-command-value'));
  /** @type {HTMLInputElement | null} */
  const quickCommandHexInput = /** @type {HTMLInputElement} */ (document.getElementById('quick-command-hex'));
  const quickCommandSaveBtn = document.getElementById('btn-quick-command-save');
  const quickCommandResetBtn = document.getElementById('btn-quick-command-reset');

  let connected = false;
  let pendingPort = '';
  let sendHistory = /** @type {string[]} */ ([]);
  let quickCommands = /** @type {QuickCommand[]} */ ([]);
  let editingQuickCommandId = '';
  let frozenLog = false;
  let logEntries = /** @type {LogEntry[]} */ ([]);
  let activeLogFilter = '';
  let focusMode = false;
  let normalSendHeight;
  let focusSendHeight;
  let firmwareDrawerOpen = false;
  let firmwareDrawerRoute = 'home';
  let firmwareDrawerStack = ['home'];
  let firmwareConfigSnapshot = null;
  let keilBusy = false;

  restoreWebviewState();

  bindSerialActions();
  bindFirmwareDrawerActions();
  bindLogActions();
  bindSendActions();
  bindQuickCommandActions();
  bindResizeActions();

  function restoreWebviewState() {
    const previousState = vscode.getState();
    if (!previousState) {
      return;
    }

    if (sendInput && previousState.sendText) {
      sendInput.value = previousState.sendText;
    }
    if (optHexSend && previousState.hexSend) {
      optHexSend.checked = true;
    }
    if (optAutoScroll && previousState.autoScroll !== undefined) {
      optAutoScroll.checked = !!previousState.autoScroll;
    }
    if (logSearchInput && previousState.logFilter) {
      logSearchInput.value = previousState.logFilter;
      activeLogFilter = previousState.logFilter.toLowerCase();
    }
    if (previousState.frozenLog) {
      frozenLog = true;
      updateFreezeButton();
    }
    updateSendPlaceholder();
  }

  function saveState() {
    vscode.setState({
      sendText: sendInput?.value || '',
      hexSend: optHexSend?.checked || false,
      autoScroll: optAutoScroll?.checked || false,
      logFilter: logSearchInput?.value || '',
      frozenLog,
    });
  }

  function bindSerialActions() {
    refreshBtn?.addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshPorts' });
    });

    connectBtn?.addEventListener('click', handleConnectionToggle);
    focusConnectBtn?.addEventListener('click', handleConnectionToggle);
    [focusModeBtn, logFocusModeBtn].forEach((button) => {
      button?.addEventListener('click', () => {
        vscode.postMessage({ type: 'toggleFocusMode', focusMode: !focusMode });
      });
    });

    keilBuildBtn?.addEventListener('click', () => {
      vscode.postMessage({ type: 'keilBuild' });
    });
    keilFlashBtn?.addEventListener('click', () => {
      vscode.postMessage({ type: 'keilFlash' });
    });
    keilBuildFlashBtn?.addEventListener('click', () => {
      vscode.postMessage({ type: 'keilBuildFlash' });
    });
    keilConfigInlineBtn?.addEventListener('click', () => {
      openFirmwareDrawer('home');
    });
    keilCheckBtn?.addEventListener('click', () => {
      vscode.postMessage({ type: 'keilRunConfigCheck' });
    });
    keilSettingsBtn?.addEventListener('click', () => {
      vscode.postMessage({ type: 'keilOpenAdvancedSettings' });
    });

    optTimestamp?.addEventListener('change', () => {
      vscode.postMessage({ type: 'updateSettings', showTimestamp: optTimestamp.checked });
    });
    optHex?.addEventListener('change', () => {
      vscode.postMessage({ type: 'updateSettings', hexMode: optHex.checked });
    });
    lineEndingSelect?.addEventListener('change', () => {
      vscode.postMessage({ type: 'updateSettings', lineEnding: lineEndingSelect.value });
    });

    [
      portSelect,
      baudrateInput,
      databitsSelect,
      paritySelect,
      stopbitsSelect,
      lineEndingSelect,
    ].forEach((element) => {
      element?.addEventListener('change', persistCurrentConfigDraft);
    });
  }

  function bindFirmwareDrawerActions() {
    firmwareDrawerBackBtn?.addEventListener('click', () => {
      navigateFirmwareDrawerBack();
    });

    firmwareDrawerCloseBtn?.addEventListener('click', () => {
      closeFirmwareDrawer(true);
    });

    firmwareRouteButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (keilBusy) {
          return;
        }

        const action = button.getAttribute('data-firmware-action');
        if (action) {
          vscode.postMessage({
            type: 'firmwareConfigAction',
            action,
            route: firmwareDrawerRoute,
          });
          return;
        }

        navigateFirmwareDrawer(button.getAttribute('data-firmware-route') || 'home');
      });
    });

    firmwareActionButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (keilBusy) {
          return;
        }

        const action = button.getAttribute('data-firmware-action');
        if (!action) {
          return;
        }

        vscode.postMessage({
          type: 'firmwareConfigAction',
          action,
          route: firmwareDrawerRoute,
        });
      });
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && firmwareDrawerOpen) {
        event.preventDefault();
        closeFirmwareDrawer(true);
      }
    });
  }

  function bindLogActions() {
    logSearchInput?.addEventListener('input', () => {
      activeLogFilter = (logSearchInput.value || '').trim().toLowerCase();
      renderLogArea();
      saveState();
    });

    optAutoScroll?.addEventListener('change', () => {
      if (optAutoScroll.checked && !frozenLog) {
        scrollLogToBottom();
      }
      saveState();
    });

    freezeBtn?.addEventListener('click', () => {
      frozenLog = !frozenLog;
      updateFreezeButton();
      if (!frozenLog) {
        renderLogArea();
      }
      saveState();
    });

    clearBtn?.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearLog' });
      logEntries = [];
      renderLogArea();
    });

    copyLogBtn?.addEventListener('click', async () => {
      const visibleLog = getVisibleLogText();
      if (!visibleLog.length) {
        return;
      }
      try {
        await navigator.clipboard.writeText(visibleLog);
      } catch {
        const range = document.createRange();
        if (logArea) {
          range.selectNodeContents(logArea);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.execCommand('copy');
          selection?.removeAllRanges();
        }
      }
    });

    saveLogBtn?.addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveLogToFile',
        lines: logEntries.map((entry) => entry.text.trimEnd()),
      });
    });
  }

  function bindSendActions() {
    optHexSend?.addEventListener('change', () => {
      updateSendPlaceholder();
      saveState();
    });

    sendBtn?.addEventListener('click', () => {
      doSend();
    });

    sendInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        doSend();
      }
    });

    sendInput?.addEventListener('input', saveState);

    historyToggle?.addEventListener('click', () => {
      historyDropdown?.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
      if (historyDropdown && !historyDropdown.contains(/** @type {Node} */ (event.target))) {
        historyDropdown.classList.remove('open');
      }
    });
  }

  function bindQuickCommandActions() {
    quickCommandSaveBtn?.addEventListener('click', () => {
      const label = (quickCommandLabelInput?.value || '').trim();
      const value = quickCommandValueInput?.value || '';

      if (!label || !value.trim()) {
        return;
      }

      const command = {
        id: editingQuickCommandId || createId('cmd'),
        label,
        value,
        hexSend: !!quickCommandHexInput?.checked,
      };

      const existingIndex = quickCommands.findIndex((item) => item.id === command.id);
      if (existingIndex !== -1) {
        quickCommands.splice(existingIndex, 1, command);
      } else {
        quickCommands.unshift(command);
      }

      quickCommands = quickCommands.slice(0, 12);
      persistQuickCommands();
      renderQuickCommands();
      resetQuickCommandForm();
    });

    quickCommandResetBtn?.addEventListener('click', () => {
      resetQuickCommandForm();
    });
  }

  function bindResizeActions() {
    if (!(resizeHandle && sendSection && contentWrapper instanceof HTMLElement)) {
      return;
    }

    const MIN_LOG_HEIGHT = 60;
    const MIN_SEND_HEIGHT = 60;
    let dragging = false;
    let startY = 0;
    let startHeight = 0;
    let wrapperHeight = 0;

    resizeHandle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      dragging = true;
      startY = event.clientY;
      startHeight = sendSection.offsetHeight;
      wrapperHeight = contentWrapper.clientHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (event) => {
      if (!dragging) {
        return;
      }

      const delta = startY - event.clientY;
      const maxHeight = Math.max(
        MIN_SEND_HEIGHT,
        wrapperHeight - MIN_LOG_HEIGHT - resizeHandle.offsetHeight,
      );
      const nextHeight = Math.max(MIN_SEND_HEIGHT, Math.min(maxHeight, startHeight + delta));
      sendSection.style.flexBasis = nextHeight + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveCurrentLayout();
      saveState();
    });
  }

  function handleConnectionToggle() {
    if (connected) {
      vscode.postMessage({ type: 'disconnect' });
      return;
    }

    const config = collectCurrentConfig();
    vscode.postMessage({ type: 'connect', ...config });
    vscode.postMessage({ type: 'saveConfig', config });
  }

  function getActiveSendHeight() {
    return focusMode ? focusSendHeight : normalSendHeight;
  }

  function getDefaultSendHeight() {
    return focusMode ? DEFAULT_FOCUS_SEND_HEIGHT : DEFAULT_NORMAL_SEND_HEIGHT;
  }

  function applyCurrentLayout() {
    if (!sendSection) {
      return;
    }

    const nextHeight = getActiveSendHeight();
    sendSection.style.flexBasis = `${nextHeight ?? getDefaultSendHeight()}%`;
  }

  function saveCurrentLayout() {
    if (!(sendSection && contentWrapper instanceof HTMLElement)) {
      return;
    }

    const wrapperHeight = contentWrapper.clientHeight;
    if (!wrapperHeight) {
      return;
    }

    const nextHeight = Math.max(10, Math.min(90, (sendSection.offsetHeight / wrapperHeight) * 100));
    if (focusMode) {
      focusSendHeight = nextHeight;
      vscode.postMessage({ type: 'saveFocusLayout', focusSendHeight: nextHeight });
      return;
    }

    normalSendHeight = nextHeight;
    vscode.postMessage({ type: 'saveFocusLayout', normalSendHeight: nextHeight });
  }

  function updateConnectionButtons() {
    if (connectBtn) {
      connectBtn.textContent = connected ? 'Close' : 'Open';
      connectBtn.className = connected ? 'btn-danger' : 'btn-primary';
    }

    if (focusConnectBtn) {
      focusConnectBtn.textContent = connected ? 'Close' : 'Open';
      focusConnectBtn.classList.toggle('status-action-primary', !connected);
      focusConnectBtn.classList.toggle('status-action-danger', connected);
    }
  }

  function updateFocusButton() {
    [focusModeBtn, logFocusModeBtn].forEach((button) => {
      if (!button) {
        return;
      }

      button.textContent = focusMode ? 'Exit Focus' : 'Focus';
      button.title = focusMode ? 'Exit focus mode' : 'Enter focus mode';
      button.classList.toggle('is-active', focusMode);
    });
  }

  function applyUiState(uiState) {
    focusMode = !!uiState?.focusMode;
    normalSendHeight = typeof uiState?.normalSendHeight === 'number'
      ? uiState.normalSendHeight
      : normalSendHeight;
    focusSendHeight = typeof uiState?.focusSendHeight === 'number'
      ? uiState.focusSendHeight
      : focusSendHeight;
    firmwareDrawerOpen = !!uiState?.firmwareDrawerOpen && !focusMode;
    firmwareDrawerRoute = normalizeFirmwareDrawerRoute(uiState?.firmwareDrawerRoute);
    firmwareDrawerStack = normalizeFirmwareDrawerStack(
      uiState?.firmwareDrawerStack,
      firmwareDrawerOpen ? firmwareDrawerRoute : 'home',
      firmwareDrawerOpen,
    );

    document.body.classList.toggle('focus-mode', focusMode);
    if (focusConnectBtn) {
      focusConnectBtn.hidden = !focusMode;
    }
    updateFocusButton();
    updateConnectionButtons();
    applyCurrentLayout();
    renderFirmwareDrawer();
  }

  function normalizeFirmwareDrawerRoute(route) {
    switch (route) {
      case 'build':
      case 'flash':
      case 'jlink':
      case 'stlink':
      case 'openocd':
        return route;
      case 'home':
      default:
        return 'home';
    }
  }

  function normalizeFirmwareDrawerStack(stack, fallbackRoute, open) {
    if (!open) {
      return ['home'];
    }

    const route = normalizeFirmwareDrawerRoute(fallbackRoute);
    if (!Array.isArray(stack) || stack.length === 0) {
      return route === 'home' ? ['home'] : ['home', route];
    }

    const normalized = stack
      .map((item) => normalizeFirmwareDrawerRoute(item))
      .filter((item, index, routes) => item !== routes[index - 1]);

    if (normalized.length === 0) {
      return route === 'home' ? ['home'] : ['home', route];
    }

    if (normalized[0] !== 'home') {
      normalized.unshift('home');
    }

    if (normalized[normalized.length - 1] !== route) {
      normalized.push(route);
    }

    return normalized;
  }

  function getFirmwareDrawerTitle(route) {
    switch (route) {
      case 'build':
        return 'Build Essentials';
      case 'flash':
        return 'Flash Essentials';
      case 'jlink':
        return 'JLink';
      case 'stlink':
        return 'ST-Link';
      case 'openocd':
        return 'OpenOCD';
      case 'home':
      default:
        return 'Home';
    }
  }

  function persistFirmwareDrawerState() {
    vscode.postMessage({
      type: 'savePanelUiState',
      firmwareDrawerOpen,
      firmwareDrawerRoute,
      firmwareDrawerStack,
    });
  }

  function renderFirmwareDrawer() {
    const open = firmwareDrawerOpen && !focusMode;
    document.body.classList.toggle('firmware-config-open', open);
    firmwareConfigDrawer?.classList.toggle('hidden', !open);

    if (firmwareDrawerTitleEl) {
      firmwareDrawerTitleEl.textContent = getFirmwareDrawerTitle(firmwareDrawerRoute);
    }

    firmwareRouteViews.forEach((view) => {
      const route = view.id.replace('firmware-route-', '');
      view.classList.toggle('hidden', route !== firmwareDrawerRoute);
    });

    firmwareRouteButtons.forEach((button) => {
      const isActive = button.getAttribute('data-firmware-route') === firmwareDrawerRoute;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    if (firmwareDrawerBackBtn) {
      firmwareDrawerBackBtn.disabled = !open || firmwareDrawerStack.length <= 1;
    }

    updateFirmwareActionButtons();
  }

  function updateFirmwareActionButtons() {
    firmwareActionButtons.forEach((button) => {
      const lockOnBusy = button.getAttribute('data-keil-busy-lock') === 'true';
      button.disabled = lockOnBusy ? keilBusy : false;
    });
  }

  function setFirmwareDrawerState(nextOpen, nextRoute, nextStack, options) {
    const route = normalizeFirmwareDrawerRoute(nextRoute);
    const open = !!nextOpen && !focusMode;
    firmwareDrawerOpen = open;
    firmwareDrawerRoute = open ? route : 'home';
    firmwareDrawerStack = normalizeFirmwareDrawerStack(
      nextStack,
      open ? route : 'home',
      open,
    );
    renderFirmwareDrawer();
    if (options?.persist !== false) {
      persistFirmwareDrawerState();
    }
    if (options?.focusLog) {
      focusLogArea();
    }
  }

  function openFirmwareDrawer(route) {
    const targetRoute = normalizeFirmwareDrawerRoute(route);
    const nextStack = targetRoute === 'home' ? ['home'] : ['home', targetRoute];
    setFirmwareDrawerState(true, targetRoute, nextStack, { persist: true });
  }

  function navigateFirmwareDrawer(route) {
    const targetRoute = normalizeFirmwareDrawerRoute(route);
    if (!firmwareDrawerOpen) {
      openFirmwareDrawer(targetRoute);
      return;
    }

    if (targetRoute === 'home') {
      setFirmwareDrawerState(true, 'home', ['home'], { persist: true });
      return;
    }

    const currentStack = firmwareDrawerStack.slice();
    if (currentStack[currentStack.length - 1] === targetRoute) {
      return;
    }

    currentStack.push(targetRoute);
    setFirmwareDrawerState(true, targetRoute, currentStack, { persist: true });
  }

  function navigateFirmwareDrawerBack() {
    if (!firmwareDrawerOpen || firmwareDrawerStack.length <= 1) {
      return;
    }

    const nextStack = firmwareDrawerStack.slice(0, -1);
    const nextRoute = nextStack[nextStack.length - 1] || 'home';
    setFirmwareDrawerState(true, nextRoute, nextStack, { persist: true });
  }

  function closeFirmwareDrawer(focusLog) {
    setFirmwareDrawerState(false, 'home', ['home'], {
      persist: true,
      focusLog: !!focusLog,
    });
  }

  function focusLogArea() {
    if (!(logArea instanceof HTMLElement)) {
      return;
    }

    try {
      logArea.focus({ preventScroll: true });
    } catch {
      logArea.focus();
    }
  }

  function formatFirmwarePath(value, emptyText) {
    if (!value) {
      return emptyText;
    }
    return String(value);
  }

  function setFirmwareValue(id, text) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    }
  }

  function renderFirmwareSnapshot(snapshot) {
    firmwareConfigSnapshot = snapshot || null;
    if (!firmwareConfigSnapshot) {
      return;
    }

    const keil = firmwareConfigSnapshot.keil || {};
    const flash = firmwareConfigSnapshot.flash || {};
    const jlink = flash.jlink || {};
    const stlink = flash.stlink || {};
    const openocd = flash.openocd || {};

    setFirmwareValue('fw-build-uv4', formatFirmwarePath(keil.uv4Path, 'Choose Keil MDK-ARM UV4.exe'));
    setFirmwareValue('fw-build-armcc5', formatFirmwarePath(keil.armcc5Path, 'Optional ARMCC5 bin directory'));
    setFirmwareValue('fw-build-project', formatFirmwarePath(keil.projectFile, 'Choose .uvprojx / .uvproj directly, or scan a folder'));
    setFirmwareValue('fw-build-target', keil.target || 'Optional: Auto uses the first target in the project');

    setFirmwareValue(
      'fw-flash-f7',
      keil.f7Action === 'buildAndFlash'
        ? 'Build+Flash'
        : (keil.f7Action === 'flash' ? 'Flash' : 'Build'),
    );
    setFirmwareValue('fw-flash-method', getFirmwareMethodLabel(flash.method));

    setFirmwareValue('fw-jlink-install', formatFirmwarePath(jlink.installDirectory, 'Choose JLink install directory'));
    setFirmwareValue('fw-jlink-device', jlink.device || 'Select JLink CPU');
    setFirmwareValue('fw-jlink-interface', jlink.interface || 'SWD');
    setFirmwareValue('fw-jlink-speed', jlink.speed ? `${jlink.speed} kHz` : 'Choose JLink speed');
    setFirmwareValue('fw-jlink-base', jlink.baseAddr || '0x08000000');

    setFirmwareValue('fw-stlink-exe', formatFirmwarePath(stlink.exePath, 'Choose STM32_Programmer_CLI.exe'));
    setFirmwareValue('fw-stlink-interface', stlink.interface || 'SWD');
    setFirmwareValue('fw-stlink-speed', stlink.speed ? `${stlink.speed} kHz` : 'Choose ST-Link speed');
    setFirmwareValue('fw-stlink-base', stlink.baseAddr || '0x08000000');
    setFirmwareValue('fw-stlink-reset', stlink.resetMode || 'default');
    setFirmwareValue('fw-stlink-run-after', stlink.runAfterProgram ? 'Yes' : 'No');

    setFirmwareValue('fw-openocd-exe', formatFirmwarePath(openocd.exePath, 'Choose openocd.exe'));
    setFirmwareValue('fw-openocd-target', openocd.target ? `${openocd.target}.cfg` : 'Choose target short name (.cfg)');
    setFirmwareValue('fw-openocd-interface', openocd.interface ? `${openocd.interface}.cfg` : 'Choose interface short name (.cfg)');
    setFirmwareValue('fw-openocd-sequence', openocd.sequence || 'helper');
    setFirmwareValue('fw-openocd-base', openocd.baseAddr || '0x08000000');
    setFirmwareValue('fw-openocd-run-after', openocd.runAfterProgram ? 'Yes' : 'No');
  }

  function getFirmwareMethodLabel(method) {
    switch (method) {
      case 'stlink':
        return 'ST-Link';
      case 'openocd':
        return 'OpenOCD';
      default:
        return 'JLink';
    }
  }

  function collectCurrentConfig() {
    return {
      port: portSelect?.value || '',
      baudRate: parseInt(baudrateInput?.value || '115200', 10),
      dataBits: parseInt(databitsSelect?.value || '8', 10),
      parity: paritySelect?.value || 'none',
      stopBits: parseFloat(stopbitsSelect?.value || '1'),
      lineEnding: lineEndingSelect?.value || 'none',
      showTimestamp: !!optTimestamp?.checked,
      hexMode: !!optHex?.checked,
    };
  }

  /**
   * @param {{ port: string; baudRate: number; dataBits: number; parity: string; stopBits: number; lineEnding: string; showTimestamp: boolean; hexMode: boolean }} config
   */
  function applyConfigToInputs(config) {
    if (portSelect) { portSelect.value = config.port || ''; }
    if (baudrateInput) { baudrateInput.value = String(config.baudRate || 115200); }
    if (databitsSelect) { databitsSelect.value = String(config.dataBits || 8); }
    if (paritySelect) { paritySelect.value = config.parity || 'none'; }
    if (stopbitsSelect) { stopbitsSelect.value = String(config.stopBits || 1); }
    if (lineEndingSelect) { lineEndingSelect.value = config.lineEnding || 'none'; }
    if (optTimestamp) { optTimestamp.checked = !!config.showTimestamp; }
    if (optHex) { optHex.checked = !!config.hexMode; }
  }

  function persistCurrentConfigDraft() {
    vscode.postMessage({ type: 'saveConfig', config: collectCurrentConfig() });
  }

  function persistQuickCommands() {
    vscode.postMessage({ type: 'saveQuickCommands', commands: quickCommands });
  }

  function renderQuickCommands() {
    renderQuickCommandButtons();
    renderQuickCommandManager();
  }

  function renderQuickCommandButtons() {
    if (!quickCommandList) {
      return;
    }

    quickCommandBar?.classList.toggle('hidden', quickCommands.length === 0);
    quickCommandList.innerHTML = '';
    if (quickCommands.length === 0) {
      return;
    }

    quickCommands.forEach((command) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-command-chip';
      button.textContent = command.label;
      button.title = command.value;
      button.addEventListener('click', () => {
        sendData(command.value, !!command.hexSend);
      });
      quickCommandList.appendChild(button);
    });
  }

  function renderQuickCommandManager() {
    if (!quickCommandManageList) {
      return;
    }

    quickCommandManageList.innerHTML = '';

    quickCommands.forEach((command) => {
      const row = document.createElement('div');
      row.className = 'quick-command-manage-item';

      const meta = document.createElement('div');
      meta.className = 'quick-command-manage-meta';
      meta.textContent = `${command.label} · ${command.hexSend ? 'HEX' : 'Text'} · ${command.value}`;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-secondary btn-compact';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        editingQuickCommandId = command.id;
        if (quickCommandLabelInput) { quickCommandLabelInput.value = command.label; }
        if (quickCommandValueInput) { quickCommandValueInput.value = command.value; }
        if (quickCommandHexInput) { quickCommandHexInput.checked = !!command.hexSend; }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-secondary btn-compact';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        quickCommands = quickCommands.filter((item) => item.id !== command.id);
        persistQuickCommands();
        renderQuickCommands();
        if (editingQuickCommandId === command.id) {
          resetQuickCommandForm();
        }
      });

      row.appendChild(meta);
      row.appendChild(editBtn);
      row.appendChild(deleteBtn);
      quickCommandManageList.appendChild(row);
    });
  }

  function resetQuickCommandForm() {
    editingQuickCommandId = '';
    if (quickCommandLabelInput) { quickCommandLabelInput.value = ''; }
    if (quickCommandValueInput) { quickCommandValueInput.value = ''; }
    if (quickCommandHexInput) { quickCommandHexInput.checked = false; }
  }

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function updateSendPlaceholder() {
    if (!sendInput) {
      return;
    }
    sendInput.placeholder = optHexSend?.checked
      ? 'HEX: 41 42 0D 0A (Ctrl+Enter to send)'
      : 'Send data... (Ctrl+Enter to send)';
  }

  function doSend() {
    const text = sendInput?.value || '';
    if (!text.trim()) {
      return;
    }
    sendData(text, !!optHexSend?.checked);
    sendInput?.select();
  }

  function sendData(text, hexSend) {
    if (!connected) {
      return;
    }
    vscode.postMessage({ type: 'sendData', text, hexSend });

    if (optEcho?.checked) {
      appendLogEntry(`TX>> ${text}`, 'echo');
    }

    const historyIndex = sendHistory.indexOf(text);
    if (historyIndex !== -1) {
      sendHistory.splice(historyIndex, 1);
    }
    sendHistory.unshift(text);
    if (sendHistory.length > MAX_HISTORY) {
      sendHistory.pop();
    }
    updateHistorySelect();
    vscode.postMessage({ type: 'saveSendHistory', history: sendHistory });
    saveState();
  }

  function updateHistorySelect() {
    if (!historyMenu) {
      return;
    }

    historyMenu.innerHTML = '';
    if (sendHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No history';
      historyMenu.appendChild(empty);
      return;
    }

    sendHistory.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const textSpan = document.createElement('span');
      textSpan.className = 'history-text';
      textSpan.textContent = item.length > 50 ? item.substring(0, 47) + '...' : item;
      textSpan.title = item;
      textSpan.addEventListener('click', () => {
        if (sendInput) {
          sendInput.value = item;
          sendInput.focus();
          saveState();
        }
        historyDropdown?.classList.remove('open');
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-delete';
      deleteBtn.textContent = '\u00d7';
      deleteBtn.title = 'Delete this entry';
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        sendHistory.splice(index, 1);
        updateHistorySelect();
        vscode.postMessage({ type: 'saveSendHistory', history: sendHistory });
      });

      row.appendChild(textSpan);
      row.appendChild(deleteBtn);
      historyMenu.appendChild(row);
    });
  }

  function appendLogEntry(text, kind) {
    logEntries.push({ text, kind });
    if (logEntries.length > MAX_RENDER_ENTRIES) {
      logEntries = logEntries.slice(logEntries.length - MAX_RENDER_ENTRIES);
    }

    if (!frozenLog) {
      renderLogArea();
    } else {
      updateEmptyState();
    }
  }

  function renderLogArea() {
    if (!logArea) {
      return;
    }

    logArea.innerHTML = '';

    const visibleEntries = getVisibleEntries();
    visibleEntries.forEach((entry) => {
      const line = document.createElement('div');
      line.className = entry.kind === 'echo' ? 'log-line log-echo' : 'log-line';
      line.textContent = entry.text;
      logArea.appendChild(line);
    });

    updateEmptyState();
    if (optAutoScroll?.checked && !frozenLog) {
      scrollLogToBottom();
    }
  }

  function getVisibleEntries() {
    if (!activeLogFilter) {
      return logEntries;
    }
    return logEntries.filter((entry) => entry.text.toLowerCase().includes(activeLogFilter));
  }

  function getVisibleLogText() {
    return getVisibleEntries().map((entry) => entry.text).join('\n');
  }

  function updateEmptyState() {
    if (!logEmptyState) {
      return;
    }

    const hasEntries = getVisibleEntries().length > 0;
    logEmptyState.classList.toggle('hidden', hasEntries);
    if (hasEntries) {
      return;
    }

    if (activeLogFilter) {
      logEmptyState.textContent = 'Waiting RX data...';
      return;
    }

    if (connected) {
      logEmptyState.textContent = 'Waiting RX data...';
      return;
    }

    logEmptyState.textContent = 'Waiting RX data...';
  }

  function updateFreezeButton() {
    if (!freezeBtn) {
      return;
    }
    freezeBtn.textContent = frozenLog ? 'Resume' : 'Freeze';
    freezeBtn.classList.toggle('btn-primary', frozenLog);
    freezeBtn.classList.toggle('btn-secondary', !frozenLog);
  }

  function scrollLogToBottom() {
    if (!logArea) {
      return;
    }
    logArea.scrollTop = logArea.scrollHeight;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1048576) { return (bytes / 1024).toFixed(1) + ' KB'; }
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function renderFirmwareSummary(summary) {
    if (!summary) {
      return;
    }

    if (firmwareSummaryStatusEl) {
      firmwareSummaryStatusEl.textContent = summary.statusText || 'Build/Flash summary unavailable';
      firmwareSummaryStatusEl.classList.toggle('is-ready', !!summary.ready);
      firmwareSummaryStatusEl.classList.toggle('is-warning', !summary.ready);
    }
    if (firmwareSummaryBuildEl) {
      firmwareSummaryBuildEl.textContent = summary.buildText || 'Build: waiting for summary...';
    }
    if (firmwareSummaryFlashEl) {
      firmwareSummaryFlashEl.textContent = summary.flashText || 'Flash: waiting for summary...';
    }
    if (firmwareSummaryHintEl) {
      firmwareSummaryHintEl.textContent = summary.hintText || 'Use Configure to start the guided setup.';
    }
    if (firmwareSummaryWarningsEl) {
      const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
      firmwareSummaryWarningsEl.innerHTML = '';
      firmwareSummaryWarningsEl.classList.toggle('hidden', warnings.length === 0);
      warnings.forEach((item) => {
        const line = document.createElement('div');
        line.className = 'firmware-summary-warning';
        line.textContent = item;
        firmwareSummaryWarningsEl.appendChild(line);
      });
    }
  }

  function formatPortLabel(port) {
    const driverLabel = normalizeDriverLabel(port.driverLabel || port.friendlyName);
    if (driverLabel) {
      return `${port.path} ${driverLabel}`;
    }

    let label = port.path;
    if (port.manufacturer) { label += ' - ' + port.manufacturer; }
    if (port.vendorId) { label += ' (VID:' + port.vendorId + ')'; }
    return label;
  }

  function buildPortTooltip(port) {
    return [port.friendlyName, port.manufacturer, port.pnpId].filter(Boolean).join('\n');
  }

  function normalizeDriverLabel(label) {
    if (!label) {
      return '';
    }
    return String(label)
      .replace(/\s*\((COM\d+)\)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.type) {
      case 'updatePorts': {
        if (!portSelect) { break; }
        const previousValue = portSelect.value || pendingPort;
        portSelect.innerHTML = '';

        const ports = message.ports || [];
        if (ports.length === 0) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = '-- No ports found --';
          portSelect.appendChild(option);
        } else {
          ports.forEach((port) => {
            const option = document.createElement('option');
            option.value = port.path;
            const label = formatPortLabel(port);
            option.textContent = label;
            option.title = buildPortTooltip(port);
            portSelect.appendChild(option);
          });
        }

        if (previousValue) {
          portSelect.value = previousValue;
          pendingPort = '';
        }
        break;
      }

      case 'updateStatus': {
        connected = !!message.connected;
        if (statusDot) {
          statusDot.className = connected
            ? 'status-indicator status-connected'
            : 'status-indicator status-disconnected';
        }
        if (statusText) {
          statusText.textContent = connected
            ? `${message.port} @ ${message.baudRate}`
            : 'Disconnected';
        }
        updateConnectionButtons();

        [portSelect, baudrateInput, databitsSelect, paritySelect, stopbitsSelect].forEach((element) => {
          if (element) { element.disabled = connected; }
        });
        if (sendInput) { sendInput.disabled = !connected; }
        if (sendBtn) { sendBtn.disabled = !connected; }
        updateEmptyState();
        break;
      }

      case 'appendLog': {
        if (message.text && message.text.startsWith('MCP TX>> ')) {
          appendLogEntry(message.text.trimEnd(), 'echo');
        } else {
          const chunks = String(message.text || '')
            .split('\n')
            .map((line) => line.trimEnd())
            .filter((line) => line.length > 0);
          chunks.forEach((line) => appendLogEntry(line, 'text'));
        }
        break;
      }

      case 'clearLog': {
        logEntries = [];
        renderLogArea();
        if (rxCountEl) { rxCountEl.textContent = 'RX: 0'; }
        if (txCountEl) { txCountEl.textContent = 'TX: 0'; }
        break;
      }

      case 'updateCounters': {
        if (rxCountEl) { rxCountEl.textContent = 'RX: ' + formatBytes(message.rx); }
        if (txCountEl) { txCountEl.textContent = 'TX: ' + formatBytes(message.tx); }
        break;
      }

      case 'restoreConfig': {
        const config = message.config;
        if (config) {
          applyConfigToInputs(config);
          if (config.port) {
            pendingPort = config.port;
          }
        }

        if (Array.isArray(message.sendHistory)) {
          sendHistory = message.sendHistory;
          updateHistorySelect();
        }
        if (Array.isArray(message.quickCommands)) {
          quickCommands = message.quickCommands;
          renderQuickCommands();
        } else {
          renderQuickCommands();
        }
        applyUiState(message.uiState || {});
        renderFirmwareSnapshot(message.firmwareConfigSnapshot);
        renderFirmwareSummary(message.firmwareConfigSummary);
        updateEmptyState();
        break;
      }

      case 'updateUiState': {
        applyUiState(message.uiState || {});
        break;
      }

      case 'keilBusy': {
        const busy = !!message.busy;
        keilBusy = busy;
        [keilBuildBtn, keilFlashBtn, keilBuildFlashBtn, keilCpuBtn, keilConfigBtn, keilConfigInlineBtn, keilCheckBtn, keilSettingsBtn].forEach((element) => {
          if (element) { element.disabled = busy; }
        });
        updateFirmwareActionButtons();
        if (keilStatusEl) {
          const taskName = message.task || 'Task';
          keilStatusEl.textContent = busy ? `Keil: Running ${taskName}...` : 'Keil: Idle';
        }
        break;
      }

      case 'firmwareConfigSummary': {
        renderFirmwareSummary(message.summary);
        break;
      }

      case 'firmwareConfigSnapshot': {
        renderFirmwareSnapshot(message.snapshot);
        break;
      }
    }
  });

  renderQuickCommands();
  updateHistorySelect();
  updateConnectionButtons();
  applyUiState({});
  renderFirmwareDrawer();
  updateFreezeButton();
  updateEmptyState();
})();
