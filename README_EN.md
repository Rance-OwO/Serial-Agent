# Serial Agent

中文版本：[README.md](README.md)

Serial Agent is an AI-powered embedded serial debugging and verification platform.

Source repository:

- <https://github.com/Rance-OwO/Serial-Agent>

It is delivered as three related artifacts from one source repository:

1. `Serial Agent` VS Code extension
2. `Serial Agent MCP`
3. `Serial Agent Skill`

This repository is the development monorepo and the release coordination center
for all three artifacts.

## Why Three Deliverables And One Repo

Serial Agent is published as three deliverables, but it is not maintained as
three source repositories.

This is intentional:

- the VS Code extension and the MCP server are still strongly coupled at runtime
- the skill is a workflow layer, not an independent runtime product
- keeping one source repository avoids version drift, duplicated issue tracking,
  and README fragmentation

Current source strategy:

- one GitHub monorepo
- three public deliverables

## Start Here

Choose your path:

### Human Developer

Start with the VS Code extension.

### AI Integration

Use the VS Code extension first, then configure `Serial Agent MCP`.

### Team Orchestrated Workflow

Add the skill only when your client supports skills and you want guided agent
workflows on top of the extension and MCP.

### Step-by-step full setup

1. Install the VS Code extension `Serial Agent`
2. Configure `Serial Agent MCP`
3. Give the skill from `packages/serialagent-skill` to your AI client

If your client supports skill installation, install the `serialagent` directory using the client-specific skill mechanism. If not, feed `SKILL.md` directly into the model prompt.

Not every task needs a build-and-flash loop. Some tasks are read-only or
open-loop serial interactions on an already running device.

## Three Deliverables

### 1. Serial Agent

The VS Code extension is the primary product. It owns:

- serial UI
- local serial state
- Bridge server lifecycle
- Keil and the currently configured flasher actions

Source:

- [packages/serialagent-vscode](packages/serialagent-vscode)

Docs:

- [packages/serialagent-vscode/README_EN.md](packages/serialagent-vscode/README_EN.md)

### 2. Serial Agent MCP

The MCP package exposes Serial Agent capabilities to AI clients over stdio. It
depends on the local Bridge started by the extension.

Source:

- [packages/serialagent-mcp](packages/serialagent-mcp)

Docs:

- [packages/serialagent-mcp/README_EN.md](packages/serialagent-mcp/README_EN.md)

### 3. Serial Agent Skill

The skill is the workflow layer. It helps agents decide whether a task is
read-only, open-loop serial work, or closed-loop firmware verification, then
use MCP tools, the extension, and the local Bridge more effectively. It is not
a replacement for the runtime.

Source:

- [packages/serialagent-skill](packages/serialagent-skill)

Docs:

- [packages/serialagent-skill/README_EN.md](packages/serialagent-skill/README_EN.md)

## How They Work Together

```text
AI IDE / Agent Client
    -> Serial Agent MCP
    -> Local Bridge
    -> Serial Agent VS Code Extension
    -> Serial Device / Firmware Toolchain
```

More detail:

- [docs/architecture.md](docs/architecture.md)

## Release Channels

Release channels and ownership are tracked here:

- [docs/release-matrix.md](docs/release-matrix.md)

The release execution checklist is here:

- [docs/release-playbook.md](docs/release-playbook.md)

## Repository Structure

```text
packages/
  serialagent-vscode/
  serialagent-mcp/
  serialagent-skill/
docs/
tests/
```

## Development

Install dependencies from the repository root:

```bash
npm install
```

Common commands:

```bash
npm test
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
npm --workspace packages/serialagent-mcp run build
```

## Maintainer Docs

- [docs/architecture.md](docs/architecture.md)
- [docs/release-matrix.md](docs/release-matrix.md)
- [docs/release-playbook.md](docs/release-playbook.md)

## License

See [LICENSE](LICENSE).
