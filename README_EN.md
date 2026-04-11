# Serial Agent

中文版本：[README.md](README.md)

Serial Agent is an AI-powered embedded serial debugging platform.

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

## Three Deliverables

### 1. Serial Agent

The VS Code extension is the primary product. It owns:

- serial UI
- local serial state
- Bridge server lifecycle
- Keil and JLink actions

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

The skill is the workflow layer. It helps agents use the extension and MCP more
effectively. It is not a replacement for the runtime.

Source:

- [skills/serialagent](skills/serialagent)

Docs:

- [skills/serialagent/README_EN.md](skills/serialagent/README_EN.md)

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
skills/
  serialagent/
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
