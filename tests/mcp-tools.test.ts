import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerTools } from '../packages/serialagent-mcp/src/index';

type ToolHandler = (args: any) => Promise<any>;

interface ToolDef {
  description: string;
  schema: Record<string, unknown>;
  handler: ToolHandler;
}

class FakeMcpServer {
  readonly tools = new Map<string, ToolDef>();

  tool(name: string, description: string, schema: Record<string, unknown>, handler: ToolHandler): void {
    this.tools.set(name, { description, schema, handler });
  }
}

function getTool(server: FakeMcpServer, name: string): ToolDef {
  const tool = server.tools.get(name);
  if (!tool) { throw new Error(`Tool not found: ${name}`); }
  return tool;
}

function parseSchema(shape: Record<string, unknown>) {
  return z.object(shape as z.ZodRawShape);
}

describe('MCP tools registration and bridge mapping', () => {
  it('should register all 13 tools', () => {
    const server = new FakeMcpServer();
    registerTools(server as any, vi.fn() as any);
    expect(server.tools.size).toBe(13);

    expect([...server.tools.keys()].sort()).toEqual([
      'build_and_flash_keil',
      'build_keil_project',
      'check_keil_config',
      'clear_serial_log',
      'connect_serial',
      'disconnect_serial',
      'flash_keil_firmware',
      'get_serial_status',
      'list_serial_ports',
      'read_serial_log',
      'send_and_wait',
      'send_serial_data',
      'wait_for_output',
    ]);
  });

  it('should enforce required input for connect_serial schema', () => {
    const server = new FakeMcpServer();
    registerTools(server as any, vi.fn() as any);
    const connect = getTool(server, 'connect_serial');
    const schema = parseSchema(connect.schema);

    const invalid = schema.safeParse({});
    expect(invalid.success).toBe(false);

    const parsed = schema.parse({ port: 'COM3' });
    expect(parsed.port).toBe('COM3');
    expect(parsed.baudRate).toBe(115200);
    expect(parsed.dataBits).toBe(8);
    expect(parsed.stopBits).toBe(1);
    expect(parsed.parity).toBe('none');
  });

  it('should map core serial tools to expected bridge endpoints', async () => {
    const requester = vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] }));
    const server = new FakeMcpServer();
    registerTools(server as any, requester as any);

    await getTool(server, 'get_serial_status').handler({});
    await getTool(server, 'list_serial_ports').handler({});
    await getTool(server, 'connect_serial').handler({ port: 'COM7', baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
    await getTool(server, 'disconnect_serial').handler({});
    await getTool(server, 'read_serial_log').handler({ lines: 20 });
    await getTool(server, 'send_serial_data').handler({ data: 'AT', hexMode: false });
    await getTool(server, 'clear_serial_log').handler({});

    expect(requester).toHaveBeenCalledWith('GET', '/api/status');
    expect(requester).toHaveBeenCalledWith('GET', '/api/ports');
    expect(requester).toHaveBeenCalledWith('POST', '/api/connect', { port: 'COM7', baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
    expect(requester).toHaveBeenCalledWith('POST', '/api/disconnect');
    expect(requester).toHaveBeenCalledWith('GET', '/api/log?lines=20');
    expect(requester).toHaveBeenCalledWith('POST', '/api/send', { data: 'AT', hexMode: false });
    expect(requester).toHaveBeenCalledWith('POST', '/api/clear');
  });

  it('wait_for_output should encode query and set timeoutMs', async () => {
    const requester = vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] }));
    const server = new FakeMcpServer();
    registerTools(server as any, requester as any);

    await getTool(server, 'wait_for_output').handler({ pattern: '[ERROR] GPIO', timeout: 3, scanBuffer: true });

    expect(requester).toHaveBeenCalledWith(
      'GET',
      '/api/log/wait?pattern=%5BERROR%5D%20GPIO&timeout=3&scanBuffer=true',
      undefined,
      8000,
    );
  });

  it('send_and_wait should map body and timeoutMs correctly', async () => {
    const requester = vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] }));
    const server = new FakeMcpServer();
    registerTools(server as any, requester as any);

    await getTool(server, 'send_and_wait').handler({
      data: 'AT',
      pattern: 'OK',
      timeout: 10,
      hexMode: false,
      lineEnding: 'crlf',
    });

    expect(requester).toHaveBeenCalledWith(
      'POST',
      '/api/send-and-wait',
      { data: 'AT', pattern: 'OK', timeout: 10, hexMode: false, lineEnding: 'crlf' },
      15000,
    );
  });

  it('Keil tools should map to correct endpoints and pass through error text', async () => {
    const expectedError = {
      content: [{ type: 'text' as const, text: 'Bridge API POST /api/keil/build failed [KEIL_TASK_BUSY]: Another task is running' }],
      isError: true,
    };
    const requester = vi.fn(async (method: string, path: string) => {
      if (method === 'POST' && path === '/api/keil/build') {
        return expectedError;
      }
      return { content: [{ type: 'text' as const, text: '{}' }] };
    });
    const server = new FakeMcpServer();
    registerTools(server as any, requester as any);

    await getTool(server, 'check_keil_config').handler({});
    const buildRes = await getTool(server, 'build_keil_project').handler({});
    await getTool(server, 'flash_keil_firmware').handler({ artifactPath: 'D:/fw/app.hex' });
    await getTool(server, 'build_and_flash_keil').handler({});

    expect(requester).toHaveBeenCalledWith('GET', '/api/keil/config-check');
    expect(requester).toHaveBeenCalledWith('POST', '/api/keil/build');
    expect(requester).toHaveBeenCalledWith('POST', '/api/keil/flash', { artifactPath: 'D:/fw/app.hex' });
    expect(requester).toHaveBeenCalledWith('POST', '/api/keil/build-and-flash');

    expect(buildRes.isError).toBe(true);
    expect(buildRes.content[0].text).toContain('KEIL_TASK_BUSY');
  });
});

