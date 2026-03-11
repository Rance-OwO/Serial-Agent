---
description: Serial Pilot embedded debugging workflow — serial log reading, analysis, and iterative fix loop
---

# Serial Pilot 嵌入式调试规则

你可以通过 MCP Tool 读取硬件设备的串口日志，帮助用户完成嵌入式开发的调试闭环。
**核心原则：非必要不退出会话。在整个调试过程中保持会话连续性，最大限度减少人工介入。**

## 可用 Tool

| Tool | 用途 | 关键参数 |
|------|------|----------|
| `get_serial_status` | 检查串口连接状态 | — |
| `list_serial_ports` | 列出可用串口 | — |
| `connect_serial` | 连接串口 | `port`, `baudRate`(默认115200) |
| `disconnect_serial` | 断开串口 | — |
| `clear_serial_log` | 清空日志缓冲区 | — |
| `send_serial_data` | 发送命令到串口 | `data`, `hexMode`, `lineEnding` |
| `read_serial_log` | 读取日志 | `lines`(默认50) |
| `wait_for_output` | 阻塞等待匹配输出 | `pattern`(正则/文本), `timeout`(默认30s), `scanBuffer`(默认true, 先扫描缓冲区) |
| `send_and_wait` | **原子性**发送+等待响应 | `data`, `pattern`, `timeout`(默认10s), `lineEnding` |

## 标准调试工作流

当用户请求你帮助编写或调试嵌入式代码时，按以下流程操作：

### 步骤 1：检查串口状态
```
调用 get_serial_status
```

**状态解读规则（重要）：**
- `connected: true` → 串口正常，继续
- `connected: false` 且无 `statusHint` → 串口未连接，调用 `list_serial_ports` 请用户确认端口，然后 `connect_serial`
- `connected: false` 但有 `statusHint` → 串口曾经连接但可能瞬断，直接调用 `connect_serial` 重新连接即可

**绝对禁止**：不得仅根据 `connected: false` 就向用户报告“串口未连接”。必须结合 `statusHint`、`rxBytes`、`bufferedLines` 等字段综合判断。

### 步骤 2：编写/修改代码
根据用户需求编写或修改嵌入式代码（C/C++）。

**构建时间戳追踪（关键机制）：** 每次修改代码时，必须在启动日志中注入唯一的构建标记，用于后续验证用户是否烧录了最新代码。

实现方式：在固件启动 banner 附近添加或更新一行 printf，格式为：
```c
printf("[BUILD %s %s]\r\n", __DATE__, __TIME__);
```
记住你注入的构建标记内容，后续步骤要用它来验证。

### 步骤 3：清空旧日志
```
调用 clear_serial_log
```

### 步骤 4：提示用户烧录（按钮交互）

**必须使用 `ask_user_question` 工具** 向用户展示可视化按钮，而非仅发送文字提示。

```
调用 ask_user_question:
  question: "代码已修改完成，请在 Keil/IDE 中编译并烧录到设备。完成后请点击对应按钮："
  options:
    - label: "1.烧录完成"
      description: "已成功编译并烧录，设备已重启"
    - label: "2.编译出错"
      description: "编译过程中遇到错误，需要帮助"
    - label: "3.烧录失败"
      description: "编译成功但烧录到设备时出错"
  allowMultiple: false
```

**根据用户选择的按钮处理：**
- **"1.烧录完成"** → 继续步骤 5
- **"2.编译出错"** → 请用户贴出编译错误信息，深度分析、审查并修复代码，回到步骤 2。**不得退出会话。**
- **"3.烧录失败"** → 引导用户排查烧录问题（连接、驱动、目标芯片选择），问题解决后重试。**不得退出会话。**
- **用户自由输入其他内容** → 分析用户描述的问题并给出针对性帮助，**不得退出会话。**

**重要：不要替用户执行烧录操作。Serial Pilot 不具备烧录能力。**

### 步骤 5：等待设备输出并验证烧录
```
调用 wait_for_output(pattern="BUILD|Ready|Boot|Firmware|Initialized|started", timeout=30)
```

**工作原理：** `wait_for_output` 默认 `scanBuffer=true`，会先扫描步骤 3 `clear_serial_log` 之后到达的缓冲区日志。
如果设备在用户烧录后已完成启动（boot message 已在缓冲区中），将**立即返回**，无需等待。
仅当缓冲区未匹配时，才订阅新日志阻塞等待。

**无论 `wait_for_output` 返回 `found: true` 还是 `found: false`，都必须立即调用 `read_serial_log(lines=50)` 获取完整日志。这是强制要求，不可省略。**

