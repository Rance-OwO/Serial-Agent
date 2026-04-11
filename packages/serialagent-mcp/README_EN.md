# Serial Agent MCP

中文版本：[README.md](README.md)

Serial Agent MCP is the MCP server for the Serial Agent platform. It exposes
serial and firmware tools over stdio and forwards requests to the local Bridge
server started by the VS Code extension.

Source repository:

- <https://github.com/Rance-OwO/Serial-Agent>

This README is intentionally MCP-focused. For the product overview and the VS
Code extension, see:

- Product overview: [../../README_EN.md](../../README_EN.md)
- VS Code extension: [../serialagent-vscode/README_EN.md](../serialagent-vscode/README_EN.md)
- Skill: [../../skills/serialagent/README_EN.md](../../skills/serialagent/README_EN.md)

## Runtime Model

The real runtime chain is:

```text
VS Code Extension -> local Bridge -> MCP -> AI IDE
```

The extension owns:

- serial connection state
- buffered logs
- Bridge lifecycle
- Keil and JLink toolchain execution

The MCP package is a stdio adapter that lets AI clients call those capabilities
through MCP tools.

## Package Identity

- Product name: `Serial Agent MCP`
- Client alias: `serialagent`
- Technical package name: `serial-agent-mcp`

The client alias and the npm package name are intentionally different layers.
The alias is for client configuration. The package name is for distribution.

## Install And Run

### Local source build

From the repository root:

```bash
npm install
npm --workspace packages/serialagent-mcp run build
node packages/serialagent-mcp/dist/index.js
```

### Client config example

```json
{
  "args": [
    "D:\\_Code\\__selfproject\\01-Serial Agent\\Serial Agent\\packages\\serialagent-mcp\\dist\\index.js"
  ],
  "command": "D:\\Program Files\\nodejs\\node.exe",
  "startup_timeout_sec": 15,
  "type": "stdio"
}
```

## Dependency On The Extension

This MCP server requires the VS Code extension Bridge to be running. The
discovery file is expected at:

```text
~/.serialagent/bridge.json
```

If the Bridge is not running, MCP startup may succeed while tool calls fail.

## Tools

Current tool surface:

1. `get_serial_status`
2. `list_serial_ports`
3. `connect_serial`
4. `disconnect_serial`
5. `read_serial_log`
6. `send_serial_data`
7. `clear_serial_log`
8. `wait_for_output`
9. `send_and_wait`
10. `check_keil_config`
11. `build_keil_project`
12. `flash_keil_firmware`
13. `build_and_flash_keil`

## Permission Model

The MCP server does not decide whether a client asks for confirmation. That is
still client-side policy. The server helps reduce permission friction by making
tool descriptions and risk boundaries explicit.

Tool categories:

- `Read / Observe`
- `Operate`
- `External / Side-effectful`

## Distribution Plan

Recommended public distribution order:

1. Publish the VS Code extension
2. Publish this MCP package to npm
3. Register metadata in the MCP Registry

## Maintainer Notes

- Entry point: `src/index.ts`
- Build output: `dist/index.js`
- When publishing to npm, this package must not remain `private: true`
