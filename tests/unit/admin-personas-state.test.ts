import { expect, it } from 'vitest';
import { retainsPersonaPanelDraft } from '../../apps/web/src/lib/admin-personas-state.js';

const current = new URL(
  'https://fixture.invalid/admin/personas?personaId=first&q=kept&recordsPage=1',
);
it('同作品的管理视图和记录页码可以保留输入', () => {
  const target = new URL(current);
  target.searchParams.set('recordsPage', '2');
  target.searchParams.set('personaView', 'records');
  expect(retainsPersonaPanelDraft(target, current)).toBe(true);
});
it('跨站、跨页面、换作品或筛选变化不能绕过未保存提醒', () => {
  for (const value of [
    'https://other.invalid/admin/personas?personaId=first&q=kept',
    '/admin/users?personaId=first&q=kept',
    '?personaId=second&q=kept',
    '?personaId=first&q=changed',
    '?q=kept',
    '?personaId=first&q=kept&q=unexpected',
  ])
    expect(retainsPersonaPanelDraft(new URL(value, current), current)).toBe(false);
});
