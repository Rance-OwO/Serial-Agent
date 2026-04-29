# Relation Attachments Package Link

## 声明

本文档中提到的软件、驱动、调试器工具链、编译器与开发环境，均来自对应厂商或开源社区的官方发布渠道，不属于 `Serial Agent` 项目本身的开发成果，也不随本项目一起提供或分发。

请以各官方页面中的最新许可协议、系统要求、安装说明和版本发布信息为准。本项目在这里仅提供依赖关系说明、推荐官方下载入口，以及安装后的基础校验方法，方便发布包使用者补齐环境。

---

## 1. 烧录使用

当前 `Serial Agent` 插件实际支持以下三种烧录后端：

- `jlink`
- `stlink`
- `openocd`

请注意：

- `stlink` 后端实际调用的是 `STM32_Programmer_CLI.exe`
- `openocd` 后端实际调用的是 `openocd.exe`
- `jlink` 后端实际依赖的是 SEGGER J-Link 官方安装包

### 1.1 SEGGER J-Link

- 官方地址：
  - https://www.segger.com/downloads/jlink
- 对应用途：
  - 当 `serialagent.flash.method = jlink` 时使用
  - 用于 J-Link / J-Trace 调试器的下载、连接与相关命令行工具支持
- 安装后如何校验：
  - 确认安装目录存在 `JLink.exe`
  - 确认安装目录存在 `JLinkGDBServerCL.exe`
  - 在 PowerShell 中可尝试执行(仅供参考)：

```powershell
Get-ChildItem 'C:\Program Files\SEGGER' -Recurse -Filter JLink.exe -ErrorAction SilentlyContinue
```

- 常见说明：
  - 该安装包通常会一并提供 J-Link 相关驱动和常用命令行工具
  - `Serial Agent` 中通常对应 `serialagent.jlink.installDirectory`

### 1.2 STM32CubeProgrammer

- 官方地址：
  - https://www.st.com/stm32cubeprog
- 对应用途：
  - 当 `serialagent.flash.method = stlink` 时使用
  - `Serial Agent` 实际调用的是 `STM32_Programmer_CLI.exe`
  - 适用于基于 ST-Link 的 STM32 下载、擦除、校验和选项字节相关操作
- 安装后如何校验：
  - 确认安装目录存在 `STM32_Programmer_CLI.exe`
  - 在 PowerShell 中可尝试执行(仅供参考)：

```powershell
Get-ChildItem 'C:\Program Files\STMicroelectronics' -Recurse -Filter STM32_Programmer_CLI.exe -ErrorAction SilentlyContinue
```

- 常见说明：
  - `Serial Agent` 中通常对应 `serialagent.stlink.exePath`
  - 若 CLI 已正常安装，但设备仍无法识别，请继续安装下方 `ST-LINK USB Driver`

### 1.3 ST-LINK USB Driver

- 官方地址：
  - https://www.st.com/en/development-tools/stsw-link009.html
- 对应用途：
  - 为 Windows 提供 ST-LINK/V2、ST-LINK/V2-1、STLINK-V3 等设备的 USB 驱动支持
  - 当 STM32CubeProgrammer 或系统设备管理器无法正确识别 ST-Link 设备时，通常需要补装
- 安装后如何校验：
  - 插入 ST-Link 后，在设备管理器中确认设备已被正常识别
  - 打开 `STM32CubeProgrammer` 或使用 `STM32_Programmer_CLI.exe` 连接目标板，确认能识别到 ST-Link

### 1.4 OpenOCD

- 官方地址：
  - https://openocd.org/pages/getting-openocd.html
- 对应用途：
  - 当 `serialagent.flash.method = openocd` 时使用
  - 用于通过 `openocd.exe` 配合 `interface/*.cfg` 与 `target/*.cfg` 完成烧录、复位、运行等动作
- 安装后如何校验：
  - 确认安装目录存在 `openocd.exe`
  - 确认同一套安装内容中包含 `scripts\interface` 与 `scripts\target` 目录
  - 在 PowerShell 中可尝试执行(仅供参考)：

```powershell
Get-ChildItem 'D:\OpenOCD' -Recurse -Filter openocd.exe -ErrorAction SilentlyContinue
```

- 常见说明：
  - `Serial Agent` 中通常对应 `serialagent.openocd.exePath`
  - `Serial Agent` 当前保存的是 `interface` / `target` 的短名称，运行时再拼接为对应 `.cfg`

---

## 2. 对本项目进行二次开发使用

这一层是针对 `Serial Agent` 仓库本身的开发、调试、构建和测试环境，不等同于单纯的固件烧录工具。

### 2.1 Visual Studio Code

- 官方地址：
  - https://code.visualstudio.com/download
- 对应用途：
  - 用于打开本仓库、调试 `serialagent-vscode` 扩展、查看 TypeScript/前端代码与运行日志
  - 也用于安装和测试打包后的 VSIX 插件
