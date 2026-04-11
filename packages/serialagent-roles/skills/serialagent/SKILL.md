# Serial Agent Skill

Use this skill when an agent needs to operate the Serial Agent workflow through
the VS Code extension and the Serial Agent MCP server.

## Purpose

This skill helps an agent:

- inspect serial status
- read logs
- send commands
- run Keil and JLink actions
- verify embedded debugging loops using MCP tools

## Boundaries

This skill is not the runtime.

- The VS Code extension owns the actual serial and Bridge state
- The MCP package owns tool exposure over stdio
- This skill only provides workflow guidance and usage conventions

## Expected Environment

- Serial Agent VS Code extension installed and active
- Local Bridge running
- Serial Agent MCP configured in the client

## Recommended Workflow

1. Check serial status
2. List ports if needed
3. Connect serial when required
4. Clear logs before sensitive verification
5. Use `send_and_wait` for request-response flows
6. Use Keil tools only when config checks pass
7. Verify conclusions from logs, not only from assumptions

## Output Expectations

When using this skill, the agent should report:

- what tools were used
- what evidence was observed
- what conclusion was reached
- what next action is recommended
