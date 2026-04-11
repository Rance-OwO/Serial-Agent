# Serial Agent VS Code 插件

English version: [README_EN.md](README_EN.md)

Serial Agent 是一个面向嵌入式调试场景的 VS Code 插件。它提供本地串口工作台、Bridge 服务能力，以及 Keil 和 JLink 相关固件动作。

源码仓库：

- <https://github.com/Rance-OwO/Serial-Agent>

这份 README 只讲插件本身。如果你需要：

- MCP 配置，请看 [../serialagent-mcp/README.md](../serialagent-mcp/README.md)
- skill 使用，请看 [../../skills/serialagent/README.md](../../skills/serialagent/README.md)
- 产品总览，请看 [../../README.md](../../README.md)

## 插件能做什么

- 在 VS Code 内连接串口设备
- 提供 RX 日志区和 TX 发送区
- 启动本地 Bridge，供 MCP 客户端接入
- 在同一面板中执行 Keil build / JLink flash
- 保持过滤器、TX 文本和布局状态

## 安装

### Marketplace

当公开上架后，可直接从 Visual Studio Marketplace 安装 `Serial Agent`。

### VSIX

安装打包产物：

```bash
code --install-extension serialagent-vscode-<version>.vsix
```

### 从源码构建

在仓库根目录执行：

```bash
npm install
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
```

打包后的 VSIX 会输出到 `packages/serialagent-vscode/`。

## 快速开始

1. 在 VS Code 中打开 `Serial Agent` 视图容器
2. 选择 COM 口和波特率
3. 点击 `Open` 连接
4. 在日志区观察 RX 输出
5. 在 TX 区发送命令

## 固件动作

插件面板提供以下固件动作：

- `Build`
- `Flash`
- `Build+Flash`
- `CPU Name`
- `Keil Config`

相关设置位于 `serialagent.*` 命名空间下，例如：

- `serialagent.keil.uv4Path`
- `serialagent.keil.armcc5Path`
- `serialagent.jlink.installDirectory`

## Bridge 与 AI 集成

插件会启动本地 Bridge，并将 discovery 文件写到：

```text
~/.serialagent/bridge.json
```

`Serial Agent MCP` 通过这个 Bridge 访问插件能力。插件本身才是真正持有串口状态和固件工具链状态的运行时。

## 开发说明

- 主入口：`src/extension.ts`
- 串口运行时：`src/serial-manager.ts`
- Webview 协调器：`src/serial-panel-provider.ts`
- 前端资源：`media/main.js`、`media/main.css`

## 维护者发布备注

插件发布循环：

```bash
npm test
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
```

打包后需要同步更新本地 `__coding_plan/`。
