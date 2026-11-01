import { SafeMarkdown } from '../personas/safe-markdown';

export function GuideBody({ text }: { text: string }) {
  return (
    <SafeMarkdown
      text={text}
      imageBase="/api/v1/public/assets"
      headingMode="section"
      className="text-base leading-8 [overflow-wrap:anywhere] [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm [&_ol]:flex [&_ol]:list-outside [&_ol]:flex-col [&_ol]:gap-3 [&_ol]:pl-6 [&_ul]:flex [&_ul]:list-outside [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6"
    />
  );
}
