# Serial Agent

English version: [README_EN.md](README_EN.md)

Serial Agent 是一个面向嵌入式调试场景的 AI 串口调试平台。

当前仓库是它的主开发仓与发布编排仓。它会从同一个源码仓发布 3 个强关联交付物：

1. `Serial Agent` VS Code 插件
2. `Serial Agent MCP`
3. `Serial Agent Skill`

## 为什么是 3 个交付物，但仍然保留 1 个源码仓

Serial Agent 需要同时服务三种使用方式：

- 人类开发者直接在 VS Code 中使用串口工作台
- AI 客户端通过 MCP 调用串口和固件能力
- 团队或代理通过 skill 复用同一套调试工作流

当前不拆成 3 个源码仓，是因为：

- 插件和 MCP 在运行时仍然强耦合
- skill 现在是工作流增强层，不是独立运行时
- 单仓更适合保持版本、README、issue 和架构文档同步

## 从哪里开始

### 我只是想调试串口

先安装 VS Code 插件。

### 我想让 AI 客户端接入

先安装 VS Code 插件，再配置 `Serial Agent MCP`。

### 我想给团队或代理一套固定工作流

在插件和 MCP 之外，再安装 `Serial Agent Skill`。

## 三个交付物

### 1. Serial Agent

这是主产品，也就是 VS Code 插件。它负责：

- 串口 UI
- 本地串口状态
- Bridge 生命周期
- Keil 和 JLink 动作

源码：

- [packages/serialagent-vscode](packages/serialagent-vscode)

文档：

- [packages/serialagent-vscode/README.md](packages/serialagent-vscode/README.md)

### 2. Serial Agent MCP

这是 AI 集成层。它通过 MCP 对外暴露串口和固件工具，并把调用转发给本地 Bridge。

源码：

- [packages/serialagent-mcp](packages/serialagent-mcp)

文档：

- [packages/serialagent-mcp/README.md](packages/serialagent-mcp/README.md)

### 3. Serial Agent Skill

这是工作流增强层。它帮助 AI 或代理更稳定地使用插件和 MCP，但它本身不是运行时。

源码：

- [skills/serialagent](skills/serialagent)

文档：

- [skills/serialagent/README.md](skills/serialagent/README.md)

## 它们如何协同

```text
AI IDE / Agent Client
    -> Serial Agent MCP
    -> Local Bridge
    -> Serial Agent VS Code Extension
    -> Serial Device / Firmware Toolchain
```

更详细的架构说明：

- [docs/architecture.md](docs/architecture.md)

## 发布渠道

发布矩阵见：

- [docs/release-matrix.md](docs/release-matrix.md)

正式发布步骤见：

- [docs/release-playbook.md](docs/release-playbook.md)

## 仓库结构

```text
packages/
  serialagent-vscode/
  serialagent-mcp/
skills/
  serialagent/
docs/
tests/
```

## 开发命令

在仓库根目录安装依赖：

```bash
npm install
```

常用命令：

```bash
npm test
npm --workspace packages/serialagent-vscode run build
npm --workspace packages/serialagent-vscode run pack
npm --workspace packages/serialagent-mcp run build
```

## 维护者文档

- [docs/architecture.md](docs/architecture.md)
- [docs/release-matrix.md](docs/release-matrix.md)
- [docs/release-playbook.md](docs/release-playbook.md)

## License

See [LICENSE](LICENSE).