- 安装后如何校验：
  - 在 PowerShell 中执行：

```powershell
code --version
```

- 常见说明：
  - 若命令不可用，通常是安装时未加入 PATH，或者尚未安装 VS Code CLI

### 2.2 Node.js

- 官方地址：
  - https://nodejs.org/en/download
- 对应用途：
  - 用于执行本仓库的 `npm install`、`npm run build`、`npm test`
  - 本项目是 Node.js Monorepo，工作区构建与测试依赖 Node.js 和 npm
- 安装后如何校验：
  - 在 PowerShell 中执行：

```powershell
node -v
npm -v
```

- 常见说明：
  - 建议优先安装 Node.js 官方 LTS 版本

---

## 3. 编译使用

这一层是针对固件工程构建链。请特别注意：

- 本项目当前构建入口仍然是 `UV4.exe`
- `ARM Compiler 5` 不是新的构建入口
- `serialagent.keil.armcc5Path` 的作用主要是为 ARMCC5 工具链补路径，帮助 Keil/构建流程解析旧编译器环境

### 3.1 Keil MDK-ARM / UV4.exe

- 官方地址：
  - https://www.keil.arm.com/keil-mdk/
  - https://www.keil.arm.com/
- 对应用途：
  - 用于安装 Keil MDK 与 `uVision` 环境
  - `Serial Agent` 在构建阶段调用的是 `UV4.exe`
  - 适用于当前项目中的 `.uvprojx` / `.uvproj` 工程编译
- 安装后如何校验：
  - 确认安装目录存在 `UV4.exe`
  - 在 PowerShell 中可尝试执行(仅供参考)：

```powershell
Get-ChildItem 'C:\Keil_v5' -Recurse -Filter UV4.exe -ErrorAction SilentlyContinue
```

- 常见说明：
  - `Serial Agent` 中通常对应 `serialagent.keil.uv4Path`
  - 如果只是烧录而不需要在插件中触发 Keil 编译，则这一项不一定是必需的

### 3.2 ARM Compiler 5

- 官方地址：
  - https://www.keil.arm.com/keil-mdk/
  - https://www.keil.arm.com/packs/arm_compiler-keil/
- 对应用途：
  - 用于需要 ARMCC5 工具链的旧式 Keil 工程
  - 为当前项目中的旧编译链提供兼容支持
- 安装后如何校验：
  - 确认安装目录内存在 `armcc.exe`
  - 在 PowerShell 中可尝试执行(仅供参考)：

```powershell
Get-ChildItem 'C:\Keil_v5' -Recurse -Filter armcc.exe -ErrorAction SilentlyContinue
```

- 常见说明：
  - `Serial Agent` 中通常对应 `serialagent.keil.armcc5Path`
  - 这里的路径配置是为了补齐 ARMCC5 工具链定位，不代表 `Serial Agent` 会绕过 `UV4.exe` 直接改用另一套主构建入口
  - 若你的 MDK 安装形态、许可方式或旧版本工具链获取方式与当前官网入口不同，请以 Keil/Arm 官方账户与许可通道为准

---

## 4. 配置项与工具的对应关系

安装完成后，常见路径类配置项通常对应如下：

| 工具                    | 对应配置项                             | 说明                              |
| ----------------------- | -------------------------------------- | --------------------------------- |
| Keil `UV4.exe`        | `serialagent.keil.uv4Path`           | Keil 主构建入口                   |
| ARM Compiler 5          | `serialagent.keil.armcc5Path`        | ARMCC5 工具链补路径               |
| SEGGER J-Link           | `serialagent.jlink.installDirectory` | J-Link 安装目录                   |
| STM32CubeProgrammer CLI | `serialagent.stlink.exePath`         | 指向 `STM32_Programmer_CLI.exe` |
| OpenOCD                 | `serialagent.openocd.exePath`        | 指向 `openocd.exe`              |

补充说明：

- 以上路径类设置通常应写入用户级配置，而不是工作区级配置
- 如果配置项已填写，但实际文件不存在，`Check Build/Flash Config` 仍会报错
- 若 `JLink` 可实际烧录但 `JLink CPU` 选择时报设置作用域错误，那是配置写入层的问题，不一定代表烧录链本身不可用

---

## 5. 建议

- 优先使用官方页面提供的当前稳定版或最新版，不建议在此文档中写死具体版本号
- Windows 下常见安装目录仅可作为示例，最终请以你的实际安装路径为准
- 若仅使用串口功能而不涉及固件构建/烧录，则不需要安装完整烧录链和编译链
- 若要完整使用本项目的编译与烧录能力，通常至少需要补齐：
  - `VS Code`
  - `Node.js`
  - `Keil MDK-ARM / UV4.exe`
  - `ARM Compiler 5`（仅在工程依赖 ARMCC5 时）
  - `J-Link` / `STM32CubeProgrammer` / `OpenOCD` 中你实际使用的烧录后端
