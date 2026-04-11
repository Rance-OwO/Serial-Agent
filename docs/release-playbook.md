# Serial Agent Release Playbook

This document defines the public release order and the actual maintainer steps
for each deliverable.

## Release Order

Always release in this order:

1. VS Code extension
2. MCP package
3. MCP Registry metadata
4. skill

Reason:

- the extension is the primary product
- the MCP package depends on the extension-owned Bridge model
- the skill is an enhancement layer on top of the extension and MCP

## Preflight Checklist

Before any public release:

1. Confirm naming is aligned:
   - brand: `Serial Agent`
   - MCP public name: `Serial Agent MCP`
   - MCP client alias: `serialagent`
   - skill public name: `Serial Agent Skill`
2. Confirm the root README links to the current extension, MCP, and skill docs.
3. Confirm package READMEs only explain their own deliverable.
4. Confirm the local `__coding_plan` reflects the current release baseline.

## VS Code Extension Release

Source path:

```text
packages/serialagent-vscode
```

Channels:

- Visual Studio Marketplace
- `.vsix`
- optional GitHub Release asset

Steps:

1. Verify `package.json` metadata:
   - `displayName`
   - `publisher`
   - `version`
   - `license`
   - `repository`
2. Run:

```bash
npm test
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
```

3. Install the generated `.vsix` locally for a smoke test.
4. Publish to Marketplace.
5. Attach the same `.vsix` to the GitHub Release if needed.
6. Update public docs if install instructions changed.

## MCP Release

Source path:

```text
packages/serialagent-mcp
```

Channels:

- npm
- MCP Registry
- optional GitHub Release asset

Steps:

1. Verify `package.json` metadata:
   - `name`
   - `version`
   - `main`
   - `bin`
   - `license`
2. Run:

```bash
npm test
npm --workspace packages/serialagent-mcp run build
```

3. Run:

```bash
npm publish --dry-run
```

4. Publish to npm.
5. Prepare and submit MCP Registry metadata.
6. Update MCP README with the public npm install command and registry link.

## Skill Release

Source path:

```text
skills/serialagent
```

Channels:

- repository directory
- client-compatible skill install path
- optional GitHub tag/release note

Steps:

1. Confirm both files exist and are aligned:
   - `SKILL.md`
   - `README.md`
2. Confirm the skill README states:
   - target client type
   - install position
   - relation to the extension and MCP
   - that the skill is not the runtime
3. Tag the skill release in Git if you want a stable baseline.
4. Do not publish the skill through npm in the current release model.

## Public Release Notes Structure

Use one short structure across all three deliverables:

1. What the deliverable is
2. What changed in this release
3. How to install or update
4. Where to find the related docs

## Not Recommended Right Now

Do not do these during the current public release phase:

- split into three source repositories
- rename extension command IDs
- rename MCP tool IDs
- move skill into npm package distribution
