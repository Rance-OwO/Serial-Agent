# <img src="./media/SerialAgent.png" alt="Serial Agent logo" width="40" align="center" /> Serial Agent VS Code 插件

English version: [README_EN.md](README_EN.md)

Serial Agent 是一个面向嵌入式调试场景的 VS Code 插件。它把串口面板、本地 Bridge 服务、Keil 构建动作和烧录动作收拢到同一个工作区里，让你既能手动调试，也能把同一套运行时能力暴露给 AI 客户端。

源码仓库：

- <https://github.com/Rance-OwO/Serial-Agent>

> [!IMPORTANT]
> 如果你希望真正跑通 AI 闭环调试，不要只安装插件。
> 推荐先进入官方项目主页和文档入口：<https://github.com/Rance-OwO/Serial-Agent>。
> 然后继续把 `Serial Agent MCP` 和 `Serial Agent Skill` 一起配置好。插件负责本地运行时，MCP 负责把能力暴露给 AI，skill 负责把提示词和工作流约束喂给 AI。

## 这个插件解决什么问题

普通串口工具只能让你“看日志”和“发命令”。Serial Agent 进一步把这些能力和固件动作接到 VS Code 与 AI 工作流里，让你可以在一个面板里完成：

- 串口连接与断开
- RX 日志观察、搜索、过滤和清空
- TX 命令发送与回显
- 本地 Bridge 启动，供 MCP 客户端接入
- Keil build、flash、build+flash
- JLink CPU 选择和烧录配置切换

当你把插件、MCP 和 skill 都配置好之后，AI 客户端就不只是“读文档”，而是能真正参与串口调试闭环。

## 功能概览

### 本地串口工作台

- 在 VS Code 中直接连接串口设备
- 在同一视图里查看 RX 日志和发送 TX 命令
- 支持日志搜索、过滤、清空和 RX/TX 计数
- 支持 `Focus Mode`，把面板收敛到 RX/TX 为主的调试视角
- 支持在侧边栏和独立 Tab 中打开插件面板

### AI Bridge 运行时

- 插件启动本地 Bridge Server，供 `Serial Agent MCP` 调用
- discovery 文件写入：

```text
~/.serialagent/bridge.json
```

- 插件才是真正持有串口状态、日志缓冲和固件工具链状态的运行时

### 固件动作

插件面板内置以下动作：

- `Build`
- `Flash`
- `Build+Flash`
- `JLink CPU`
- `Build/Flash Config`

支持的烧录后端包括：

- `jlink`
- `stlink`
- `openocd`

## 安装

### Marketplace

公开上架后，可直接从 Visual Studio Marketplace 安装 `Serial Agent`。

### VSIX

安装本地打包产物：

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

1. 在 VS Code 中打开 `Serial Agent` 视图容器。
2. 选择 COM 口和波特率。
3. 点击 `Open` 建立串口连接。
4. 在日志区观察 RX 输出。
5. 在 TX 区发送测试命令。
6. 如果需要，把面板切到 `Focus Mode`，专注查看 RX/TX 调试流。

如果你只想把它当作本地串口工作台，到这里就可以开始使用。

## 推荐配置路径：把 AI 闭环一起接上

> [!TIP]
> 最佳体验不是“只装插件”，而是“插件 + MCP + 提示词 skill”一起配。
> 建议从官方项目主页开始，再按下面顺序补齐。

### 第一步：安装并打开插件

先让 VS Code 插件跑起来。只有插件启动后，本地 Bridge 和串口运行时才存在。

### 第二步：配置 `Serial Agent MCP`

推荐阅读：

- [../serialagent-mcp/README.md](../serialagent-mcp/README.md)
- [../../README.md](../../README.md)

最常见的 MCP 配置形式如下：

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@ranceowo/serial-agent-mcp"],
  "startup_timeout_sec": 15
}
```

说明：

- `Serial Agent MCP` 不是独立产品，它依赖插件侧的本地 Bridge
- 如果插件没有启动，MCP 进程即使能起来，tools 调用仍然会失败

### 第三步：把 `Serial Agent Skill` 配给 AI

推荐阅读：

- [../serialagent-skill/README.md](../serialagent-skill/README.md)
- [../serialagent-skill/SKILL.md](../serialagent-skill/SKILL.md)

这个 skill 的作用不是替代插件或 MCP，而是给 AI 一个更稳定的提示词和工作流约束，例如：

- 串口日志分诊
- 请求-响应式命令闭环
- 基于证据的调试汇报
- Keil build / flash 之后的验证动作

如果你的 AI 客户端支持 skill 安装，优先按客户端规范安装这个 skill。  
如果客户端暂时不支持 skill 目录，也可以把 `SKILL.md` 里的内容直接作为提示词喂给 AI。

## 进阶使用

### 1. 把插件当作 AI 可调用的本地调试运行时

推荐链路：

```text
AI IDE / Agent Client
    -> Serial Agent MCP
    -> Local Bridge
    -> Serial Agent VS Code Extension
    -> Serial Device / Firmware Toolchain
```

这条链路打通后，AI 可以基于插件提供的真实运行时能力完成：

- 查询串口状态
- 读取日志并等待特定输出
- 发送命令并校验响应
- 触发构建或烧录动作
- 基于日志和动作结果给出调试结论

### 2. 在面板里完成固件构建和烧录

如果你使用 Keil 工作流，可以直接在插件里配好这些设置：

- `serialagent.keil.projectFile`
- `serialagent.keil.target`
- `serialagent.keil.uv4Path`
- `serialagent.keil.armcc5Path`
- `serialagent.keil.f7Action`
- `serialagent.flash.method`

根据烧录方式不同，再继续补齐：

- `serialagent.jlink.*`
- `serialagent.stlink.*`
- `serialagent.openocd.*`

这让你可以把串口观测、构建和烧录统一到一个面板里，而不是在多个工具窗口之间来回切。

### 3. 用 Focus Mode 收敛调试视图

当你主要关注 RX/TX 调试流时，可以使用：

- 面板中的 `Focus`
- 命令面板中的 `Serial Agent: Toggle Focus Mode`

它适合在日志密集、命令频繁的调试场景下减少干扰。

## 常见设置

常用设置位于 `serialagent.*` 命名空间下，例如：

- `serialagent.keil.projectFile`
- `serialagent.keil.target`
- `serialagent.keil.uv4Path`
- `serialagent.keil.armcc5Path`
- `serialagent.flash.method`
- `serialagent.jlink.installDirectory`
- `serialagent.jlink.device`
- `serialagent.stlink.exePath`
- `serialagent.openocd.exePath`

## 这份 README 之外的官方文档入口

如果你需要完整闭环而不是只看插件本身，建议直接从下面这些官方入口继续：

- 项目总览：[../../README.md](../../README.md)
- MCP 文档：[../serialagent-mcp/README.md](../serialagent-mcp/README.md)
- Skill 文档：[../serialagent-skill/README.md](../serialagent-skill/README.md)

## 开发说明

- 主入口：`src/extension.ts`
- 串口运行时：`src/serial-manager.ts`
- Webview 协调器：`src/serial-panel-provider.ts`
- Bridge 服务：`src/bridge-server.ts`
- 前端资源：`media/main.js`、`media/main.css`

插件构建与打包：

```bash
npm test
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
```
