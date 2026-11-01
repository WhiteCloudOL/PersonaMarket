import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { FieldGroup } from '@personamarket/ui/components/field';
import { cn } from '@personamarket/ui/lib/utils';
export function EditorSection({
  title,
  description,
  children,
  step,
  id,
  className,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  step?: string;
  id?: string;
  className?: string;
}) {
  return (
    <Card id={id} className={cn('shrink-0 scroll-mt-44', className)}>
      <CardHeader className={step ? 'flex flex-wrap items-center gap-x-3 gap-y-2' : undefined}>
        <CardTitle className="flex min-w-0 items-center gap-3 text-base break-words sm:text-lg">
          {step && (
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs text-primary"
            >
              {step}
            </span>
          )}
          <h2 className="min-w-0 break-words">{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>{children}</FieldGroup>
      </CardContent>
    </Card>
  );
}
