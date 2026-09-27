/**
 * 串口文本编解码 — 接收日志解码与发送数据编码共用同一个 encoding 配置。
 *
 * Node Buffer 原生不支持 GBK，统一走 iconv-lite。
 * 按行切分以 0x0A 为界：GBK 双字节的第二个字节范围是 0x40-0xFE（不含 0x7F），
 * UTF-8 续字节均 >= 0x80，因此 0x0A 不会出现在多字节字符内部，切分安全。
 */
import iconv from 'iconv-lite';
import { SerialEncoding } from './types';

export function normalizeSerialEncoding(value: unknown): SerialEncoding {
  return value === 'gbk' ? 'gbk' : 'utf8';
}

export function decodeSerialText(buffer: Buffer, encoding: SerialEncoding): string {
  return iconv.decode(buffer, normalizeSerialEncoding(encoding));
}

export function encodeSerialText(text: string, encoding: SerialEncoding): Buffer {
  return iconv.encode(text, normalizeSerialEncoding(encoding));
}
