const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeZone: 'Asia/Shanghai' });
export function announcementDate(value: string) {
  return date.format(new Date(value));
}
export function AnnouncementBody({ body }: { body: string }) {
  return (
    <div className="min-w-0 whitespace-pre-wrap text-base leading-8 [overflow-wrap:anywhere]">
      {body}
    </div>
  );
}
