# Serial Agent Skill

Chinese version: [README.md](README.md)

The `Serial Agent Skill` is the workflow layer for AI clients and agents. Its
job is not to provide runtime capabilities by itself. Its job is to teach an
agent how to use the tools exposed by `Serial Agent MCP`, which then reach the
local Bridge and the serial/toolchain state owned by the `Serial Agent` VS Code
extension.

Source repository:

- <https://github.com/Rance-OwO/Serial-Agent>

It helps an AI client use:

- the `Serial Agent` VS Code extension
- `Serial Agent MCP`

It is not a replacement for either runtime component.

The repository source location for this skill is:

```text
packages/serialagent-skill
```

When installing it into an AI client, keep the directory name as:

```text
serialagent
```

## What It Is For

This skill helps an agent classify and execute three common task modes:

- read-only inspection: inspect status, ports, logs, or passive output
- open-loop serial operation: interact with a running device over serial without
  build or flash
- closed-loop firmware verification: use build/flash only when the task really
  requires firmware deployment and post-flash verification

It should not assume that every task is a build-and-flash workflow. Many tasks
only need serial interaction.

## What It Is Not

This skill does not:

- replace the VS Code extension's ownership of serial state
- replace the MCP server
- turn the Bridge into a public raw REST surface for the model

The intended mental model is:

```text
AI Client -> MCP tools -> Local Bridge -> VS Code extension -> Serial / Toolchain
```

## What It Teaches The Agent

- prefer MCP tools instead of assuming direct Bridge REST access
- decide whether the task is read-only, open-loop, or closed-loop first
- prefer `send_and_wait` for request-response serial work
- run `check_keil_config` before build/flash actions
- ground conclusions in tool output and log evidence

## Install Position

Install this skill in the client-specific skill location supported by your AI
tooling. Keep the directory name as:

```text
serialagent
```

If the client does not support skill installation, you can feed `SKILL.md`
directly into the model prompt.

## Related Components

- Product overview: [../../README_EN.md](../../README_EN.md)
- VS Code extension: [../serialagent-vscode/README_EN.md](../serialagent-vscode/README_EN.md)
- MCP server: [../serialagent-mcp/README_EN.md](../serialagent-mcp/README_EN.md)
