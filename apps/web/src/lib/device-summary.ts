// 仅为会话列表提供展示摘要，身份与会话校验仍完全由 API 执行
export function deviceSummary(agent: string) {
  const browser = /Edg(?:e|A|iOS)?\//i.test(agent)
    ? 'Edge'
    : /(?:Firefox|FxiOS)\//i.test(agent)
      ? 'Firefox'
      : /(?:Chrome|CriOS)\//i.test(agent)
        ? 'Chrome'
        : /Safari\//i.test(agent)
          ? 'Safari'
          : '浏览器';
  const os = /Android/i.test(agent)
    ? 'Android'
    : /iPad/i.test(agent)
      ? 'iPad'
      : /iPhone|iPod/i.test(agent)
        ? 'iPhone'
        : /Windows/i.test(agent)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(agent)
            ? 'macOS'
            : /Linux/i.test(agent)
              ? 'Linux'
              : '未知系统';
  return {
    label: agent.trim() ? browser + ' · ' + os : '未知设备',
    mobile: /Android|iPhone|iPad|iPod/i.test(agent),
  };
}
