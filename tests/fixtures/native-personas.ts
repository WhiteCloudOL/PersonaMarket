import type { PersonaContent } from '@personamarket/contracts';

// 合成内容覆盖转义与 Unicode；原生格式由生产适配器生成，再交给真实上游消费。
export const specialText =
  '  清蒸云鸭 🦆\n第二行 "双引号" 与 \'单引号\'、反斜杠 \\、制表\t、回车\r、控制字符\u0001、DEL\u007f  ';
export const maiBotPersona: Extract<PersonaContent, { platform: 'maibot' }> = {
  platform: 'maibot',
  content: {
    personality: specialText,
    replyStyle: '表达自然\n保留换行与中文，避免冗长',
    behaviorStyle: '尊重隐私，遇到不确定的信息先核实',
  },
};
export function astrBotPersona(count: number): Extract<PersonaContent, { platform: 'astrbot' }> {
  return {
    platform: 'astrbot',
    content: {
      systemPrompt: specialText.trim(),
      dialoguePairs: Array.from({ length: count }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        user: `${index + 1} 用户 ${specialText}`,
        assistant: `${index + 1} 助手 ${specialText}`,
      })),
    },
  };
}
