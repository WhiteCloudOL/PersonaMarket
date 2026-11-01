import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseAstrBot,
  parseMaiBot,
  serializeAstrBot,
  serializeMaiBot,
  nativeExportWarnings,
} from '@personamarket/persona-adapters';
import { astrBotPersona, maiBotPersona } from '../fixtures/native-personas.js';
const bytes = (value: string) => new TextEncoder().encode(value);

describe('原生平台白名单适配', () => {
  it('解析官方配置库和 WebUI 实际导出的脱敏 fixture', () => {
    expect(
      parseMaiBot(readFileSync(new URL('../fixtures/native/maibot-v1.3.15.toml', import.meta.url)))
        .persona,
    ).toEqual(maiBotPersona);
    const astr = parseAstrBot(
      readFileSync(new URL('../fixtures/native/astrbot-v4.29.3.json', import.meta.url)),
      randomUUID,
    ).persona;
    expect(astr.platform).toBe('astrbot');
    if (astr.platform !== 'astrbot') throw new Error('错误的平台');
    expect(astr.content.systemPrompt).toBe(astrBotPersona(1).content.systemPrompt);
    expect(astr.content.dialoguePairs.map(({ user, assistant }) => [user, assistant])).toEqual(
      astrBotPersona(1).content.dialoguePairs.map(({ user, assistant }) => [user, assistant]),
    );
  });
  it('AstrBot 首尾空白风险可预览，序列化仍保留原文', () => {
    const persona = astrBotPersona(0);
    persona.content.systemPrompt = '  正文\n末行  ';
    expect(nativeExportWarnings(persona)).toContain(
      '目标 AstrBot 创建人格时会移除人格设定的首尾空白，请核对导入结果',
    );
    expect(JSON.parse(serializeAstrBot(persona, 'whitespace')).system_prompt).toBe(
      persona.content.systemPrompt,
    );
  });
  it('MaiBot TOML 保留中文、多行、引号、空白与控制字符', () => {
    expect(parseMaiBot(bytes(serializeMaiBot(maiBotPersona))).persona).toEqual(maiBotPersona);
  });
  it('整份 MaiBot 配置只保留三项，不带出账号与密钥', () => {
    const file = serializeMaiBot(maiBotPersona) + '\n[model]\napi_key = "synthetic-secret"\n';
    const result = parseMaiBot(bytes(file));
    expect(result.ignoredFields).toEqual(['model']);
    expect(result.warnings).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(result.persona).toEqual(maiBotPersona);
  });
  for (const count of [0, 1, 20, 100])
    it(`AstrBot ${count} 对对话往返保持顺序与正文`, () => {
      const persona = astrBotPersona(count);
      const file = serializeAstrBot(persona, `native-${count}`);
      const imported = parseAstrBot(bytes(file), randomUUID);
      expect(imported.persona.platform).toBe('astrbot');
      if (imported.persona.platform !== 'astrbot') throw new Error('错误的平台');
      expect(imported.persona.content.systemPrompt).toBe(persona.content.systemPrompt);
      expect(
        imported.persona.content.dialoguePairs.map(({ user, assistant }) => [user, assistant]),
      ).toEqual(persona.content.dialoguePairs.map(({ user, assistant }) => [user, assistant]));
      expect(Object.keys(JSON.parse(file))).toEqual([
        'persona_id',
        'system_prompt',
        'begin_dialogs',
      ]);
      expect(imported.warnings[0]).toContain('目标平台');
    });
  it('AstrBot 拒绝奇数消息、对象消息、错误外层结构与超限，不静默截断', () => {
    for (const value of [
      [],
      { system_prompt: '正文', begin_dialogs: ['尾项'] },
      { system_prompt: '正文', begin_dialogs: [{ role: 'user', content: '文本' }, '回复'] },
      { system_prompt: '正文', format: 'personamarket' },
      { system_prompt: '正文', begin_dialogs: Array.from({ length: 202 }, () => '内容') },
    ])
      expect(() => parseAstrBot(bytes(JSON.stringify(value)), randomUUID)).toThrow();
  });
  it('AstrBot 能力配置被丢弃，空对话合法但单侧空白失败', () => {
    const imported = parseAstrBot(
      bytes('{"system_prompt":"正文","tools":["danger"],"skills":["run"],"begin_dialogs":null}'),
      randomUUID,
    );
    expect(imported.ignoredFields).toEqual(['tools', 'skills']);
    expect(JSON.stringify(imported.persona)).not.toMatch(/danger|run/);
    expect(() =>
      parseAstrBot(bytes('{"system_prompt":"正文","begin_dialogs":[" ","答"]}'), randomUUID),
    ).toThrow();
  });
});
