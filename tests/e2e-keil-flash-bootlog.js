#!/usr/bin/env node
/**
 * E2E hardware closure test (API only):
 * 1) Check Keil/JLink config
 * 2) Connect serial port
 * 3) Clear log buffer
 * 4) Build + flash via Bridge API
 * 5) Wait for boot log pattern from powered-up firmware
 *
 * Usage:
 *   node tests/e2e-keil-flash-bootlog.js
 *
 * Env overrides:
 *   SERIAL_PORT=COM5
 *   SERIAL_BAUD=115200
 *   BOOT_PATTERN="EmbedLog Firmware|Firmware Version"
 *   WAIT_TIMEOUT_SEC=25
 *   EXPECT_PROJECT_KEYWORD=freertos_hello
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SERIAL_PORT = process.env.SERIAL_PORT || '';
const SERIAL_BAUD = Number(process.env.SERIAL_BAUD || 115200);
const BOOT_PATTERN = process.env.BOOT_PATTERN || 'EmbedLog Firmware';
const WAIT_TIMEOUT_SEC = Math.max(1, Number(process.env.WAIT_TIMEOUT_SEC || 25));
const EXPECT_PROJECT_KEYWORD = process.env.EXPECT_PROJECT_KEYWORD || 'freertos_hello';

function now() {
  return new Date().toISOString();
}

function log(msg) {
  process.stdout.write(`[${now()}] ${msg}\n`);
}

function readBridgeConfig() {
  const bridgePath = path.join(os.homedir(), '.serialagent', 'bridge.json');
  if (!fs.existsSync(bridgePath)) {
    throw new Error(
      `Bridge discovery file not found: ${bridgePath}\n` +
      'Please start VS Code with Serial Agent extension so Bridge Server is running.'
    );
  }
  return JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
}

function apiRequest(method, apiPath, body, timeoutMs) {
  const cfg = readBridgeConfig();
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: cfg.port,
        path: apiPath,
        method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
          'Content-Length': payload ? Buffer.byteLength(payload) : 0,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += String(chunk); });
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            // Keep raw text
          }
          const status = res.statusCode || 0;
          if (status >= 400) {
            reject(new Error(`HTTP ${status} ${method} ${apiPath}: ${JSON.stringify(parsed)}`));
            return;
          }
          resolve(parsed);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout: ${method} ${apiPath} after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function pickPort() {
  if (SERIAL_PORT) {
    return SERIAL_PORT;
  }

  const status = await apiRequest('GET', '/api/status', undefined, 5000);
  if (status && status.connected && status.port) {
    return status.port;
  }

  const portsRes = await apiRequest('GET', '/api/ports', undefined, 5000);
  const ports = Array.isArray(portsRes.ports) ? portsRes.ports : [];
  if (ports.length === 1 && ports[0].path) {
    return ports[0].path;
  }

  throw new Error(
    'Unable to determine serial port automatically. ' +
    'Please set SERIAL_PORT, e.g. SERIAL_PORT=COM5'
  );
}

async function main() {
  log('E2E closure test started: build+flash -> boot log wait');
  log(`Target firmware hint: _KeilProject/freertos_hello`);

  const configCheck = await apiRequest('GET', '/api/keil/config-check', undefined, 10000);
  if (!configCheck.success || !configCheck.data || !configCheck.data.configOk) {
    throw new Error(`Keil config check failed: ${JSON.stringify(configCheck)}`);
  }
  log('Keil/JLink config check passed');

  const port = await pickPort();
  log(`Using serial port: ${port}, baud: ${SERIAL_BAUD}`);

  const connectRes = await apiRequest('POST', '/api/connect', {
    port,
    baudRate: SERIAL_BAUD,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  }, 10000);
  if (!connectRes.success) {
    throw new Error(`Connect failed: ${JSON.stringify(connectRes)}`);
  }
  log('Serial connected');

  await apiRequest('POST', '/api/clear', {}, 5000);
  log('Serial log cleared');

  const buildFlashRes = await apiRequest('POST', '/api/keil/build-and-flash', {}, 8 * 60 * 1000);
  if (!buildFlashRes.success || !buildFlashRes.data || !buildFlashRes.data.flashOk) {
    throw new Error(`Build+flash failed: ${JSON.stringify(buildFlashRes)}`);
  }
  log(`Build+flash success: artifact=${buildFlashRes.data.artifactPath || '(unknown)'}`);

  if (EXPECT_PROJECT_KEYWORD) {
    const projectFile = String(buildFlashRes.data.projectFile || '');
    if (!projectFile.toLowerCase().includes(EXPECT_PROJECT_KEYWORD.toLowerCase())) {
      throw new Error(
        `Unexpected project file for this test. expected keyword="${EXPECT_PROJECT_KEYWORD}", got="${projectFile}"`
      );
    }
    log(`Project assertion passed: ${projectFile}`);
  }

  const waitPath =
    `/api/log/wait?pattern=${encodeURIComponent(BOOT_PATTERN)}` +
    `&timeout=${WAIT_TIMEOUT_SEC}&scanBuffer=true`;

  const waitRes = await apiRequest('GET', waitPath, undefined, (WAIT_TIMEOUT_SEC + 8) * 1000);
  if (!waitRes.found) {
    const snapshot = await apiRequest('GET', '/api/log?lines=80', undefined, 5000);
    throw new Error(
      `Boot log pattern not found. pattern="${BOOT_PATTERN}", waited=${WAIT_TIMEOUT_SEC}s.\n` +
      `Latest logs: ${JSON.stringify(snapshot)}`
    );
  }

  log(`Boot log matched: ${waitRes.matchedLine}`);
  log('E2E closure test PASSED');
}

main().catch((err) => {
  process.stderr.write(`\n[E2E FAIL] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

