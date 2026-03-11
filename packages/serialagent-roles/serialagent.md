---
description: Serial Pilot embedded debugging workflow — serial log reading, analysis, keil build/flash, and iterative fix loop
---

# Serial Pilot 嵌入式调试规则

你可以通过 MCP Tool 读取串口日志、执行 Keil 编译烧录，并完成“改代码→编译烧录→读日志→验证”的闭环调试。

## 当前可用 Tool（13个）

| Tool | 用途 | 关键参数 |
|---|---|---|
| `get_serial_status` | 读取串口状态 | — |
| `list_serial_ports` | 列出可用串口 | — |
| `connect_serial` | 连接串口 | `port`, `baudRate`, `dataBits`, `parity`, `stopBits` |
| `disconnect_serial` | 断开串口 | — |
| `read_serial_log` | 读取日志缓冲区 | `lines` |
| `send_serial_data` | 发送串口数据 | `data`, `hexMode`, `lineEnding` |
| `clear_serial_log` | 清空日志并重置计数 | — |
| `wait_for_output` | 等待日志匹配 | `pattern`, `timeout`, `scanBuffer` |
| `send_and_wait` | 原子发送+等待 | `data`, `pattern`, `timeout`, `hexMode`, `lineEnding` |
| `check_keil_config` | 检查 Keil/JLink 配置完整性 | — |
| `build_keil_project` | 执行 Keil 编译 | — |
| `flash_keil_firmware` | 执行 JLink 烧录 | `artifactPath`(可选) |
| `build_and_flash_keil` | 一键编译并烧录 | — |

## 严格约束

1. 只使用上表工具；不要假设存在 `ask_user_question` 等额外工具。
2. 在报告“设备无响应/已失败”前，必须先调用 `read_serial_log` 获取证据。
3. 优先闭环，不要把关键动作推给用户（编译/烧录优先用 Keil 工具自动执行）。
4. 失败时优先给可执行修复步骤，不做空泛建议。

## 最小闭环模板（推荐默认流程）

### 步骤 1：串口就绪
1. `get_serial_status`
2. 若未连接：`list_serial_ports` → `connect_serial`

状态判定：
- `connected=true`：继续
- `connected=false` 且有 `statusHint`：优先重连同端口
- `connected=false` 且无 `statusHint`：重新枚举端口后连接

### 步骤 2：配置预检（编译/烧录前）
1. `check_keil_config`
2. 判定 `data.configOk`

若 `configOk=false`：直接列出 `checks` 中失败项，按项修复后重试本步骤。

### 步骤 3：清理上下文
1. `clear_serial_log`

### 步骤 4：执行编译烧录
默认使用：
1. `build_and_flash_keil`

替代流程（需要分步定位时）：
1. `build_keil_project`
2. `flash_keil_firmware`

成功判定：
- `build_and_flash_keil`: `success=true` 且 `data.buildOk=true` 且 `data.flashOk=true`
- 分步：编译返回 `buildOk=true`，烧录返回 `flashOk=true`

### 步骤 5：等待启动日志
1. `wait_for_output(pattern="BUILD|Ready|Boot|Firmware|Initialized|started", timeout=30)`
2. 无论 `found` true/false，立即 `read_serial_log(lines=80)`

### 步骤 6：版本与行为验证
建议固件始终打印构建标记：
```c
printf("[BUILD %s %s]\r\n", __DATE__, __TIME__);
```

判定：
- 有最新构建标记：认为烧录版本正确
- 只有旧标记或无标记：进入“旧固件回退模板”

## 失败回退策略模板

### 模板 A：编译失败
触发：`build_keil_project` 或 `build_and_flash_keil` 失败，错误码常见 `KEIL_BUILD_FAILED` / `KEIL_CONFIG_INVALID`

处理：
1. 输出失败错误码与消息
2. 给出下一步动作（修配置、修代码）
3. 修复后重试 `check_keil_config` → 编译

### 模板 B：烧录失败
触发：错误码 `KEIL_FLASH_FAILED` / `KEIL_TASK_BUSY`

处理：
1. 若 `KEIL_TASK_BUSY`：等待当前任务结束后重试
2. 否则检查 `jlink.device/interface/speed` 与硬件连线
3. 仅重试烧录，不重复编译（必要时显式指定 `artifactPath`）

### 模板 C：等待超时
触发：`wait_for_output` 返回 `found=false`

处理：
1. 必须 `read_serial_log(lines=80)`
2. 若有日志但未匹配：调整 pattern 后再次等待
3. 若日志为空：转模板 D

### 模板 D：无日志输出
触发：`read_serial_log` 返回空或无有效启动信息

处理：
1. `get_serial_status` 确认连接
2. 必要时 `disconnect_serial` → `connect_serial`
3. `clear_serial_log` 后再次 `wait_for_output`
4. 仍无输出则回到模板 B（优先怀疑烧录或设备未启动）

### 模板 E：旧固件判定
触发：日志构建标记与本次修改不一致

处理：
1. 明确指出“设备仍运行旧固件”
2. 重新执行 `build_and_flash_keil`
3. 再次 `wait_for_output` + `read_serial_log` 验证

### 模板 F：串口断连/异常
触发：`SERIAL_NOT_CONNECTED` / `SERIAL_CONNECT_FAILED` / `SERIAL_EXCEPTION`

处理：
1. `list_serial_ports` 重新选择端口
2. `connect_serial` 重连
3. 重复 `clear_serial_log` → `wait_for_output` 验证

## 错误码处理约定（Bridge）

失败响应结构：
```json
{
  "success": false,
  "error": {
    "code": "...",
    "message": "...",
    "details": {}
  }
}
```

重点错误码：
- 认证：`AUTH_REQUIRED`, `AUTH_INVALID_TOKEN`
- 参数：`MISSING_REQUIRED_FIELD`, `MISSING_REQUIRED_PARAMETER`, `INVALID_ARGUMENT`, `INVALID_JSON_BODY`
- 串口：`SERIAL_NOT_CONNECTED`, `SERIAL_CONNECT_FAILED`, `SERIAL_SEND_FAILED`, `SERIAL_EXCEPTION`
- 超时：`NETWORK_TIMEOUT`
- Keil：`KEIL_API_UNAVAILABLE`, `KEIL_TASK_BUSY`, `KEIL_CONFIG_INVALID`, `KEIL_BUILD_FAILED`, `KEIL_FLASH_FAILED`, `KEIL_BUILD_FLASH_FAILED`

处理规则：
1. 先读 `error.code` 再决定分支
2. `details` 用于构造下一步动作（端口、字段名、stage）
3. 同类错误连续两次后，切换到更保守分支（如先配置检查再执行）

## 命令发送场景规则

1. 需要“发送并等待响应”时，优先 `send_and_wait`。
2. `send_and_wait` 返回 `found=false` 时，必须补 `read_serial_log(lines=20)`。
3. 只发送不等待时可用 `send_serial_data`。
4. 常用换行：
- AT 指令：`lineEnding="crlf"`
- Linux 设备：`lineEnding="lf"`
- HEX 原始字节：`hexMode=true`

## 结果汇报模板（回复用户）

- 本轮执行：连接/配置检查/编译/烧录/日志验证结果
- 关键证据：`artifactPath`、匹配到的启动行、构建标记
- 结论：成功/失败
- 下一步：若失败，给一条最短可执行动作
