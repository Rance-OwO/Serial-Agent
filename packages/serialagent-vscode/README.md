# Serial Agent — VS Code Serial Monitor

> AI 驱动的嵌入式串口调试助手，让 AI 能读串口日志、分析代码问题、形成调试闭环。

Serial Agent 是一个 VS Code 侧边栏扩展，提供完整的串口监视器功能，专为嵌入式开发设计。它与 Serial Agent MCP Server 协同，实现 **"写代码 → 烧录 → 读串口 → AI 分析 → 改代码"** 的自动化调试闭环。

## 核心特性

### 串口连接管理

- **自动扫描** — 启动时自动列出可用串口，支持手动刷新
- **完整参数配置** — 波特率（支持手动输入任意值）、数据位、校验位、停止位
- **智能重连** — 设备拔出后重插自动恢复连接，带状态指示
- **双重状态显示** — 侧边栏面板 + VS Code 底部状态栏实时显示连接状态

### 高性能日志显示

- **实时接收** — 基于原始 `data` 事件，低延迟逐行输出
- **HEX 模式** — 独立的 HEX Recv 开关，以十六进制格式显示接收数据
- **时间戳** — 可选为每行日志添加毫秒级时间戳
- **内存优化** — 后端 5000 行环形缓冲 + 前端 500 行 DOM 裁剪，防止内存溢出
- **流量统计** — 实时显示 RX/TX 收发字节数

### 灵活的数据发送

- **多行编辑** — textarea 支持多行编辑，`Enter` 换行，`Ctrl+Enter`（macOS: `Cmd+Enter`）发送
- **发送保留** — 发送后内容不清空，自动选中全部文本方便重复发送或编辑
- **HEX 发送** — 独立的 HEX Send 开关，支持 `41 42 0D 0A` 格式发送原始字节
- **发送历史** — 最近 20 条记录，支持快速选择和删除
- **换行符选择** — 支持 LF / CRLF / CR / None 四种模式

### 优化的用户界面

- **可调布局** — 日志区与发送区之间有拖拽分隔条，可自由调整比例
- **配置持久化** — 串口参数、显示选项、发送历史跨会话保存
- **内容持久化** — textarea 内容通过 `setState/getState` 自动保留
- **主题适配** — 完全跟随 VS Code 主题（亮色 / 暗色 / 高对比度）

## 快速开始

### 安装扩展

#### 方式一：从 VSIX 安装

```bash
# 在项目根目录构建打包
cd packages/serialagent-vscode
npm install
node pack.js

# 安装到 VS Code
code --install-extension serialagent-vscode-1.0.8.vsix
```

#### 方式二：从源码开发

```bash
# 在 monorepo 根目录安装依赖
npm install

# 构建扩展
cd packages/serialagent-vscode
npx webpack --config webpack.config.js

# 在 VS Code 中按 F5 启动扩展开发主机
```

### 基本使用

1. 打开 VS Code 侧边栏，找到 **Serial Agent: Serial Monitor** 面板
2. 从 **Port** 下拉框选择串口（点击刷新按钮更新列表）
3. 设置波特率（默认 115200），如需修改高级参数可展开 **Advanced**
4. 点击 **Open** 连接串口
5. 日志区域实时显示接收数据
6. 在底部 textarea 输入命令，`Ctrl+Enter`（macOS: `Cmd+Enter`）发送

### 高级功能

#### STM32 编译与烧录（Keil + JLink）

第一阶段已支持在插件内完成 **Build / Flash / Build+Flash**：

- **Build**：调用 Keil `UV4` 命令行编译 `.uvprojx/.uvproj`
- **Flash**：调用 `JLink` Commander 烧录 `.hex/.axf/.bin`
- **Build+Flash**：先编译，成功后自动烧录

在侧边栏面板中新增了 `Build`、`Flash`、`Build+Flash`、`CPU Name` 和 `Keil Config` 按钮。

必须配置的关键参数：

- `serialagent.keil.uv4Path`：Keil `UV4.exe` 路径
- `serialagent.keil.armcc5Path`：ARMCC5 `bin` 目录
- `serialagent.jlink.installDirectory`：JLink 安装目录

说明：

- `Keil Config` 按钮会打开 `serialagent.*` 设置页，可同时看到 Keil 和 JLink 配置；
- `CPU Name` 按钮会从当前 `.uvprojx` 的 Target `Device` + `JLinkDevices.xml` 设备库中提供候选并写入 `serialagent.jlink.device`；
- 若 `serialagent.jlink.device` 留空，插件会自动使用当前 Target 的 `Device` 作为烧录设备名（若存在）。

