import { expect, it } from 'vitest';
import { originalTextSelection } from '../../apps/web/src/lib/import-text-selection.js';

it('textarea选区映射保留CRLF/CR与Unicode原文，而不是浏览器标准化的换行', () => {
  const source = '  开头\r\n星光🌟\r第二段\n末尾  ';
  const displayed = source.replace(/\r\n?/g, '\n');
  const start = displayed.indexOf('星');
  const end = displayed.indexOf('末');
  expect(originalTextSelection(source, start, end)).toBe('星光🌟\r第二段\n');
  expect(originalTextSelection(source, 0, displayed.length)).toBe(source);
  expect(originalTextSelection(source, 5, 5)).toBe('');
});
