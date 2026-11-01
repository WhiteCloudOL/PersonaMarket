'use client';
import { useEffect, useRef, useEffectEvent } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
export default function MarkdownInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | undefined>(undefined);
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
              color: 'var(--foreground)',
              backgroundColor: 'var(--background)',
            },
            '.cm-content': { fontFamily: 'var(--font-sans)', padding: '1rem 0' },
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
    return () => {
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
  return <div ref={host} className="min-w-0 overflow-hidden rounded-lg border border-input" />;
}
