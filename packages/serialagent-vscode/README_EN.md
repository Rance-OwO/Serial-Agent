# <img src="./media/SerialAgent.png" alt="Serial Agent logo" width="40" align="center" /> Serial Agent VS Code Extension

中文版本：[README.md](README.md)

Serial Agent is a VS Code extension for embedded debugging. It brings together a serial workspace, a local Bridge server, and firmware actions so you can keep serial inspection, device control, and build or flash operations inside the same VS Code workflow.

Source repository:

- <https://github.com/Rance-OwO/Serial-Agent>

> [!IMPORTANT]
> If you want the full AI-assisted debugging loop, do not stop at installing the extension.
> Start from the official project entrypoint at <https://github.com/Rance-OwO/Serial-Agent>, then configure both `Serial Agent MCP` and `Serial Agent Skill`.
> The extension owns the local runtime, the MCP package exposes it to AI clients, and the skill provides prompt and workflow guidance for the agent.

## What This Extension Solves

Most serial tools only let you watch logs and send commands. Serial Agent adds the rest of the embedded debugging loop inside VS Code:

- serial connect and disconnect
- RX log inspection, search, filtering, and clearing
- TX command sending and echo visibility
- a local Bridge for MCP clients
- Keil build, flash, and build+flash actions
- JLink CPU selection and flash configuration

When the extension, MCP, and skill are configured together, an AI client can work against the same real runtime you use manually.

## Feature Overview

### Local serial workspace

- Connect to serial devices from inside VS Code
- Inspect RX logs and send TX commands in one view
- Search, filter, clear, and monitor RX/TX counters
- Use `Focus Mode` for an RX/TX-centric debugging layout
- Open the panel in the sidebar or in a dedicated tab

### AI Bridge runtime

- The extension starts the local Bridge server used by `Serial Agent MCP`
- Discovery data is written to:

```text
~/.serialagent/bridge.json
```

- The extension is the real runtime owner for serial state, log buffers, and firmware toolchain state

### Firmware actions

The panel includes:

- `Build`
- `Flash`
- `Build+Flash`
- `JLink CPU`
- `Build/Flash Config`

Supported flash backends:

- `jlink`
- `stlink`
- `openocd`

## Install

### Marketplace

Install `Serial Agent` from the Visual Studio Marketplace when the public listing is available.

### VSIX

Install a packaged build:

```bash
code --install-extension serialagent-vscode-<version>.vsix
```

### From source

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
5. Send test commands from the TX area.
6. Switch to `Focus Mode` when you want a tighter RX/TX workflow.

If you only need a local serial workspace, this is enough to get started.

## Recommended Setup Path For AI Workflows

> [!TIP]
> The best experience is not "extension only". It is "extension + MCP + prompt skill".
> Start from the official project page, then complete the setup in this order.

### Step 1: Install and run the extension

The extension must be running first. Without it, there is no local Bridge and no live runtime for serial or firmware operations.

### Step 2: Configure `Serial Agent MCP`

Recommended docs:

- [../serialagent-mcp/README_EN.md](../serialagent-mcp/README_EN.md)
- [../../README_EN.md](../../README_EN.md)

The most common MCP configuration looks like this:

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@ranceowo/serial-agent-mcp"],
  "startup_timeout_sec": 15
}
```

Notes:

- `Serial Agent MCP` is not a standalone product. It depends on the local Bridge started by the extension.
- If the extension is not running, MCP startup may succeed while tool calls still fail.

### Step 3: Give the `Serial Agent Skill` to the AI client

Recommended docs:

- [../serialagent-roles/skills/serialagent/README_EN.md](../serialagent-roles/skills/serialagent/README_EN.md)
- [../serialagent-roles/skills/serialagent/SKILL.md](../serialagent-roles/skills/serialagent/SKILL.md)

This skill does not replace the extension or the MCP server. It gives the AI a more stable prompt and workflow contract for tasks such as:

- serial log triage
- request-response command loops
- evidence-based debugging reports
- post-build and post-flash verification steps

If your AI client supports installing skills, install it using the client-specific skill mechanism.  
If not, you can still feed the contents of `SKILL.md` directly into the model prompt.

## Advanced Usage

### 1. Use the extension as the local runtime behind AI tools

Recommended chain:

```text
AI IDE / Agent Client
    -> Serial Agent MCP
    -> Local Bridge
    -> Serial Agent VS Code Extension
    -> Serial Device / Firmware Toolchain
```

Once that chain is working, an AI client can:

- inspect serial status
- read logs and wait for specific output
- send commands and verify responses
- trigger build or flash actions
- produce debugging conclusions from real evidence

### 2. Run build and flash actions from the panel

For Keil-based workflows, configure:

- `serialagent.keil.projectFile`
- `serialagent.keil.target`
- `serialagent.keil.uv4Path`
- `serialagent.keil.armcc5Path`
- `serialagent.keil.f7Action`
- `serialagent.flash.method`

Then complete the backend-specific settings you actually use:

- `serialagent.jlink.*`
- `serialagent.stlink.*`
- `serialagent.openocd.*`

This keeps serial observation, build, and flashing in one place instead of splitting them across multiple tools.

### 3. Tighten the UI with Focus Mode

When you mainly care about the RX/TX loop, use:

- the `Focus` button in the panel
- `Serial Agent: Toggle Focus Mode` from the command palette

It is useful when logs are dense and commands are frequent.

## Common Settings

The extension settings live under the `serialagent.*` namespace, including:

- `serialagent.keil.projectFile`
- `serialagent.keil.target`
- `serialagent.keil.uv4Path`
- `serialagent.keil.armcc5Path`
- `serialagent.flash.method`
- `serialagent.jlink.installDirectory`
- `serialagent.jlink.device`
- `serialagent.stlink.exePath`
- `serialagent.openocd.exePath`

## Official Entry Points Beyond This README

If you need the full product workflow rather than the extension in isolation, continue with:

- Product overview: [../../README_EN.md](../../README_EN.md)
- MCP docs: [../serialagent-mcp/README_EN.md](../serialagent-mcp/README_EN.md)
- Skill docs: [../serialagent-roles/skills/serialagent/README_EN.md](../serialagent-roles/skills/serialagent/README_EN.md)

## Development Notes

- Main entrypoint: `src/extension.ts`
- Serial runtime: `src/serial-manager.ts`
- Webview coordinator: `src/serial-panel-provider.ts`
- Bridge server: `src/bridge-server.ts`
- Frontend assets: `media/main.js`, `media/main.css`

Build and package the extension with:

```bash
npm test
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
```
