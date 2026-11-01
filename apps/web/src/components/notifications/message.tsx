'use client';
import { useState } from 'react';
import { Button } from '@personamarket/ui/components/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';

export function NotificationMessage({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const characters = Array.from(message);
  const textClass = 'text-base leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]';
  if (characters.length <= 280 && message.split('\n').length <= 8)
    return <p className={textClass}>{message}</p>;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      {!open && (
        <p className={textClass}>
          {characters.slice(0, 220).join('').split('\n').slice(0, 6).join('\n')}…
        </p>
      )}
      <CollapsibleContent>
        <p className={textClass}>{message}</p>
      </CollapsibleContent>
      <CollapsibleTrigger render={<Button variant="ghost" />} className="mt-2">
        {open ? '收起通知正文' : '展开完整通知'}
      </CollapsibleTrigger>
    </Collapsible>
  );
}