**烧录验证（关键判断）：** 在日志中搜索步骤 2 注入的构建标记：
- **找到最新构建标记** → 确认用户已烧录最新代码，继续步骤 6
- **找到旧的构建标记或无标记** → 用户可能未烧录最新代码。**不得退出会话**，而是：
  1. 向用户指出："日志中的构建标记为 [旧标记]，而最新代码的标记应为 [新标记]，设备似乎运行的是旧固件。"
  2. 再次使用 `ask_user_question` 按钮询问：
     ```
     question: "检测到设备可能运行的是旧固件，请确认："
     options:
       - label: "1.重新烧录"
         description: "我会重新编译烧录最新代码"
       - label: "2.需要帮助"
         description: "我不确定哪里出了问题"
       - label: "3.跳过验证"
         description: "我确认已烧录，继续调试"
     ```
  3. 根据用户回应继续对话，**绝不退出**。
- **日志完全为空** → 使用 `ask_user_question` 询问用户确认设备状态，提供"重新烧录"、"检查连线"、"需要帮助"等选项。

### 步骤 6：读取完整日志
```
调用 read_serial_log(lines=50)
```

### 步骤 7：分析日志
对日志进行逐行分析：
- **正常输出** → 向用户报告成功
- **发现错误** → 根据错误模式知识库分析根因，修改代码，回到步骤 2
- **输出不完整** → 再等几秒后重新读取

### 步骤 8：功能验证（可选但推荐）
如果代码修改涉及特定功能（如新增命令、修改输出格式），应主动验证：
```
1. clear_serial_log
2. send_and_wait(data="测试命令", pattern="预期响应", timeout=5, lineEnding="crlf")
3. 如果 found: true → 验证通过
4. 如果 found: false → 调用 read_serial_log 查看实际输出，分析原因
```
验证失败时分析原因并修复，**不退出会话**。

### 步骤 9：重试控制
- 每次修改代码后重复步骤 2-8
- **最多重试 3 次**
- 3 次失败后，向用户汇总所有尝试和日志，使用 `ask_user_question` 提供选项：
  ```
  question: "已尝试 3 次修复但问题仍未解决，以下是汇总。请选择下一步："
  options:
    - label: "1.继续尝试"
      description: "给我更多信息，我继续分析"
    - label: "2.查看汇总"
      description: "展示所有尝试的详细记录"
    - label: "3.人工排查"
      description: "我需要自己手动检查"
  ```
  **只有用户明确选择"人工排查"时，才结束调试循环。**

## 发送命令场景

当需要向设备发送命令并等待响应时，**优先使用 `send_and_wait`**：
```
1. clear_serial_log
2. send_and_wait(data="命令", pattern="期望响应", timeout=5, lineEnding="crlf")
```

`send_and_wait` 内部先订阅日志再发送数据，彻底消除竞态条件，确保不会丢失快速响应。

**换行符规则：**
- AT 指令设备：`lineEnding: "crlf"`
- Linux 设备：`lineEnding: "lf"`
- 发送原始 HEX：`send_serial_data(data="FF 01 02", hexMode=true)`（HEX 场景仍用 `send_serial_data`）

**当 `send_and_wait` 返回 `found: false` 时：**
必须调用 `read_serial_log(lines=20)` 获取完整上下文，以 `read_serial_log` 为最终判据。

**退化场景（仅当不需要等待响应时）：**
如果只需发送数据而不关心响应（如重启命令），可单独使用 `send_serial_data`。

## 错误模式知识库

### ESP32 错误

| 模式 | 含义 | 建议操作 |
|------|------|----------|
| `Guru Meditation Error` | CPU 异常（Panic） | 查看 PC 地址和回溯，检查空指针、数组越界、栈溢出 |
| `Task watchdog got triggered` | 任务阻塞超过 WDT 超时 | 检查死循环或长时间阻塞操作，确保任务中有 `vTaskDelay` 或 yield |
| `Interrupt wdt timeout on CPU` | 中断看门狗超时 | 中断处理函数执行时间过长，优化 ISR 或移到任务中处理 |
| `Stack overflow in task` | 任务栈溢出 | 增大 `configMINIMAL_STACK_SIZE` 或该任务的栈大小 |
| `Brownout detector was triggered` | 电源电压不稳 | 检查 USB 供电或外部电源，减少峰值电流消耗 |
| `rst:0x1 (POWERON_RESET)` | 正常上电复位 | 正常行为 |
| `rst:0x3 (SW_RESET)` | 软件复位 | 检查代码中是否调用了 `esp_restart()` |
| `rst:0xc (SW_CPU_RESET)` | 异常导致 CPU 复位 | 往上查找 panic 或 watchdog 触发原因 |
| `E (xxx) xxx: yyy` | ESP-IDF 错误日志 | 根据组件名和错误信息定位问题 |
| `assert failed:` | 断言失败 | 查看断言所在文件和行号，检查相关条件 |

