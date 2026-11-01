'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import {
  PersonaDraftSchema,
  canonicalJson,
  type PersonaDraft,
  type DraftResponse,
} from '@personamarket/contracts';
import { personasApi } from '@/lib/personas-api';

/** 同一编辑器只保留最新待存值；保存串行，失败保留内存，不自动覆盖冲突。 */
export function useDraftSave(initial: DraftResponse, form: UseFormReturn<PersonaDraft>) {
  const saved = useRef({
    revision: initial.meta.revision,
    json: canonicalJson(initial.data.draft),
  });
  const pending = useRef<Promise<number> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const dirty = useCallback(() => canonicalJson(form.getValues()) !== saved.current.json, [form]);
  const flush = useCallback(async (): Promise<number> => {
    clearTimeout(timer.current);
    if (pending.current) return pending.current;
    const operation = async () => {
      try {
        while (dirty()) {
          const parsed = PersonaDraftSchema.safeParse(form.getValues());
          if (!parsed.success) {
            await form.trigger();
            throw new Error('请修正超出草稿安全范围的字段后重试');
          }
          const json = canonicalJson(parsed.data);
          if (alive.current) {
            setState('saving');
            setError('');
          }
          const response = await personasApi.save(
            initial.data.id,
            parsed.data,
            saved.current.revision,
          );
          saved.current = { revision: response.meta.revision, json };
        }
        if (alive.current) setState('saved');
        return saved.current.revision;
      } catch (cause) {
        if (alive.current) {
          setState('error');
          setError(cause instanceof Error ? cause.message : '保存失败，请重试');
        }
        throw cause;
      }
    };
    pending.current = operation().finally(() => {
      pending.current = undefined;
    });
    return pending.current;
  }, [dirty, form, initial.data.id]);
  useEffect(() => {
    alive.current = true;
    const subscription = form.watch(() => {
      if (!dirty()) return;
      setState('dirty');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush().catch(() => undefined);
      }, 800);
    });
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (
        !anchor ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        anchor.target === '_blank' ||
        anchor.download ||
        !dirty()
      )
        return;
      const url = new URL(anchor.href, location.href);
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (!window.confirm('还有未保存的草稿，确定离开吗')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      subscription.unsubscribe();
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, flush, form]);
  return { state, error, flush, dirty, revision: () => saved.current.revision };
}
