import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  textToBytes, bytesToText, bytesToBase64, parseBase64Input,
  hexToBytes, bytesToHex, formatBytes, safeFilename, decodedFilename,
} from '../src/codec.js';

const vectors = [
  ['', ''], ['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy'],
  ['你好', '5L2g5aW9'], ['hello', 'aGVsbG8='],
];
for (const [text, encoded] of vectors) {
  test(`Base64 round trip: ${JSON.stringify(text)}`, () => {
    assert.equal(bytesToBase64(textToBytes(text)), encoded);
    assert.equal(bytesToText(parseBase64Input(encoded).bytes), text);
  });
}

test('UTF-8 preserves emoji, line endings, NUL, combining characters and BOM', () => {
  const text = '\uFEFF你好 👩🏽‍💻\r\n\0e\u0301';
  assert.equal(bytesToText(textToBytes(text)), text);
});
test('invalid Unicode surrogate is not silently replaced', () => {
  assert.throws(() => textToBytes('\uD800'), /Unicode/);
});
test('GBK agrees with known GB2312 bytes', () => {
  assert.equal(bytesToHex(textToBytes('中文', 'gbk')), 'D6 D0 CE C4');
  assert.equal(bytesToBase64(textToBytes('你好', 'gbk')), 'xOO6ww==');
  assert.equal(bytesToText(hexToBytes('D6D0CEC4'), 'gbk'), '中文');
});
test('GBK round trip includes ASCII and extended characters', () => {
  const text = '你好，世界！ABC 123 € 龘';
  assert.equal(bytesToText(textToBytes(text, 'gbk'), 'gbk'), text);
});
test('GBK rejects unrepresentable characters rather than replacing them', () => {
  assert.throws(() => textToBytes('你好😀', 'gbk'), /UTF-8/);
});
test('invalid UTF-8 bytes give an actionable error', () => {
  assert.throws(() => bytesToText(hexToBytes('FF FE FF')), /文件与图片/);
});
test('Base64URL and missing padding decode', () => {
  const bytes = hexToBytes('FB FF FE');
  assert.equal(bytesToBase64(bytes, { variant: 'url' }), '-__-');
  assert.deepEqual(parseBase64Input('-__-').bytes, bytes);
  assert.equal(bytesToBase64(textToBytes('f'), { padding: false }), 'Zg');
  assert.equal(bytesToText(parseBase64Input('Zg').bytes), 'f');
});
test('whitespace and wrapped Base64 decode', () => {
  assert.equal(bytesToText(parseBase64Input(' Z m 9 v \r\nY m F y ').bytes), 'foobar');
});
test('Data URI decodes and preserves MIME', () => {
  const result = parseBase64Input('data:image/png;base64,Zm9v');
  assert.equal(result.mime, 'image/png');
  assert.equal(bytesToText(result.bytes), 'foo');
});
test('Data URI supports charset metadata', () => {
  assert.equal(parseBase64Input('data:text/plain;charset=utf-8;base64,Zg==').mime, 'text/plain');
});
for (const input of ['A', 'a===', 'Zm=v', 'Zg=', 'Zm9v=', 'Zm9v!!!', 'Zh==', 'data:text/plain,abc', 'data:bad type;base64,Zg==']) {
  test(`reject malformed Base64: ${input}`, () => assert.throws(() => parseBase64Input(input)));
}
test('binary round trips match the platform encoder across chunk boundaries', () => {
  for (const length of [1, 2, 3, 255, 32767, 32768, 32769, 1024 * 1024 + 1]) {
    const bytes = randomBytes(length);
    const encoded = bytesToBase64(bytes);
    assert.equal(encoded, bytes.toString('base64'));
    assert.deepEqual(Buffer.from(parseBase64Input(encoded).bytes), bytes);
  }
});
test('hexadecimal import accepts spaces and 0x prefixes', () => {
  assert.equal(bytesToHex(hexToBytes('0xE4 0xBD 0xA0\nE5 A5 BD')), 'E4 BD A0 E5 A5 BD');
  assert.equal(bytesToText(hexToBytes('E4BDA0E5A5BD')), '你好');
  assert.equal(hexToBytes('').length, 0);
  assert.throws(() => hexToBytes('F'), /两个字符/);
  assert.throws(() => hexToBytes('GG'), /十六进制/);
});
test('file sizes and safe Windows filenames', () => {
  assert.equal(formatBytes(10), '10 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(safeFilename('a/b:c?.txt'), 'a_b_c_.txt');
  assert.equal(safeFilename('CON.txt'), 'decoded.bin');
  assert.equal(safeFilename('...'), 'decoded.bin');
  assert.equal(decodedFilename('image/png'), 'decoded.png');
  assert.equal(decodedFilename('', 'notes.pdf.base64'), 'notes.pdf');
});
