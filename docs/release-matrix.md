# Serial Agent Release Matrix

| Deliverable | Public Name | Technical Identity | Release Channel | Source Path | Version Policy |
|---|---|---|---|---|---|
| VS Code extension | `Serial Agent` | `serialagent-vscode` | Visual Studio Marketplace, `.vsix` | `packages/serialagent-vscode` | Independent semver |
| MCP server | `Serial Agent MCP` | `serial-agent-mcp` | npm, MCP Registry | `packages/serialagent-mcp` | Independent semver |
| skill | `Serial Agent Skill` | `skills/serialagent` | repo directory, client-compatible skill install path | `skills/serialagent` | Independent semver |

## Naming Rules

- Brand name: `Serial Agent`
- Repository URL: `https://github.com/Rance-OwO/Serial-Agent`
- MCP client alias: `serialagent`
- Skill directory name: `serialagent`

## Source Strategy

Current source strategy:

- one GitHub monorepo
- three public deliverables

Not recommended right now:

- three separate source repositories

## Publishing Order

1. Publish the VS Code extension
2. Publish the MCP package
3. Publish MCP Registry metadata
4. Publish and document the skill
