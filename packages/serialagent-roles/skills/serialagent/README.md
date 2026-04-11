# Serial Agent Skill

English version: [README_EN.md](README_EN.md)

Serial Agent Skill 是给 AI 客户端或代理使用的工作流增强层。它帮助模型更稳定地使用：

源码仓库：

- <https://github.com/Rance-OwO/Serial-Agent>

- `Serial Agent` VS Code 插件
- `Serial Agent MCP`

它不是运行时，也不替代插件或 MCP。

## 它适合做什么

当你希望代理具备稳定的一致调试流程时，可以使用这个 skill，例如：

- 串口日志分诊
- 请求-响应式命令闭环
- Keil build / flash 验证
- 基于证据的调试汇报

## 它不负责什么

这个 skill 不会：

- 自己打开串口
- 替代 VS Code 插件
- 替代 MCP 服务端

## 安装位置

把它安装到你的 AI 客户端所支持的 skill 目录下，目录名保持为：

```text
serialagent
```

## 相关组件

- 产品总览：[../../README.md](../../README.md)
- VS Code 插件：[../../packages/serialagent-vscode/README.md](../../packages/serialagent-vscode/README.md)
- MCP 服务端：[../../packages/serialagent-mcp/README.md](../../packages/serialagent-mcp/README.md)
