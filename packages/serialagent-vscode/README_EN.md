# Serial Agent VS Code Extension

中文版本：[README.md](README.md)

Serial Agent is a VS Code extension for embedded serial debugging. It provides
a local serial workspace, a Bridge server for AI integrations, and firmware
actions for Keil and JLink workflows.

Source repository:

- <https://github.com/Rance-OwO/Serial-Agent>

This README is intentionally extension-focused. If you need MCP setup or skill
usage, use the docs linked below:

- MCP: [../serialagent-mcp/README_EN.md](../serialagent-mcp/README_EN.md)
- Skill: [../../skills/serialagent/README_EN.md](../../skills/serialagent/README_EN.md)
- Product overview: [../../README_EN.md](../../README_EN.md)

## What The Extension Does

- Connects to serial devices inside VS Code
- Shows RX logs and TX controls in a dedicated serial workspace
- Starts a local Bridge server for MCP clients
- Supports Keil build and JLink flash actions from the same panel
- Preserves panel state such as filters, TX text, and layout sizing

## Install

### Marketplace

Install `Serial Agent` from the Visual Studio Marketplace when the public
listing is available.

### VSIX

Install a packaged build:

```bash
code --install-extension serialagent-vscode-<version>.vsix
```

### From Source

From the repository root:

```bash
npm install
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
```

The packaged VSIX is written to `packages/serialagent-vscode/`.

## Quick Start

1. Open the `Serial Agent` view container in VS Code.
2. Select a COM port and baud rate.
3. Click `Open` to connect.
4. Observe RX logs in the log pane.
5. Send commands from the TX area.

## Firmware Actions

The extension exposes firmware actions in the panel:

- `Build`
- `Flash`
- `Build+Flash`
- `CPU Name`
- `Keil Config`

Required settings are under the `serialagent.*` namespace, including:

- `serialagent.keil.uv4Path`
- `serialagent.keil.armcc5Path`
- `serialagent.jlink.installDirectory`

## Bridge And AI Integration

The extension starts a localhost Bridge server and writes discovery data to:

```text
~/.serialagent/bridge.json
```

The Bridge is used by the `Serial Agent MCP` package. The extension owns the
real serial state and firmware toolchain state. The MCP layer is an adapter on
top of that runtime.

## Development Notes

- Main entrypoint: `src/extension.ts`
- Serial runtime: `src/serial-manager.ts`
- Webview coordinator: `src/serial-panel-provider.ts`
- Frontend assets: `media/main.js`, `media/main.css`

## Release Notes For Maintainers

The extension release loop in this repo is:

```bash
npm test
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
```

After packaging, update local planning documents under `__coding_plan/`.