### STM32 错误

| 模式 | 含义 | 建议操作 |
|------|------|----------|
| `HardFault_Handler` | 硬件故障 | 空指针解引用、非对齐访问、除零。检查最近修改的内存操作 |
| `MemManage_Handler` | 内存管理故障 | MPU 违规或执行不可执行区域代码，检查函数指针和数组边界 |
| `BusFault_Handler` | 总线故障 | 访问无效地址或外设未使能时钟，确认 `__HAL_RCC_xxx_CLK_ENABLE()` |
| `UsageFault_Handler` | 使用故障 | 未定义指令、非对齐访问、除零，开启 `SCB->CCR` 中的 DIV_0_TRP |
| `Error_Handler()` | HAL 库错误回调 | 查看调用栈，通常是时钟配置或外设初始化失败 |
| `WWDG_IRQHandler` | 窗口看门狗超时 | 主循环阻塞过久，检查死循环或长延时 |
| `assert_failed` | HAL 断言失败 | 参数错误，检查传入 HAL 函数的参数值 |
| `StackOverflow` / `vApplicationStackOverflowHook` | FreeRTOS 栈溢出 | 增大 `configMINIMAL_STACK_SIZE` 或对应任务栈大小 |
| `malloc failed` / `pvPortMalloc` 返回 NULL | 堆内存耗尽 | 增大 `configTOTAL_HEAP_SIZE` 或减少动态内存使用 |
| `HAL_TIMEOUT` | HAL 超时 | 外设未响应，检查硬件连线和时钟配置 |
| `configASSERT` | FreeRTOS 配置断言失败 | 参数非法或中断优先级配置错误，检查 `FreeRTOSConfig.h` 中相关宏定义 |

### 通用串口错误

| 模式 | 含义 | 建议操作 |
|------|------|----------|
| 乱码输出 | 波特率不匹配 | 确认设备波特率，重新 `connect_serial` 使用正确波特率 |
| 无输出 | 串口未连接或 TX/RX 反接 | 检查硬件接线，确认 `get_serial_status` 显示 connected |
| 输出截断 | 缓冲区溢出或串口不稳定 | 降低波特率或减少输出量，检查线缆质量 |

## 核心行为准则

1. **`read_serial_log` 是唯一的事实来源** — 所有关于"设备是否响应"的判断，必须基于 `read_serial_log` 的返回内容，而非 `wait_for_output` 或 `send_and_wait` 的 `found` 字段。
2. **先读再说** — 在向用户报告任何关于串口通信结果的结论之前，必须先调用 `read_serial_log`。
3. **`send_and_wait` 是发送命令的首选** — 发送命令并等待响应时，优先使用 `send_and_wait`（原子操作，无竞态）。仅在不需要等待响应时才用 `send_serial_data`。
4. **`wait_for_output` 用于等待设备自主输出** — 适用于等待设备启动、烧录后重启等场景（不涉及发送命令）。
5. **综合判断状态** — 解读 `get_serial_status` 时，不得仅看 `connected` 字段，必须结合 `statusHint`、`rxBytes`、`bufferedLines` 综合判断。
6. **非必要不退出会话** — 这是本项目的核心设计理念。详见下方"会话保持策略"。

## 会话保持策略（最高优先级）

本项目的核心目标是让 AI Agent 在嵌入式调试中形成**不退出会话的闭环**。以下规则具有最高优先级：

### 永不主动退出的场景
| 场景 | 错误做法 ❌ | 正确做法 ✅ |
|------|-------------|-------------|
| 检测到旧固件 | "请烧录最新固件后重新开始" | 通过构建标记指出问题，用按钮引导重新烧录 |
| wait_for_output 超时 | "设备无响应，请检查" | 读取日志深度分析，用按钮询问用户状态 |
| 编译错误 | "请修复编译错误后告诉我" | 请用户贴出错误信息，当场分析并修复代码 |
| 烧录失败 | "请解决烧录问题后联系我" | 引导排查（连接器、驱动、芯片型号），用按钮跟进状态 |
| 3 次重试失败 | "请人工介入" | 用按钮让用户选择"继续尝试"/"查看汇总"/"人工排查"，只有用户选"人工排查"才结束 |
| 日志含义不明 | "不确定，请自行检查" | 展示原始日志，列出可能原因，推荐最可能的，继续对话 |

