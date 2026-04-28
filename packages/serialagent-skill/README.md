# Serial Agent Skill

English version: [README_EN.md](README_EN.md)

`Serial Agent Skill` 是给 AI 客户端或代理使用的工作流层。它的职责不是提供
运行时能力，而是教 agent 如何正确使用 `Serial Agent MCP` 暴露的工具，再通过本地
Bridge 去使用 `Serial Agent` VS Code 插件持有的串口与工具链能力。

源码仓库：

- <https://github.com/Rance-OwO/Serial-Agent>

它帮助 AI 客户端更稳定地使用：

- `Serial Agent` VS Code 插件
- `Serial Agent MCP`

它不是运行时，也不替代插件或 MCP。

仓库内的真实来源路径是：

```text
packages/serialagent-skill
```

安装到 AI 客户端时，目录名仍保持为：

```text
serialagent
```

## 它适合做什么

这个 skill 适合帮助 agent 判断并执行以下三类任务：

- 只读检查：查看连接状态、端口、日志、被动输出
- 开环串口操作：设备已在运行，只通过串口做配置、命令交互或日志采集
- 闭环固件验证：确实需要 build / flash / post-flash 验证时再进入闭环

它不会把所有任务都默认成 build/flash 流程。很多场景只需要串口通信，不需要编译烧录。

## 它不负责什么

这个 skill 不会：

- 自己替代 VS Code 插件持有串口状态
- 自己替代 MCP 服务端
- 把 Bridge 变成一个给模型直接裸调的公共 HTTP API

推荐心智模型是：

```text
AI Client -> MCP tools -> Local Bridge -> VS Code extension -> Serial / Toolchain
```

## 它重点教 agent 什么

- 优先调用 MCP tools，而不是假设自己能直接访问 Bridge REST
- 先判断任务是只读、开环还是闭环
- 请求-响应类串口交互优先使用 `send_and_wait`
- 需要 build/flash 时先做 `check_keil_config`
- 结论必须基于工具返回和日志证据

## 安装位置

把它安装到你的 AI 客户端所支持的 skill 目录下，目录名保持为：

```text
serialagent
```

如果客户端不支持 skill 安装，也可以直接把 `SKILL.md` 内容喂给模型。

## 相关组件

- 产品总览：[../../README.md](../../README.md)
- VS Code 插件：[../serialagent-vscode/README.md](../serialagent-vscode/README.md)
- MCP 服务端：[../serialagent-mcp/README.md](../serialagent-mcp/README.md)
