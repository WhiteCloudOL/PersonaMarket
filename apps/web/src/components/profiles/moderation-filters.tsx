'use client';
import { useState } from 'react';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldGroup, FieldLabel } from '@personamarket/ui/components/field';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { ReportSelect } from '../reports/select';
import { profileStatuses } from './content';

export function ProfileModerationFilters({
  initial,
  apply,
}: {
  initial: { username: string; status: string };
  apply: (filters: { username: string; status: string }) => void;
}) {
  const [username, setUsername] = useState(initial.username);
  const [status, setStatus] = useState(initial.status);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>查找待审资料</h2>
        </CardTitle>
        <CardDescription>默认查看等待审核的快照，按完整用户名核对作者</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply({ username, status });
          }}
        >
          <FieldGroup className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field>
              <FieldLabel htmlFor="profile-status">审核状态</FieldLabel>
              <ReportSelect
                id="profile-status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: '全部状态' },
                  ...Object.entries(profileStatuses).map(([value, label]) => ({ value, label })),
                ]}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-owner">完整用户名</FieldLabel>
              <Input
                id="profile-owner"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Button type="submit">查找资料</Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