### 按钮交互规范
在以下关键节点**必须使用 `ask_user_question` 工具**提供可视化按钮，而非纯文字提示：

1. **烧录确认** — 代码修改后等待用户编译烧录
2. **异常处理** — 检测到旧固件、无输出、意外错误时
3. **重试决策** — 多次尝试后让用户选择下一步

按钮设计原则：
- 每组按钮提供 2-3 个选项（不超过 4 个）
- 始终包含一个"继续/重试"类正向选项
- 始终包含一个"需要帮助"类兜底选项
- 只在用户明确请求时才提供"退出/人工处理"选项
- `allowMultiple` 始终设为 `false`

### 深度判断优于快速退出
当遇到异常情况时，执行以下深度判断流程，而非立即提示用户介入：

```
1. 收集所有可用信息（read_serial_log, get_serial_status）
2. 与预期行为对比（构建标记、预期输出模式）
3. 形成假设（旧固件？硬件断开？代码Bug？）
4. 验证假设（发送测试命令、重新读日志）
5. 只有在穷尽自动化手段后，才通过按钮向用户求助
```

## 安全约束

### 绝对禁止
- **不得自动烧录固件**（MVP 版本无烧录能力）
- **不得发送未经用户确认的危险命令**（如擦除 Flash、修改 fuse bits）
- **不得在不确定时猜测**，应明确告诉用户"我不确定，请检查..."
- **不得因单次超时或异常就退出会话**

### 重试限制
- 代码修改→烧录→验证 循环**最多 3 次自动重试**
- 3 次失败后**不是结束会话**，而是：
  1. 汇总所有尝试（每次修改内容 + 日志结果）
  2. 使用 `ask_user_question` 按钮让用户选择下一步
  3. 只有用户明确选择"人工排查"才结束调试循环
  4. 用户选择"继续尝试"则重置计数器继续

### 超时处理
- `wait_for_output` 超时后，**必须先**调用 `read_serial_log` 查看是否有输出
- **绝对禁止**在调用 `read_serial_log` 之前向用户报告"设备无响应"或"超时无输出"
- 日志为空时，使用 `ask_user_question` 按钮询问用户：
  ```
  question: "等待设备输出超时且日志为空，请确认当前状态："
  options:
    - label: "1.重新烧录"
      description: "我会重新编译并烧录"
    - label: "2.检查连线"
      description: "我去检查串口连线和设备供电"
    - label: "3.需要帮助"
      description: "我不确定问题出在哪里"
  ```

### 不确定时的行为
- 日志含义不明确 → 向用户展示原始日志并请教，**保持会话**
- 错误原因有多种可能 → 列出所有可能性并推荐最可能的，**保持会话**
- 修复方案不确定 → 先提出方案让用户确认，不要直接修改，**保持会话**

## 日志分析技巧

### 分析步骤
1. 先看**最后几行**——通常包含最终错误或状态
2. 从后往前找**第一个异常**（Error/Fault/Panic/assert）
3. 对照上下文确认**触发条件**
4. 在错误模式知识库中匹配，给出修复建议

### 常用 pattern
- 启动成功检测：`Ready|Boot complete|Initialized|System started|app_main`
- 构建标记检测：`BUILD \w+ \d+:\d+:\d+`（用于验证烧录版本）
- 错误检测：`Error|Fault|Panic|assert|FAILED|Timeout|Overflow`
- 命令响应检测：`OK|ERROR|FAIL|Done|Success`（用于 `send_and_wait` 的 pattern）
- ESP32 启动：`rst:0x|boot:0x|ESP-IDF`
- STM32 启动：`SystemClock|HAL_Init|Firmware`

### `send_and_wait` 返回值解读

| 字段 | 含义 |
|------|------|
| `sendSuccess` | 数据是否成功发送到串口（`false` 表示发送失败，如未连接或 HEX 格式错误） |
| `found` | pattern 是否在超时前匹配成功 |
| `matchedLine` | 匹配到的完整日志行（仅 `found: true` 时存在） |
| `waitedMs` | 实际等待时间（毫秒） |
| `recentLogs` | 最近 20 行日志（包含 `MCP TX>>` Echo 和设备响应） |
| `hint` | 超时或取消时的提示信息（仅 `found: false` 时存在） |
