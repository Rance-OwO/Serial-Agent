# Serial Agent MCP

English version: [README_EN.md](README_EN.md)

`Serial Agent MCP` 是 `Serial Agent` 平台的 MCP 服务端。它通过 stdio 暴露串口与固件相关工具，并把请求转发给 VS Code 插件 `Serial Agent` 启动的本地 Bridge。

源码仓库：

- <https://github.com/Rance-OwO/Serial-Agent>

这份 README 只讲 MCP。如果你需要：

- 产品总览，请看 [../../README.md](../../README.md)
- VS Code 插件说明，请看 [../serialagent-vscode/README.md](../serialagent-vscode/README.md)
- skill 说明，请看 [../serialagent-roles/skills/serialagent/README.md](../serialagent-roles/skills/serialagent/README.md)

## 运行模型

真实运行链路是：

```text
VS Code Extension -> local Bridge -> MCP -> AI IDE
```

这个 MCP 不是独立产品，必须配合 VS Code 插件 `Serial Agent` 一起使用。插件负责：

- 串口连接状态
- 日志缓冲
- Bridge 生命周期
- Keil / JLink 工具链执行

MCP 包本身只是 stdio 适配层，让 AI 客户端能够通过 MCP tools 调用这些能力。

## 包身份

- 产品名：`Serial Agent MCP`
- 客户端 alias：`serialagent`
- npm 包名：`@ranceowo/serial-agent-mcp`
- 作者：`ranceowo`

## 安装与运行

### 推荐：通过 npm / npx 使用

```bash
npx -y @ranceowo/serial-agent-mcp
```

客户端配置示例：

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@ranceowo/serial-agent-mcp"],
  "startup_timeout_sec": 15
}
```

### 从源码运行

在仓库根目录执行：

```bash
npm install
npm --workspace packages/serialagent-mcp run build
npm --workspace packages/serialagent-mcp run start
```

如果你需要直接运行版本化主产物，命名规则为：

```bash
node packages/serialagent-mcp/dist/serial-agent-mcp-<package-version>.js
```

## 对插件的依赖

这个 MCP 服务端依赖 VS Code 插件侧的 Bridge。discovery 文件位置：

```text
~/.serialagent/bridge.json
```

如果 Bridge 没启动，MCP 进程可能能启动，但 tools 调用会失败。

## Tools

当前工具面：

1. `get_serial_status`
2. `list_serial_ports`
3. `connect_serial`
4. `disconnect_serial`
5. `read_serial_log`
6. `send_serial_data`
7. `clear_serial_log`
8. `wait_for_output`
9. `send_and_wait`
10. `check_keil_config`
11. `build_keil_project`
12. `flash_keil_firmware`
13. `build_and_flash_keil`

## 发布顺序

推荐的公开顺序：

1. 先发布 VS Code 插件 `Serial Agent`
2. 再发布 npm 包 `@ranceowo/serial-agent-mcp`
3. 最后再补 MCP Registry metadata

## 维护者备注

- 源码入口：`src/index.ts`
- 主产物：`dist/serial-agent-mcp-<version>.js`
- 兼容入口：`dist/index.js`
- 正式发布前建议先运行：

```bash
npm --workspace packages/serialagent-mcp run build
cd packages/serialagent-mcp
npm pack --dry-run
```
