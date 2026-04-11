# Serial Agent Architecture

## System Boundary

Serial Agent is not a single executable. It is a platform made of three layers:

1. VS Code extension
2. MCP server
3. skill

The VS Code extension is the real runtime owner.

## Runtime Chain

```text
AI IDE / Agent Client
    -> Serial Agent MCP
    -> Local Bridge
    -> Serial Agent VS Code Extension
    -> Serial Hardware / Keil / JLink
```

## Layer Responsibilities

### VS Code Extension

Owns:

- serial connection state
- RX and TX UI
- Bridge startup and discovery file
- firmware build and flash actions

### MCP Server

Owns:

- stdio MCP transport
- tool registration
- forwarding requests to the local Bridge

Does not own:

- serial state
- firmware toolchain state
- UI

### Skill

Owns:

- workflow guidance
- prompt structure
- recommended tool usage patterns

Does not own:

- runtime state
- serial transport
- build and flash execution

## Release Strategy

The recommended source layout is a single monorepo with multiple public
artifacts.

Do not split into three GitHub source repositories at the current stage because:

- extension and MCP are still strongly coupled
- skill is still an enhancement layer, not an independent runtime
- splitting now would increase version and documentation synchronization cost

## Future Split Threshold

Re-evaluate repository splitting only when at least two of these become true:

- MCP evolves independently for multiple release cycles
- MCP no longer depends on the current extension-owned Bridge shape
- skill has a real compatibility matrix across multiple clients
- each artifact needs separate maintainers and issue tracking
