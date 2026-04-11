# Serial Agent Skill

中文版本：[README.md](README.md)

The Serial Agent Skill is the workflow layer for agents that use the Serial
Agent platform.

Source repository:

- <https://github.com/Rance-OwO/Serial-Agent>

It is designed to help an AI client use:

- the Serial Agent VS Code extension
- the Serial Agent MCP server

This skill is not a replacement for either runtime component.

## What It Is For

Use this skill when an agent needs a consistent embedded debugging workflow,
including:

- serial log triage
- request-response command loops
- Keil build and flash verification
- evidence-first reporting

## What It Is Not

This skill does not:

- open serial ports by itself
- replace the VS Code extension
- replace the MCP server

## Install Position

Install this skill in the client-specific skill location supported by your AI
tooling. Keep the directory name as:

```text
serialagent
```

## Related Components

- Product overview: [../../README_EN.md](../../README_EN.md)
- VS Code extension: [../../packages/serialagent-vscode/README_EN.md](../../packages/serialagent-vscode/README_EN.md)
- MCP server: [../../packages/serialagent-mcp/README_EN.md](../../packages/serialagent-mcp/README_EN.md)
