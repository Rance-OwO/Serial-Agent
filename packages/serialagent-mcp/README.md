# Serial Agent MCP Server

Serial Agent MCP Server exposes serial debugging tools over MCP (stdio transport) and forwards calls to the local Bridge Server in VS Code.

## D-01 契约基线（Frozen）

- 契约文档：`prodoc/error-code-spec-v1.md`
- 契约版本：`D-01-v1.0 (Frozen)`
- 认证口径：
  - 缺失认证头：`AUTH_REQUIRED` (401)
  - Token 不匹配：`AUTH_INVALID_TOKEN` (401)

## 响应包络

### 失败包络（统一）

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

### 成功包络（兼容说明）

- Keil 相关 API 采用 `success + data`：

```json
{
  "success": true,
  "data": {}
}
```

- 历史串口 API 可能返回兼容结构（如 `{ ports: [...] }`, `{ lines: [...] }`）。

## 关键错误码基线

### Bridge 通用

- `AUTH_REQUIRED`
- `AUTH_INVALID_TOKEN`
- `NOT_FOUND`
- `INVALID_JSON_BODY`
- `REQUEST_BODY_TOO_LARGE`
- `MISSING_REQUIRED_FIELD`
- `MISSING_REQUIRED_PARAMETER`
- `INVALID_ARGUMENT`
- `SERIAL_NOT_CONNECTED`
- `SERIAL_CONNECT_FAILED`
- `SERIAL_SEND_FAILED`
- `NETWORK_TIMEOUT`
- `SERIAL_EXCEPTION`
- `INTERNAL_SERVER_ERROR`

### Keil API

- `KEIL_API_UNAVAILABLE`
- `KEIL_TASK_BUSY`
- `KEIL_CONFIG_INVALID`
- `KEIL_CONFIG_CHECK_FAILED`
- `KEIL_BUILD_FAILED`
- `KEIL_FLASH_FAILED`
- `KEIL_BUILD_FLASH_FAILED`

## 13 个工具（当前实现）

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

## Permission-Friendly Integration

### Important Reality

`serial-agent-mcp` 暴露的是 MCP tools，本身不直接控制客户端是否弹权限确认。

这意味着：

- 是否默认自动允许，通常由客户端的权限模型决定
- MCP server 侧更适合做的是“降低权限摩擦”，而不是假设自己能强制关闭确认
- 当前 server 侧已经做的方向是：
  - 把只读工具和有副作用工具的描述写清楚
  - 让客户端更容易判断哪些工具适合默认自动允许

### Tool Risk Profile

#### Read / Observe

- `get_serial_status`
- `list_serial_ports`
- `read_serial_log`
- `wait_for_output`
- `check_keil_config`

特点：

- 只读或以读取为主
- 不直接修改设备固件状态
- 更适合被客户端视为“默认自动允许”的候选

#### Operate

- `connect_serial`
- `disconnect_serial`
- `send_serial_data`
- `send_and_wait`
- `clear_serial_log`

特点：

- 会与设备通信状态或本地桥接状态发生交互
- 不一定高风险，但属于真实操作，不应被误写成纯读取

#### External / Side-effectful

- `build_keil_project`
- `flash_keil_firmware`
- `build_and_flash_keil`

特点：

- 会调用外部工具链
- 可能更新本地构建产物
- 可能覆盖目标设备固件

### Recommended Position

如果客户端支持按整个 MCP server 做默认允许，当前项目的推荐姿态是：

- 可以将 `serial-agent` 作为一个整体 server 加入默认允许列表
- 但集成方仍应理解其中包含有副作用工具
- 对高副作用工具是否额外二次确认，仍由客户端自行决定

换句话说：

- 本项目支持“整体上更容易默认允许”
- 但不承诺“server 端强制让所有客户端都默认自动允许”

## 示例

### 认证失败（缺失认证头）

```json
{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Missing Authorization header"
  }
}
```

### 认证失败（Token 无效）

```json
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_TOKEN",
    "message": "Invalid bearer token"
  }
}
```

### 编译烧录成功

```json
{
  "success": true,
  "data": {
    "stage": "build-and-flash",
    "buildOk": true,
    "flashOk": true,
    "artifactPath": "D:/_KeilProject/Objects/demo.hex"
  }
}
```

### 编译任务忙

```json
{
  "success": false,
  "error": {
    "code": "KEIL_TASK_BUSY",
    "message": "Another Keil build/flash task is currently running",
    "details": {
      "stage": "build"
    }
  }
}
```
