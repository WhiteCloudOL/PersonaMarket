'use client';
import { CopyIcon, Share2Icon } from 'lucide-react';
import { CopyTextButton } from '../copy-text-button';
import { releasesApi } from '@/lib/releases-api';
export { ExportPersonaButton } from './export-persona-button';
export type CopyScope = { id: string; releaseId: string };
type CopyPart =
  | 'personality'
  | 'replyStyle'
  | 'behaviorStyle'
  | 'systemPrompt'
  | 'dialogues'
  | `pair:${string}`
  | 'all'
  | 'link';
async function readPersonaText(scope: CopyScope, part: CopyPart) {
  // 复制前重新授权，页面打开后下架仍应阻止后续的复制请求
  if (part === 'all')
    return (await releasesApi.exportPreview(scope.id, scope.releaseId, 'text')).data.text;
  const { data } = await releasesApi.release(scope.id, scope.releaseId);
  if (part === 'link')
    return new URL('/personas/' + scope.id + '/releases/' + scope.releaseId, window.location.origin)
      .href;
  if (
    data.snapshot.platform === 'maibot' &&
    (part === 'personality' || part === 'replyStyle' || part === 'behaviorStyle')
  )
    return data.snapshot.content[part];
  if (data.snapshot.platform === 'astrbot') {
    const { systemPrompt, dialoguePairs } = data.snapshot.content;
    if (part === 'systemPrompt') return systemPrompt;
    if (part === 'dialogues')
      return dialoguePairs
        .map((pair) => '用户：' + pair.user + '\nAI：' + pair.assistant)
        .join('\n\n');
    const pair = dialoguePairs.find((item) => 'pair:' + item.id === part);
    if (pair) return '用户：' + pair.user + '\nAI：' + pair.assistant;
  }
  throw new Error('该内容已不可用，请刷新页面');
}
export function CopyPersonaButton({
  scope,
  part,
  label = '复制',
  primary = false,
}: {
  scope: CopyScope;
  part: CopyPart;
  label?: string;
  primary?: boolean;
}) {
  return (
    <CopyTextButton
      label={label}
      primary={primary}
      icon={part === 'link' ? Share2Icon : CopyIcon}
      readText={() => readPersonaText(scope, part)}
    />
  );
}
