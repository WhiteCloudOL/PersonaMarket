'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { buttonVariants } from '@personamarket/ui/components/button';
import { notificationHref } from './delivery-state';

/** 列表只定位业务对象；写命令只在唯一的精确详情控制器中执行。 */
export function RetryDelivery({ entry }: { entry: { id: string } }) {
  const search = useSearchParams(),
    pathname = usePathname();
  return (
    <Link
      href={notificationHref(pathname, search.toString(), { deliveryId: entry.id })}
      scroll={false}
      className={buttonVariants({
        variant: 'outline',
        className: 'h-auto min-h-11 whitespace-normal text-center',
      })}
      data-delivery-id={entry.id}
    >
      核对投递
    </Link>
  );
}
