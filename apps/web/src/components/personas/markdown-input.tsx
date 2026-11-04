'use client';
import { useEffect, useRef, useEffectEvent, useState } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
} from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { ReadmeImages } from './readme-images';

const setImagePosition = StateEffect.define<number | null>();
const imagePosition = StateField.define<number | null>({
  create: () => null,
  update(previous, transaction) {
    let position = previous === null ? null : transaction.changes.mapPos(previous, 1);
    for (const effect of transaction.effects) {
      if (effect.is(setImagePosition)) position = effect.value;
    }
    return position;
  },
});

function prefixLines(view: EditorView, prefix: string | ((line: number) => string)) {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to > from ? to - 1 : to).number;
  const changes = [];
  for (let number = first; number <= last; number++) {
    const line = doc.line(number);
    const marker = typeof prefix === 'string' ? prefix : prefix(number - first + 1);
    const heading = marker.startsWith('#') ? /^#{1,6}\s+/.exec(line.text)?.[0] : undefined;
    changes.push({ from: line.from, to: line.from + (heading?.length ?? 0), insert: marker });
  }
  view.dispatch({ changes, annotations: isolateHistory.of('full'), userEvent: 'input' });
  view.focus();
}

function wrap(view: EditorView, before: string, after: string) {
  const { from, to } = view.state.selection.main;
  const content = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: before + content + after },
    selection: { anchor: from + before.length, head: to + before.length },
    annotations: isolateHistory.of('full'),
    userEvent: 'input',
  });
  view.focus();
}

function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to) || '链接文字';
  const urlStart = from + text.length + 3;
  view.dispatch({
    changes: { from, to, insert: `[${text}](https://)` },
    selection: { anchor: urlStart, head: urlStart + 'https://'.length },
    annotations: isolateHistory.of('full'),
    userEvent: 'input',
  });
  view.focus();
}

const formats = [
  { label: '二级标题', Icon: Heading2Icon, apply: (view: EditorView) => prefixLines(view, '## ') },
  { label: '三级标题', Icon: Heading3Icon, apply: (view: EditorView) => prefixLines(view, '### ') },
  { label: '加粗', Icon: BoldIcon, apply: (view: EditorView) => wrap(view, '**', '**') },
  { label: '斜体', Icon: ItalicIcon, apply: (view: EditorView) => wrap(view, '*', '*') },
  { label: '无序列表', Icon: ListIcon, apply: (view: EditorView) => prefixLines(view, '- ') },
  {
    label: '编号列表',
    Icon: ListOrderedIcon,
    apply: (view: EditorView) => prefixLines(view, (line) => `${line}. `),
  },
  { label: '引用', Icon: QuoteIcon, apply: (view: EditorView) => prefixLines(view, '> ') },
  {
    label: '代码块',
    Icon: CodeIcon,
    apply: (view: EditorView) => wrap(view, '\n```\n', '\n```\n'),
  },
  { label: '链接', Icon: LinkIcon, apply: insertLink },
];

export default function MarkdownInput({
  value,
  onChange,
  active,
}: {
  value: string;
  onChange: (value: string) => void;
  active: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const initialValue = useRef(value);
  const documentChanged = useEffectEvent(onChange);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          markdown(),
          history(),
          imagePosition,
          lineNumbers(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown 介绍',
            role: 'textbox',
            'aria-multiline': 'true',
            spellcheck: 'false',
          }),
          placeholder('写下使用说明，支持 Markdown…'),
          EditorView.theme({
            '&': {
              minHeight: '18rem',
              maxHeight: 'min(35rem, 70dvh)',
              color: 'var(--foreground)',
              backgroundColor: 'var(--background)',
            },
            '.cm-content': { fontFamily: 'var(--font-sans)', padding: '1rem 0', fontSize: '1rem' },
            '.cm-gutters': {
              backgroundColor: 'var(--muted)',
              color: 'var(--muted-foreground)',
              border: 'none',
            },
            '.cm-scroller': { overflow: 'auto' },
            '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
            '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
            '.cm-selectionBackground': { backgroundColor: 'var(--accent)' },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) documentChanged(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    const mounted = requestAnimationFrame(() => setReady(true));
    return () => {
      cancelAnimationFrame(mounted);
      editor.current = undefined;
      view.destroy();
    };
    // 外部更新通过下面的 effect 同步，编辑器实例不因每次按键重建。
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && value !== view.state.doc.toString())
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);
  function rememberCursor(point?: { x: number; y: number }) {
    const view = editor.current;
    if (!view) return;
    const position = (point && view.posAtCoords(point)) ?? view.state.selection.main.to;
    view.dispatch({ effects: setImagePosition.of(position) });
  }

  function insertImage(id: string) {
    const view = editor.current;
    if (!view) return;
    const position = view.state.field(imagePosition);
    if (position === null) return;
    const doc = view.state.doc;
    const before =
      position && doc.sliceString(Math.max(0, position - 2), position) !== '\n\n' ? '\n\n' : '';
    const after =
      position < doc.length && doc.sliceString(position, position + 2) !== '\n\n' ? '\n\n' : '';
    const insert = before + `![图片](asset://${id})` + after;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: position, insert },
      effects: setImagePosition.of(null),
      annotations: isolateHistory.of('full'),
      ...(selection.empty && selection.head === position
        ? { selection: { anchor: position + insert.length } }
        : {}),
      userEvent: 'input',
    });
    if (active && container.current?.contains(document.activeElement)) view.focus();
  }

  return (
    <div ref={container} className="flex min-w-0 flex-col gap-3">
      <div
        role="group"
        aria-label="Markdown 格式"
        className="flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1"
      >
        {formats.map(({ label, Icon, apply }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            disabled={!ready}
            onClick={() => {
              const view = editor.current;
              if (view) apply(view);
            }}
          >
            <Icon aria-hidden />
          </Button>
        ))}
      </div>
      <ReadmeImages ready={ready} rememberCursor={rememberCursor} insertImage={insertImage}>
        <div ref={host} className="min-w-0 overflow-hidden rounded-lg border border-input" />
      </ReadmeImages>
    </div>
  );
}
