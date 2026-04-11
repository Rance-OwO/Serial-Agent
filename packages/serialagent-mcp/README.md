# Serial Agent MCP

English version: [README_EN.md](README_EN.md)

Serial Agent MCP 是 Serial Agent 平台的 MCP 服务端。它通过 stdio 暴露串口和固件工具，并把调用转发给 VS Code 插件启动的本地 Bridge。

这份 README 只讲 MCP。如果你需要：

- 产品总览，请看 [../../README.md](../../README.md)
- 插件说明，请看 [../serialagent-vscode/README.md](../serialagent-vscode/README.md)
- skill 说明，请看 [../../skills/serialagent/README.md](../../skills/serialagent/README.md)

## 运行模型

真实运行链路是：

```text
VS Code Extension -> local Bridge -> MCP -> AI IDE
```

其中插件负责：

- 串口连接状态
- 日志缓冲
- Bridge 生命周期
- Keil / JLink 工具链执行

MCP 包本身只是 stdio 适配层，让 AI 客户端能够通过 MCP tools 调用这些能力。

## 包身份

- 产品名：`Serial Agent MCP`
- 客户端 alias：`serialagent`
- 技术包名：`serial-agent-mcp`

这三层故意分开：

- alias 用于客户端配置
- 技术包名用于发布

## 安装与运行

### 从源码构建

在仓库根目录执行：

```bash
npm install
npm --workspace packages/serialagent-mcp run build
node packages/serialagent-mcp/dist/index.js
```

### 客户端配置示例

```json
{
  "args": [
    "D:\\_Code\\__selfproject\\01-Serial Agent\\Serial Agent\\packages\\serialagent-mcp\\dist\\index.js"
  ],
  "command": "D:\\Program Files\\nodejs\\node.exe",
  "startup_timeout_sec": 15,
  "type": "stdio"
}
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

## 权限模型

MCP 服务端不决定客户端是否弹确认。这仍然属于客户端侧策略。服务端这边的作用是把工具职责和风险边界表达清楚，降低权限摩擦。

工具分层：

- `Read / Observe`
- `Operate`
- `External / Side-effectful`

## 发布顺序

推荐的正式公开顺序：

1. 先发布 VS Code 插件
2. 再发布 MCP npm 包
3. 最后补 MCP Registry metadata

## 维护者备注

- 入口文件：`src/index.ts`
- 构建输出：`dist/index.js`
- 正式发布到 npm 前，这个包不能保留 `private: true`
