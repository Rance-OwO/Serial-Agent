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
