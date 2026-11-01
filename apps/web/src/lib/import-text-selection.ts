/** textarea 将 CRLF/CR 显示为 LF，选区必须映射回原文，不能改变作者的换行 */
export function originalTextSelection(text: string, start: number, end: number) {
  let originalStart = text.length;
  let originalEnd = text.length;
  let displayed = 0;
  for (let offset = 0; offset <= text.length; offset++) {
    if (displayed === start) originalStart = offset;
    if (displayed === end) {
      originalEnd = offset;
      break;
    }
    if (text[offset] === '\r' && text[offset + 1] === '\n') offset++;
    displayed++;
  }
  return text.slice(originalStart, originalEnd);
}
