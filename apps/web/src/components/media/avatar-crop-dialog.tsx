'use client';
import Image from 'next/image';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@personamarket/ui/components/sheet';
import { FormNotice } from '../auth/auth-fields';

const center = { x: 0.5, y: 0.5 };
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function AvatarCropDialog({
  file,
  description,
  returnFocus,
  onUpload,
  onClosed,
}: {
  file: File;
  description: string;
  returnFocus: RefObject<HTMLInputElement | null>;
  onUpload: (file: File) => Promise<unknown>;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const [image, setImage] = useState<HTMLImageElement>();
  const [error, setError] = useState<Error>();
  const [pending, setPending] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState(center);
  const submitting = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number }>(undefined);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const source = new window.Image();
    source.onload = () => {
      if (
        !source.naturalWidth ||
        !source.naturalHeight ||
        source.naturalWidth * source.naturalHeight > 40000000
      ) {
        setError(new Error('请选择 4000 万像素以内的静态图片'));
        return;
      }
      setImage(source);
    };
    source.onerror = () => setError(new Error('无法读取图片，请选择 JPEG、PNG 或 WebP 图片'));
    source.src = url;
    return () => {
      source.onload = null;
      source.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const width = image?.naturalWidth ?? 0;
  const height = image?.naturalHeight ?? 0;
  const side = Math.min(width, height) / zoom;
  const x = (width - side) * position.x;
  const y = (height - side) * position.y;

  async function confirm() {
    if (!image || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.max(1, Math.min(512, Math.floor(side)));
      const context = canvas.getContext('2d');
      if (!context) throw Error('暂时无法裁切图片，请重试');
      context.drawImage(image, x, y, side, side, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.95),
      );
      if (!blob) throw Error('暂时无法生成裁切图片，请重试');
      const name = blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.png';
      await onUpload(new File([blob], name, { type: blob.type }));
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('头像上传失败，请重试'));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next, details) => {
        if (submitting.current) details.cancel();
        else setOpen(next);
      }}
      onOpenChangeComplete={(visible) => {
        if (!visible) onClosed();
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[calc(100dvh-1rem)] gap-0 rounded-t-2xl motion-reduce:transition-none sm:inset-0 sm:m-auto sm:w-[min(28rem,90vw)] sm:rounded-2xl sm:border sm:data-[side=bottom]:h-fit"
        finalFocus={returnFocus}
        showCloseButton={!pending}
      >
        <SheetHeader>
          <SheetTitle>裁切头像</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {image ? (
            <>
              <div
                role="group"
                aria-label="头像裁切预览"
                aria-describedby={id + '-help'}
                tabIndex={0}
                className="relative mx-auto aspect-square w-full max-w-64 touch-none cursor-grab overflow-hidden rounded-xl border bg-muted select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                onPointerDown={(event) => {
                  if (pending || event.button !== 0) return;
                  drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const last = drag.current;
                  if (!last || last.id !== event.pointerId || pending) return;
                  const scale = side / event.currentTarget.clientWidth;
                  const dx = (last.x - event.clientX) * scale;
                  const dy = (last.y - event.clientY) * scale;
                  setPosition((value) => ({
                    x: width > side ? clamp(value.x + dx / (width - side)) : value.x,
                    y: height > side ? clamp(value.y + dy / (height - side)) : value.y,
                  }));
                  drag.current = { id: last.id, x: event.clientX, y: event.clientY };
                }}
                onLostPointerCapture={() => {
                  drag.current = undefined;
                }}
                onKeyDown={(event) => {
                  if (pending) return;
                  const dx =
                    event.key === 'ArrowLeft' ? -0.1 : event.key === 'ArrowRight' ? 0.1 : 0;
                  const dy = event.key === 'ArrowUp' ? -0.1 : event.key === 'ArrowDown' ? 0.1 : 0;
                  if (dx || dy) {
                    event.preventDefault();
                    setPosition((value) => ({
                      x: clamp(value.x + dx),
                      y: clamp(value.y + dy),
                    }));
                  } else if (event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    setPosition(event.key === 'Home' ? center : { x: 1, y: 1 });
                  }
                }}
              >
                <Image
                  src={image.src}
                  alt=""
                  width={width}
                  height={height}
                  unoptimized
                  draggable={false}
                  className="pointer-events-none absolute max-w-none"
                  style={{
                    width: (width / side) * 100 + '%',
                    height: (height / side) * 100 + '%',
                    left: (-x / side) * 100 + '%',
                    top: (-y / side) * 100 + '%',
                  }}
                />
              </div>
              <p id={id + '-help'} className="text-sm text-muted-foreground">
                拖动图片或用方向键移动位置，Home 居中，End 移到右下角
              </p>
              <Field>
                <FieldLabel htmlFor={id + '-zoom'}>缩放</FieldLabel>
                <Input
                  id={id + '-zoom'}
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  disabled={pending}
                  className="border-0 p-0 accent-primary"
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </Field>
            </>
          ) : !error ? (
            <p role="status">正在读取图片…</p>
          ) : null}
          <FormNotice error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button type="button" disabled={!image || pending} onClick={() => void confirm()}>
              {pending ? '正在上传…' : '使用裁切头像'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