可选参数：

- `serialagent.keil.projectFile`：指定 `.uvprojx/.uvproj`
- `serialagent.keil.target`：指定 Target 名称（不填则默认第一个 Target）
- `serialagent.keil.resultPolicy`：构建结果判定策略（默认 `log-and-artifact`，兼容 C51 警告导致的非 0 退出码）
- `serialagent.keil.strictExitCode`：是否严格按 UV4 退出码判失败（默认 `false`）
- `serialagent.jlink.interface`：`SWD` / `JTAG`
- `serialagent.jlink.speed`：下载速度（kHz）
- `serialagent.jlink.baseAddr`：烧录 `.bin` 时使用的基地址

执行日志会输出到 **Output → Serial Agent Build**，并包含 UV4 构建日志全文与错误摘要，便于定位编译/烧录失败原因。

#### MCP Bridge Server

扩展内置 HTTP Bridge Server，为 MCP Server 提供串口操作 API：

- **自动启动** — 扩展激活时自动启动 Bridge Server
- **服务发现** — 在 `~/.serialagent/bridge.json` 写入服务信息
- **Token 认证** — 每次激活生成新的 Token（可选启用）
- **状态栏指示** — 左下角显示 Bridge Server 运行状态

#### 自动重连机制

当设备意外断开时：

1. Serial Agent 自动检测连接状态
2. 每隔 2 秒尝试重新连接
3. 状态栏显示 "Reconnecting..." 动画
4. 设备重新插入后自动恢复连接

#### HEX 模式使用

**接收模式（HEX Recv）**：
- 勾选 **HEX Recv** 选项
- 所有接收的数据以十六进制格式显示
- 每字节显示为两位大写十六进制数，空格分隔
- 示例：`48 65 6C 6C 6F 20 57 6F 72 6C 64`

**发送模式（HEX Send）**：
- 勾选 **HEX Send** 选项
- 输入格式：`41 42 0D 0A`（空格分隔的十六进制字节）
- 发送前自动验证格式，无效时提示错误
- 不支持其他字符和空格

## 技术架构

```
packages/serialagent-vscode/
├── src/
│   ├── extension.ts         — VS Code 扩展入口
│   │   ├── SerialManager    — 串口管理（连接/断开/收发/重连）
│   │   ├── SerialPanelProvider — Webview 生命周期 + 消息路由
│   │   ├── BridgeServer     — HTTP REST API（MCP 集成）
│   │   └── StatusBar        — VS Code 底部状态栏集成
│   ├── bridge-server.ts     — Bridge Server 实现
│   └── types.ts             — 共享类型定义
├── media/
│   ├── main.js              — Webview 前端脚本
│   ├── main.css             — 主样式（响应式布局 + VS Code 主题）
│   ├── reset.css            — CSS Reset
│   └── vscode.css           — VS Code Webview 基础样式
└── package.json             — 扩展配置
```

### 模块职责

| 模块 | 职责 | 依赖 |
|------|------|------|
| **SerialManager** | 串口操作抽象、日志缓冲、自动重连 | serialport |
| **BridgeServer** | HTTP REST API、服务发现、Token 认证 | ISerialManager, ILogger |
| **SerialPanelProvider** | Webview UI 管理、状态持久化 | vscode API |
| **main.js** | 前端 UI 交互、DOM 操作、消息通信 | vscode API |

### 通信机制

Extension Host 与 Webview 之间通过 `postMessage` 双向通信：

| 方向 | 消息类型 | 说明 |
|------|----------|------|
| Webview → Extension | `refreshPorts` | 请求刷新串口列表 |
| Webview → Extension | `connect` / `disconnect` | 连接/断开串口 |
| Webview → Extension | `sendData` | 发送数据（含 `hexSend` 标志） |
| Webview → Extension | `updateSettings` | 更新显示设置 |
| Webview → Extension | `saveSendHistory` | 持久化发送历史 |
| Extension → Webview | `updatePorts` | 返回串口列表 |
| Extension → Webview | `updateStatus` | 连接状态变更 |
| Extension → Webview | `appendLog` | 追加日志文本 |
| Extension → Webview | `updateCounters` | RX/TX 字节计数 |
| Extension → Webview | `restoreConfig` | 恢复持久化配置 |

