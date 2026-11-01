'use client';
import { useState } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@personamarket/ui/components/dropdown-menu';
import type { ThemePreference } from '@/lib/theme-preference';

const preferences = [
  { value: 'system', label: '跟随系统', Icon: MonitorIcon },
  { value: 'light', label: '浅色', Icon: SunIcon },
  { value: 'dark', label: '深色', Icon: MoonIcon },
] as const;

export function ThemeToggle({ initialTheme }: { initialTheme: ThemePreference }) {
  const [theme, setTheme] = useState(initialTheme);
  const selected = preferences.find((item) => item.value === theme) ?? preferences[0];
  const CurrentIcon = selected.Icon;
  function change(value: unknown) {
    if (value !== 'system' && value !== 'light' && value !== 'dark') return;
    document.documentElement.classList.remove('system', 'light', 'dark');
    document.documentElement.classList.add(value);
    document.cookie = `theme=${value}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === 'https:' ? '; Secure' : ''}`;
    setTheme(value);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={'主题偏好：' + selected.label}
        title={'主题偏好：' + selected.label}
      >
        <CurrentIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="主题偏好"
        className="w-44 max-w-[calc(100vw-1rem)] overscroll-contain"
      >
        <DropdownMenuRadioGroup value={theme} onValueChange={change}>
          <DropdownMenuLabel>主题偏好</DropdownMenuLabel>
          {preferences.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              closeOnClick
              className="min-h-11 min-w-11"
            >
              <Icon aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
