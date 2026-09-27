/**
 * text-codec 单元测试 — GBK/UTF-8 接收解码与发送编码
 */
import { describe, expect, it } from 'vitest';
import {
  decodeSerialText,
  encodeSerialText,
  normalizeSerialEncoding,
} from '../packages/serialagent-vscode/src/text-codec';

describe('normalizeSerialEncoding', () => {
  it('gbk 原样保留，其余值一律回退 utf8', () => {
    expect(normalizeSerialEncoding('gbk')).toBe('gbk');
    expect(normalizeSerialEncoding('utf8')).toBe('utf8');
    expect(normalizeSerialEncoding(undefined)).toBe('utf8');
    expect(normalizeSerialEncoding('UTF-8')).toBe('utf8');
    expect(normalizeSerialEncoding(null)).toBe('utf8');
  });
});

describe('decodeSerialText', () => {
  it('按 GBK 解码中文日志字节', () => {
    // "系统启动 中文测试" 的 GBK 字节（尾随 CR LF）
    const gbkBytes = Buffer.from([
      0xcf, 0xb5, 0xcd, 0xb3, 0xc6, 0xf4, 0xb6, 0xaf, 0x20,
      0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4,
      0x0d, 0x0a,
    ]);
    expect(decodeSerialText(gbkBytes, 'gbk')).toBe('系统启动 中文测试\r\n');
  });

  it('按 UTF-8 解码中文日志字节', () => {
    const text = '系统启动 中文测试\r\n';
    expect(decodeSerialText(Buffer.from(text, 'utf8'), 'utf8')).toBe(text);
  });

  it('纯 ASCII 两种编码结果一致', () => {
    const ascii = Buffer.from('hello serial agent\r\n', 'ascii');
    expect(decodeSerialText(ascii, 'utf8')).toBe('hello serial agent\r\n');
    expect(decodeSerialText(ascii, 'gbk')).toBe('hello serial agent\r\n');
  });

  it('GBK 双字节不吞换行符：0x0A 可安全作为行切分边界', () => {
    // GBK "换" = 0xBB BB，其后紧跟 0x0A，解码后换行符必须保留
    const line = Buffer.concat([Buffer.from([0xbb, 0xbb]), Buffer.from([0x0a])]);
    const decoded = decodeSerialText(line, 'gbk');
    expect(decoded.endsWith('\n')).toBe(true);
    expect(decoded.charCodeAt(0)).not.toBe(0x0a);
  });
});

describe('encodeSerialText', () => {
  it('发送文本按 GBK 编码', () => {
    // "中文" GBK = D6 D0 CE C4
    expect(Array.from(encodeSerialText('中文', 'gbk'))).toEqual([0xd6, 0xd0, 0xce, 0xc4]);
  });

  it('发送文本按 UTF-8 编码并与 Buffer 行为一致', () => {
    const text = '中文 abc\n';
    expect(Buffer.compare(encodeSerialText(text, 'utf8'), Buffer.from(text, 'utf8'))).toBe(0);
  });

  it('编码与解码可往返（utf8 / gbk）', () => {
    for (const encoding of ['utf8', 'gbk'] as const) {
      const text = '温度=25.5℃ 启动完成';
      expect(decodeSerialText(encodeSerialText(text, encoding), encoding)).toBe(text);
    }
  });
});
