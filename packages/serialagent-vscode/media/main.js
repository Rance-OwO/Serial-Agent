// @ts-check

/**
 * Serial Agent 侧边栏 Webview 脚本
 *
 * 功能：
 * - 串口选择 + 完整参数配置
 * - 多行发送（textarea，Enter 换行，Ctrl+Enter 发送，发送后保留内容）
 * - HEX 发送与 HEX 显示独立控制
 * - 日志区与发送区之间可拖拽调整大小
 * - 发送历史、RX/TX 计数、配置持久化
 */

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // ============================================================
  // DOM 引用
  // ============================================================
  const statusDot    = document.getElementById('status-dot');
  const statusText   = document.getElementById('status-text');
  const rxCountEl    = document.getElementById('rx-count');
  const txCountEl    = document.getElementById('tx-count');
  /** @type {HTMLSelectElement | null} */
  const portSelect   = /** @type {HTMLSelectElement} */ (document.getElementById('port-select'));
  /** @type {HTMLInputElement | null} */
  const baudrateInput = /** @type {HTMLInputElement} */ (document.getElementById('baudrate-input'));
  /** @type {HTMLSelectElement | null} */
  const databitsSelect = /** @type {HTMLSelectElement} */ (document.getElementById('databits-select'));
  /** @type {HTMLSelectElement | null} */
  const paritySelect   = /** @type {HTMLSelectElement} */ (document.getElementById('parity-select'));
  /** @type {HTMLSelectElement | null} */
  const stopbitsSelect = /** @type {HTMLSelectElement} */ (document.getElementById('stopbits-select'));
  const refreshBtn   = document.getElementById('btn-refresh');
  const connectBtn   = document.getElementById('btn-connect');
  const clearBtn     = document.getElementById('btn-clear');
  const keilBuildBtn = document.getElementById('btn-keil-build');
  const keilFlashBtn = document.getElementById('btn-keil-flash');
  const keilBuildFlashBtn = document.getElementById('btn-keil-build-flash');
  const keilCpuBtn = document.getElementById('btn-keil-cpu');
  const keilConfigBtn = document.getElementById('btn-keil-config');
  const keilStatusEl = document.getElementById('keil-status');
  /** @type {HTMLInputElement | null} */
  const optTimestamp  = /** @type {HTMLInputElement} */ (document.getElementById('opt-timestamp'));
  /** @type {HTMLInputElement | null} */
  const optHex       = /** @type {HTMLInputElement} */ (document.getElementById('opt-hex'));
  /** @type {HTMLInputElement | null} */
  const optHexSend   = /** @type {HTMLInputElement} */ (document.getElementById('opt-hex-send'));
  /** @type {HTMLInputElement | null} */
  const optEcho      = /** @type {HTMLInputElement} */ (document.getElementById('opt-echo'));
  /** @type {HTMLSelectElement | null} */
  const lineEndingSelect = /** @type {HTMLSelectElement} */ (document.getElementById('line-ending-select'));
  const logArea      = document.getElementById('log-area');
  /** @type {HTMLTextAreaElement | null} */
  const sendInput    = /** @type {HTMLTextAreaElement} */ (document.getElementById('send-input'));
  /** @type {HTMLButtonElement | null} */
  const sendBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('btn-send'));
  const historyDropdown = document.getElementById('history-dropdown');
  const historyToggle  = document.getElementById('history-toggle');
  const historyMenu    = document.getElementById('history-menu');
  const resizeHandle = document.getElementById('resize-handle');
  const sendSection  = document.getElementById('send-section');

  /** 当前连接状态 */
  let connected = false;

  /** DOM 日志行数上限 */
  const MAX_DISPLAY_LINES = 500;
  let displayLineCount = 0;

  /** 发送历史记录
   *  @type {string[]} */
  let sendHistory = [];
  const MAX_HISTORY = 20;

  /** 待恢复的端口 */
  let pendingPort = '';

  // ============================================================
  // Webview 状态恢复
  // ============================================================
  const previousState = vscode.getState();
  if (previousState) {
    if (sendInput && previousState.sendText) {
      sendInput.value = previousState.sendText;
    }
    if (sendSection && previousState.sendHeight) {
      sendSection.style.height = previousState.sendHeight + 'px';
    }
    // 恢复 HEX Send 状态
    if (optHexSend && previousState.hexSend) {
      optHexSend.checked = true;
      if (sendInput) {
        sendInput.placeholder = 'HEX: 41 42 0D 0A (Ctrl+Enter to send)';
      }
    }
  }

  /** 保存 Webview 状态（发送内容 + 区域高度 + HEX Send） */
  function saveState() {
    vscode.setState({
      sendText: sendInput?.value || '',
      sendHeight: sendSection ? sendSection.offsetHeight : undefined,
      hexSend: optHexSend?.checked || false,
    });
  }

  // ============================================================
  // 拖拽分隔条：日志区 ↔ 发送区 大小调整
  // ============================================================
  if (resizeHandle && sendSection) {
    let dragging = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startHeight = sendSection.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) { return; }
      // 向上拖 = 发送区变大（deltaY 为负值时 height 增加）
      const delta = startY - e.clientY;
      const newHeight = Math.max(60, Math.min(window.innerHeight * 0.6, startHeight + delta));
      sendSection.style.height = newHeight + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveState();
      }
    });
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  // 刷新串口列表
  refreshBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshPorts' });
  });

  // 连接/断开
  connectBtn?.addEventListener('click', () => {
    if (connected) {
      vscode.postMessage({ type: 'disconnect' });
    } else {
      vscode.postMessage({
        type: 'connect',
        port: portSelect?.value || '',
        baudRate: parseInt(baudrateInput?.value || '115200', 10),
        dataBits: parseInt(databitsSelect?.value || '8', 10),
        parity: paritySelect?.value || 'none',
        stopBits: parseFloat(stopbitsSelect?.value || '1'),
      });
    }
  });

  // 清空日志
  clearBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearLog' });
    if (logArea) { logArea.textContent = ''; displayLineCount = 0; }
  });

  // Keil 操作
  keilBuildBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'keilBuild' });
  });
  keilFlashBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'keilFlash' });
  });
  keilBuildFlashBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'keilBuildFlash' });
  });
  keilCpuBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'keilSelectCpu' });
  });
  keilConfigBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'keilOpenConfig' });
  });

  // 选项切换 → 通知 Extension（HEX Recv 只影响显示）
  optTimestamp?.addEventListener('change', () => {
    vscode.postMessage({ type: 'updateSettings', showTimestamp: optTimestamp.checked });
  });
  optHex?.addEventListener('change', () => {
    vscode.postMessage({ type: 'updateSettings', hexMode: optHex.checked });
  });
  lineEndingSelect?.addEventListener('change', () => {
    vscode.postMessage({ type: 'updateSettings', lineEnding: lineEndingSelect.value });
  });

  // HEX Send checkbox → 更新 placeholder + 持久化
  optHexSend?.addEventListener('change', () => {
    if (sendInput) {
      sendInput.placeholder = optHexSend.checked
        ? 'HEX: 41 42 0D 0A (Ctrl+Enter to send)'
        : 'Send data... (Ctrl+Enter to send)';
    }
    saveState();
  });

  // ---- 发送逻辑 ----

  /** 发送当前 textarea 内容（发送后不清空） */
  function doSend() {
    const text = sendInput?.value;
    if (!text) { return; }

    const hexSend = optHexSend?.checked || false;
    vscode.postMessage({ type: 'sendData', text, hexSend });

    // 发送回显：在日志区显示发送的内容
    if (optEcho?.checked && logArea) {
      const echoText = 'TX>> ' + text + '\n';
      const echoSpan = document.createElement('span');
      echoSpan.className = 'log-echo';
      echoSpan.textContent = echoText;
      logArea.appendChild(echoSpan);
      const newLines = (echoText.match(/\n/g) || []).length;
      displayLineCount += Math.max(newLines, 1);
      logArea.scrollTop = logArea.scrollHeight;
    }

    // 更新发送历史（去重，移到最前）
    const idx = sendHistory.indexOf(text);
    if (idx !== -1) { sendHistory.splice(idx, 1); }
    sendHistory.unshift(text);
    if (sendHistory.length > MAX_HISTORY) { sendHistory.pop(); }
    updateHistorySelect();
    vscode.postMessage({ type: 'saveSendHistory', history: sendHistory });

    // 发送后选中全部文本，方便下次覆盖或继续编辑
    sendInput.select();
  }

  sendBtn?.addEventListener('click', doSend);

  // Ctrl+Enter = 发送，Enter = 换行（textarea 默认行为）
  sendInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSend();
    }
  });

  // 输入内容变化时保存状态
  sendInput?.addEventListener('input', saveState);

  // ---- 自定义 History 下拉 ----

  // 点击 toggle 展开/收起
  historyToggle?.addEventListener('click', () => {
    historyDropdown?.classList.toggle('open');
  });

  // 点击外部关闭下拉
  document.addEventListener('click', (e) => {
    if (historyDropdown && !historyDropdown.contains(/** @type {Node} */ (e.target))) {
      historyDropdown.classList.remove('open');
    }
  });

  /** 更新 History 自定义下拉列表（含删除按钮） */
  function updateHistorySelect() {
    if (!historyMenu) { return; }
    historyMenu.innerHTML = '';

    if (sendHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No history';
      historyMenu.appendChild(empty);
      return;
    }

    sendHistory.forEach((item, idx) => {
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

      const delBtn = document.createElement('button');
      delBtn.className = 'history-delete';
      delBtn.textContent = '\u00d7';
      delBtn.title = 'Delete this entry';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendHistory.splice(idx, 1);
        updateHistorySelect();
        vscode.postMessage({ type: 'saveSendHistory', history: sendHistory });
      });

      row.appendChild(textSpan);
      row.appendChild(delBtn);
      historyMenu.appendChild(row);
    });
  }

  /** 格式化字节数
   *  @param {number} n */
  function formatBytes(n) {
    if (n < 1024) { return n + ' B'; }
    if (n < 1048576) { return (n / 1024).toFixed(1) + ' KB'; }
    return (n / 1048576).toFixed(1) + ' MB';
  }

  // ============================================================
  // 接收来自 Extension Host 的消息
  // ============================================================

  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.type) {

      // 更新串口列表
      case 'updatePorts': {
        if (!portSelect) { break; }
        const prevValue = portSelect.value || pendingPort;
        portSelect.innerHTML = '';
        const ports = message.ports || [];

        if (ports.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '-- No ports found --';
          portSelect.appendChild(opt);
        } else {
          ports.forEach((/** @type {any} */ p) => {
            const opt = document.createElement('option');
            opt.value = p.path;
            let label = p.path;
            if (p.manufacturer) { label += ' - ' + p.manufacturer; }
            if (p.vendorId) { label += ' (VID:' + p.vendorId + ')'; }
            opt.textContent = label;
            portSelect.appendChild(opt);
          });
        }

        if (prevValue) {
          portSelect.value = prevValue;
          pendingPort = '';
        }
        break;
      }

      // 更新连接状态
      case 'updateStatus': {
        connected = !!message.connected;

        if (statusDot) {
          statusDot.className = connected
            ? 'status-indicator status-connected'
            : 'status-indicator status-disconnected';
        }
        if (statusText) {
          statusText.textContent = connected
            ? message.port + ' @ ' + message.baudRate
            : 'Disconnected';
        }
        if (connectBtn) {
          connectBtn.textContent = connected ? 'Close' : 'Open';
          connectBtn.className = connected ? 'btn-danger' : 'btn-primary';
        }

        if (portSelect)      { portSelect.disabled = connected; }
        if (baudrateInput)   { baudrateInput.disabled = connected; }
        if (databitsSelect)  { databitsSelect.disabled = connected; }
        if (paritySelect)    { paritySelect.disabled = connected; }
        if (stopbitsSelect)  { stopbitsSelect.disabled = connected; }
        if (sendInput)       { sendInput.disabled = !connected; }
        if (sendBtn)         { sendBtn.disabled = !connected; }
        break;
      }

      // 追加日志
      case 'appendLog': {
        if (!logArea) { break; }
        // H3: MCP TX>> 行使用 Echo 样式（绿色斜体），与用户手动发送的 TX>> 一致
        if (message.text && message.text.startsWith('MCP TX>> ')) {
          const echoSpan = document.createElement('span');
          echoSpan.className = 'log-echo';
          echoSpan.textContent = message.text;
          logArea.appendChild(echoSpan);
        } else {
          logArea.insertAdjacentText('beforeend', message.text);
        }
        // 按实际换行数累加
        const newLines = (message.text.match(/\n/g) || []).length;
        displayLineCount += Math.max(newLines, 1);

        if (displayLineCount > MAX_DISPLAY_LINES) {
          // 按子节点移除旧内容，保留 <span> Echo 样式
          const excess = displayLineCount - MAX_DISPLAY_LINES;
          let removed = 0;
          while (removed < excess && logArea.firstChild) {
            const node = logArea.firstChild;
            const nodeText = node.textContent || '';
            const nodeLines = (nodeText.match(/\n/g) || []).length;
            if (removed + Math.max(nodeLines, 1) <= excess) {
              removed += Math.max(nodeLines, 1);
              logArea.removeChild(node);
            } else {
              // 部分裁剪文本节点
              if (node.nodeType === Node.TEXT_NODE) {
                const parts = nodeText.split('\n');
                const keep = parts.slice(excess - removed);
                node.textContent = keep.join('\n');
                removed = excess;
              } else {
                break;
              }
            }
          }
          displayLineCount = MAX_DISPLAY_LINES;
        }

        logArea.scrollTop = logArea.scrollHeight;
        break;
      }

      // 清空日志
      case 'clearLog': {
        if (logArea) { logArea.textContent = ''; displayLineCount = 0; }
        if (rxCountEl) { rxCountEl.textContent = 'RX: 0'; }
        if (txCountEl) { txCountEl.textContent = 'TX: 0'; }
        break;
      }

      // 更新 RX/TX 字节计数
      case 'updateCounters': {
        if (rxCountEl) { rxCountEl.textContent = 'RX: ' + formatBytes(message.rx); }
        if (txCountEl) { txCountEl.textContent = 'TX: ' + formatBytes(message.tx); }
        break;
      }

      // 恢复持久化配置
      case 'restoreConfig': {
        const cfg = message.config;
        if (cfg) {
          if (baudrateInput)   { baudrateInput.value = String(cfg.baudRate || 115200); }
          if (databitsSelect)  { databitsSelect.value = String(cfg.dataBits || 8); }
          if (paritySelect)    { paritySelect.value = cfg.parity || 'none'; }
          if (stopbitsSelect)  { stopbitsSelect.value = String(cfg.stopBits || 1); }
          if (optTimestamp)     { optTimestamp.checked = !!cfg.showTimestamp; }
          if (optHex)          { optHex.checked = !!cfg.hexMode; }
          if (lineEndingSelect) { lineEndingSelect.value = cfg.lineEnding || 'lf'; }
          if (cfg.port) { pendingPort = cfg.port; }
        }
        if (message.sendHistory && Array.isArray(message.sendHistory)) {
          sendHistory = message.sendHistory;
          updateHistorySelect();
        }
        break;
      }

      case 'keilBusy': {
        const busy = !!message.busy;
        if (keilBuildBtn) { keilBuildBtn.disabled = busy; }
        if (keilFlashBtn) { keilFlashBtn.disabled = busy; }
        if (keilBuildFlashBtn) { keilBuildFlashBtn.disabled = busy; }
        if (keilCpuBtn) { keilCpuBtn.disabled = busy; }
        if (keilConfigBtn) { keilConfigBtn.disabled = busy; }
        if (keilStatusEl) {
          const taskName = message.task || 'Task';
          keilStatusEl.textContent = busy ? ('Keil: Running ' + taskName + '...') : 'Keil: Idle';
        }
        break;
      }
    }
  });
})();