### Bridge Server API

Bridge Server 提供 REST API 供 MCP Server 调用：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 获取连接状态 |
| GET | `/api/ports` | 获取可用串口列表 |
| POST | `/api/connect` | 连接串口 |
| POST | `/api/disconnect` | 断开串口 |
| GET | `/api/log` | 获取日志缓冲区 |
| POST | `/api/send` | 发送数据 |
| GET | `/api/log/wait` | 等待日志匹配 pattern |
| POST | `/api/send-and-wait` | 原子发送+等待 |
| POST | `/api/clear` | 清空日志 |
| GET | `/api/keil/config-check` | 检查 Keil/JLink 配置是否可用 |
| POST | `/api/keil/build` | 执行 Keil 编译并返回成功状态 |
| POST | `/api/keil/flash` | 执行 JLink 烧录并返回成功状态 |
| POST | `/api/keil/build-and-flash` | 一键编译+烧录并返回阶段状态 |

**安全特性**：
- 仅绑定 `127.0.0.1`（本地访问）
- Token 认证（可选启用）
- CORS 限制（生产环境建议配置）

## 依赖项

| 依赖 | 版本 | 用途 |
|------|------|------|
| [serialport](https://serialport.io/) | ^12.0.0 | Node.js 串口通信库（含原生 `.node` 二进制） |
| VS Code | ^1.85.0 | Webview View API |
| TypeScript | ^5.5.0 | 类型安全 |
| Webpack | ^5.105.3 | 打包构建 |

## 项目路线图

Serial Agent 项目的最终目标是让 AI 深度参与嵌入式调试：

- [x] **Phase 1** — VS Code 串口监视器基础功能 ✅
- [x] **Phase 2** — MCP Server 集成，暴露串口 Tool 给 AI ✅
- [x] **Phase 3** — AI 自动分析串口日志，定位代码问题 ✅
- [ ] **Phase 4** — 完整调试闭环（写代码 → 烧录 → 读日志 → AI 修复）
- [ ] **Phase 5** — 智能日志模式识别和异常检测

## 配置说明

### 持久化配置

扩展使用 VS Code 的 `globalState` 持久化以下配置：

- 串口参数（波特率、数据位、校验位、停止位、换行符）
- 显示选项（时间戳、HEX 模式、Echo）
- 发送历史（最近 20 条）
- Webview UI 状态（发送内容、区域高度、HEX Send）

### 状态栏图标

扩展在 VS Code 底部状态栏显示两个图标：

1. **左侧（优先级 101）** — Bridge Server 状态
   - 🟢 `$(broadcast) SA Bridge Ready` — 运行中
   - ⚪ `$(circle-slash) SA Bridge Off` — 已停止
   - 点击可切换 Bridge Server

2. **左侧（优先级 100）** — 串口连接状态
   - 🟢 `$(plug) COM3 @ 115200` — 已连接
   - 🔄 `$(sync~spin) Reconnecting...` — 重连中
   - ⚫ `$(debug-disconnect) Serial` — 未连接
   - 点击可快速打开面板或断开连接

## 故障排除

### 串口连接失败

1. 确认串口未被其他程序占用
2. 检查串口参数配置（波特率、数据位等）
3. 尝试使用管理员权限重启 VS Code
4. 查看 **Output → Serial Agent Bridge** 了解详细错误

### 扩展无法加载

1. 确认 Node.js 版本 >= 16.x
2. 删除 `node_modules` 重新安装依赖
3. 检查 serialport 原生模块是否正确编译

### 日志显示异常

1. 尝试切换 HEX 模式
2. 调整波特率设置
3. 检查设备固件是否正常输出

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/AmazingFeature`）
3. 提交更改（`git commit -m 'Add some AmazingFeature'`）
4. 推送到分支（`git push origin feature/AmazingFeature`）
5. 开启 Pull Request

### 开发环境设置

```bash
# 克隆仓库
git clone https://github.com/serialagent/serial-agent.git
cd serial-agent

# 安装依赖
npm install

# 构建所有包
npm run build

# 运行测试（如果存在）
npm test
```

## License

MIT License - 详见 [LICENSE](../../LICENSE) 文件

## 相关链接

- [VS Code 扩展开发文档](https://code.visualstudio.com/api)
- [SerialPort 文档](https://serialport.io/docs)
- [MCP 规范](https://modelcontextprotocol.io)
