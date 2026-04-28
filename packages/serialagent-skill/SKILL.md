# Serial Agent Skill

Use this skill when an agent needs to operate Serial Agent through the local
MCP tools exposed by `Serial Agent MCP`.

## What This Skill Does

This skill teaches an agent how to:

- choose the right Serial Agent MCP tools for the current task
- reason about the local runtime chain behind those tools
- distinguish read-only inspection from side-effectful serial and firmware actions
- report conclusions from tool evidence instead of assumptions

This skill does not replace the runtime.

## Runtime Model

The actual execution chain is:

```text
AI Client
  -> Serial Agent MCP tools
  -> Local Bridge
  -> Serial Agent VS Code extension
  -> Serial port / firmware toolchain
```

Key boundaries:

- The VS Code extension owns the real serial state, Bridge lifecycle, and local
  toolchain integration.
- `serialagent-mcp` exposes stdio MCP tools and forwards them to the local
  Bridge.
- This skill only teaches the agent how to use those MCP tools correctly.

Agent rule:

- Prefer calling MCP tools.
- Do not assume direct Bridge REST access is available to the model.
- If MCP calls fail because the Bridge is unavailable, diagnose that as a local
  runtime/setup issue, not as missing business logic.

## Expected Environment

- Serial Agent VS Code extension installed and active
- Local Bridge started by the extension
- Serial Agent MCP configured in the AI client

Typical Bridge/runtime failure hints:

- the extension is not active
- the local Bridge is not running
- the MCP server cannot discover Bridge connection info
- the client can see the MCP server but tool calls fail

## Decide The Task Mode First

Before choosing tools, decide which mode the task belongs to:

### 1. Read-only inspection

Use this mode when the user only wants to inspect state or logs.

Typical actions:

- check connection state
- list ports
- read recent logs
- wait for passive output without sending data

### 2. Open-loop serial operation

Use this mode when the device is already running and the task is about serial
interaction, configuration, or shell-style command exchange. This mode does not
require build or flash.

Typical examples:

- configure a Linux device over serial
- send AT or CLI commands
- collect logs after a manual user action
- validate request-response behavior without changing firmware

### 3. Closed-loop firmware verification

Use this mode only when the task actually requires build, flash, or post-flash
verification through the local toolchain.

Typical examples:

- rebuild firmware after code changes
- flash the current artifact
- wait for boot banners after flashing
- verify command behavior after a new firmware image is deployed

## Available MCP Tools

### Read-only tools

- `get_serial_status`: inspect connection state, reconnect state, counters, and
  buffered log metrics.
- `list_serial_ports`: inspect available serial devices before choosing a port.
- `read_serial_log`: inspect recent buffered log lines.
- `wait_for_output`: wait for matching serial output without sending data.
- `check_keil_config`: inspect whether the configured build/flash toolchain is
  ready.

### Serial side-effect tools

- `connect_serial`: open a serial connection.
- `disconnect_serial`: close the current serial connection.
- `send_serial_data`: send text or hex data to the connected device.
- `send_and_wait`: send data and wait for a matching response in one atomic
  operation.
- `clear_serial_log`: clear buffered logs and counters before sensitive
  verification.

### Build/flash side-effect tools

- `build_keil_project`: run a build without flashing.
- `flash_keil_firmware`: flash the configured artifact or an explicit artifact.
- `build_and_flash_keil`: build first, then flash using the currently
  configured flasher.

Important:

- Flash actions are not JLink-only. They follow the current Serial Agent
  flasher configuration.

## Decision Rules

- Start with the least invasive tool set that can answer the question.
- Use read-only tools first when the user asks for status, evidence, or
  diagnosis.
- Use `send_and_wait` by default for request-response serial interactions.
- Only split the flow into `send_serial_data` plus `wait_for_output` when the
  task is genuinely asymmetric or long-running.
- Use `clear_serial_log` before sensitive verification when stale buffered
  evidence would be misleading.
- In closed-loop firmware work, call `check_keil_config` before build or flash
  actions.
- Do not assume every task needs build or flash. Many tasks are open-loop and
  should stop at serial interaction and evidence collection.
- Prefer conclusions grounded in tool output and logs, not inferred success.

## Recommended Playbooks

### Open-loop serial interaction

1. `get_serial_status`
2. `list_serial_ports` if the connection target is unknown
3. `connect_serial` if not connected
4. `clear_serial_log` if old buffered output would pollute the check
5. `send_and_wait` for request-response commands
6. `read_serial_log` when you need broader context around the response

### Closed-loop firmware verification

1. `get_serial_status`
2. `check_keil_config`
3. `clear_serial_log`
4. `build_and_flash_keil`
5. `wait_for_output`
6. `read_serial_log`
7. `send_and_wait` for post-flash functional checks

### Read-only diagnosis

1. `get_serial_status`
2. `list_serial_ports` if hardware presence is in question
3. `read_serial_log`
4. `wait_for_output` only if the task depends on future passive output

## Failure Interpretation

When a tool call fails, classify the failure before proposing the next step.

Common buckets:

- MCP/Bridge availability failure: the local runtime chain is not ready.
- Serial connection failure: the port is missing, busy, or not connected yet.
- Request-response mismatch: the device accepted the send but did not emit the
  expected output.
- Toolchain readiness failure: build/flash prerequisites are incomplete.
- Post-flash behavior failure: the firmware changed state, but logs or command
  responses do not match expectations.

Do not collapse these into one vague "Serial Agent failed" conclusion.

## Response Expectations

When using this skill, the agent should report:

- which MCP tools were used
- what evidence was observed from tool output or logs
- which failure bucket or conclusion best matches that evidence
- what next tool call or next user action is recommended
