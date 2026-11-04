'use client';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import {
  createPublicSnapshotSchema,
  PersonaDraftSchema,
  publicSnapshotCandidate,
  defaultContentLimits,
  type ContentLimits,
  type PersonaDraft,
} from '@personamarket/contracts';
import { CheckCircle2Icon, CircleIcon, ArrowUpRightIcon, ChevronDownIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { EditorSection } from './editor-section';

export function navigateToDraftField(anchor: string, path?: string) {
  const exact =
    path === 'rightsAccepted'
      ? document.getElementById('rights-accepted')
      : path
        ? document.getElementById('draft-' + path.replaceAll('.', '-'))
        : null;
  const target = exact ?? document.getElementById(anchor);
  target?.scrollIntoView({ block: 'center', behavior: 'auto' });
  if (target instanceof HTMLElement) {
    const control = target.matches('input,textarea,button,[role=textbox]')
      ? target
      : target.querySelector<HTMLElement>('input,textarea,button,[role=textbox]');
    control?.focus({ preventScroll: true });
  }
}
export function DraftChecks({
  limits = defaultContentLimits,
  title = '内容检查',
  onNavigate = navigateToDraftField,
  children,
}: {
  limits?: ContentLimits;
  title?: string;
  onNavigate?: (anchor: string, path?: string) => void;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const form = useFormContext<PersonaDraft>();
  const value = useDeferredValue(useWatch({ control: form.control }));
  const schema = useMemo(() => createPublicSnapshotSchema(limits), [limits]);
  const issues = useMemo(() => {
    const draft = PersonaDraftSchema.safeParse(value);
    if (!draft.success) return draft.error.issues.map((issue) => issue.path.map(String).join('.'));
    const publication = schema.safeParse(publicSnapshotCandidate(draft.data));
    return [
      ...(publication.success
        ? []
        : publication.error.issues.map((issue) => issue.path.map(String).join('.'))),
      ...(draft.data.rightsAccepted ? [] : ['rightsAccepted']),
    ];
  }, [schema, value]);
  const groups = [
    {
      label: '作品名称与简介',
      anchor: 'basic-information',
      fields: ['title', 'summary', 'categoryId', 'tagIds', 'customTags'],
    },
    { label: '平台正文与对话', anchor: 'persona-content', fields: ['content'] },
    { label: '推荐模型', anchor: 'recommended-models', fields: ['recommendedModels'] },
    { label: '作者、来源与许可', anchor: 'persona-origin', fields: ['origin', 'authorNotes'] },
    { label: '展示与复制下载授权', anchor: 'persona-origin', fields: ['rightsAccepted'] },
    { label: 'README', anchor: 'persona-readme', fields: ['readmeMarkdown'] },
  ].map((group) => ({
    ...group,
    problem: issues.find((path) =>
      group.fields.some((field) => path === field || path.startsWith(field + '.')),
    ),
  }));
  const pending = groups.filter((group) => group.problem !== undefined).length;
  const firstProblem = groups.find((group) => group.problem !== undefined);
  return (
    <EditorSection
      title={title}
      description={
        pending
          ? `还有 ${pending} 项待完善，未填完也可以先存草稿`
          : '填写检查已通过，可以保存后准备版本'
      }
    >
      <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap gap-2">
          {firstProblem && (
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              onClick={() => onNavigate(firstProblem.anchor, firstProblem.problem)}
            >
              定位首个问题
            </Button>
          )}
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-11 max-w-full whitespace-normal"
              />
            }
          >
            {expanded ? '收起检查清单' : '查看全部检查'}
            <ChevronDownIcon aria-hidden data-icon="inline-end" />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="-mx-2 flex flex-col gap-1">
            {groups.map((group) => (
              <Button
                key={group.label}
                type="button"
                variant="ghost"
                className="h-auto min-h-11 w-full justify-start px-2 text-left whitespace-normal"
                onClick={() => onNavigate(group.anchor, group.problem)}
              >
                {group.problem === undefined ? (
                  <CheckCircle2Icon className="shrink-0 text-primary" aria-hidden />
                ) : (
                  <CircleIcon className="shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">{group.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {group.problem === undefined ? '已就绪' : '去完善'}
                </span>
                <ArrowUpRightIcon className="size-3 shrink-0" aria-hidden />
              </Button>
            ))}
          </div>
          {children && <div className="mt-4 flex flex-col gap-2 border-t pt-4">{children}</div>}
        </CollapsibleContent>
      </Collapsible>
    </EditorSection>
  );
}
