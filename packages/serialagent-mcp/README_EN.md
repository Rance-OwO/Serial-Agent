# Serial Agent MCP

中文版本：[README.md](README.md)

`Serial Agent MCP` is the MCP server for the `Serial Agent` platform. It exposes
serial and firmware tools over stdio and forwards requests to the local Bridge
started by the VS Code extension `Serial Agent`.

Source repository:

- <https://github.com/Rance-OwO/Serial-Agent>

This README is intentionally MCP-focused. For the product overview, the VS Code
extension, and the skill, see:

- Product overview: [../../README_EN.md](../../README_EN.md)
- VS Code extension: [../serialagent-vscode/README_EN.md](../serialagent-vscode/README_EN.md)
- Skill: [../serialagent-skill/README_EN.md](../serialagent-skill/README_EN.md)

## Runtime Model

The real runtime chain is:

```text
VS Code Extension -> local Bridge -> MCP -> AI IDE
```

This MCP is not a standalone product. It requires the VS Code extension
`Serial Agent`. The extension owns:

- serial connection state
- buffered logs
- Bridge lifecycle
- Keil and JLink toolchain execution

The MCP package is the stdio adapter that lets AI clients call those
capabilities through MCP tools.

## Package Identity

- Product name: `Serial Agent MCP`
- Client alias: `serialagent`
- npm package: `@ranceowo/serial-agent-mcp`
- Author: `ranceowo`

## Install And Run

### Recommended: npm / npx

```bash
npx -y @ranceowo/serial-agent-mcp
```

Client config example:

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@ranceowo/serial-agent-mcp"],
  "startup_timeout_sec": 15
}
```

### Local source build

From the repository root:

```bash
npm install
npm --workspace packages/serialagent-mcp run build
npm --workspace packages/serialagent-mcp run start
```

If you need to run the versioned main artifact directly, the naming rule is:

```bash
node packages/serialagent-mcp/dist/serial-agent-mcp-<package-version>.js
```

## Dependency On The Extension

This MCP server requires the Bridge started by the VS Code extension. The
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

## Distribution Order

Recommended public distribution order:

1. Publish the VS Code extension `Serial Agent`
2. Publish the npm package `@ranceowo/serial-agent-mcp`
3. Add MCP Registry metadata later

## Maintainer Notes

- Source entry: `src/index.ts`
- Main artifact: `dist/serial-agent-mcp-<version>.js`
- Compatibility entry: `dist/index.js`
- Before publishing, run:

```bash
npm --workspace packages/serialagent-mcp run build
cd packages/serialagent-mcp
npm pack --dry-run
```
