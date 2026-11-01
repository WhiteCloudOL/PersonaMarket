import { describe, expect, it } from 'vitest';
import {
  ProfileContentSchema,
  ProfileLinkSchema,
  PublicCreatorSchema,
  ReviewProfileSchema,
  SaveProfileSchema,
  SubmitProfileSchema,
  SetProfileVisibilitySchema,
} from '@personamarket/contracts';

const fields = {
  displayName: '云间创作者',
  bio: '在这里记录灵感\n保留作者原文 ',
  avatarAssetId: null,
  links: [{ label: '个人网站', url: 'https://creator.example.invalid/about' }],
};

describe('个人资料快照契约', () => {
  it('资料链接在字符限额内仍须满足持久化字节预算，拒绝不完整Unicode字符', () => {
    const links = Array.from({ length: 5 }, (_, index) => ({
      label: '个人网站',
      url: 'https://example.invalid/' + '界'.repeat(1900) + index,
    }));
    expect(ProfileContentSchema.safeParse({ ...fields, links }).success).toBe(false);
    for (const value of [
      { ...fields, displayName: '作者\uD800' },
      { ...fields, bio: '简介\uD800' },
      { ...fields, links: [{ label: '网站\uD800', url: 'https://example.invalid' }] },
    ])
      expect(ProfileContentSchema.safeParse(value).success).toBe(false);
  });
  it('按Unicode code point限制资料长度，不裁剪或改写简介', () => {
    const input = { ...fields, displayName: '🌿'.repeat(60), bio: '🌿'.repeat(1000) };
    expect(ProfileContentSchema.parse(input)).toEqual(input);
    expect(ProfileContentSchema.safeParse({ ...input, displayName: '🌿'.repeat(61) }).success).toBe(
      false,
    );
    expect(ProfileContentSchema.safeParse({ ...input, bio: '🌿'.repeat(1001) }).success).toBe(
      false,
    );
    expect(ProfileContentSchema.parse(fields).bio).toBe(fields.bio);
  });

  it('显示名和标签为明确单行，简介允许正常换行但拒绝不可见控制字符', () => {
    for (const displayName of [' ', ' 作者', '作者\n名字', '作者\u0000'])
      expect(ProfileContentSchema.safeParse({ ...fields, displayName }).success).toBe(false);
    expect(ProfileContentSchema.safeParse({ ...fields, bio: '正文\u0000' }).success).toBe(false);
    expect(
      ProfileLinkSchema.safeParse({ label: '站点\n说明', url: fields.links[0]?.url }).success,
    ).toBe(false);
  });

  it('公开链接只允许无凭据的HTTP(S)，拒绝脚本、控制字符和歧义地址', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,test',
      '//example.invalid',
      'file:///etc/passwd',
      'https://user:password@example.invalid',
      'https://example.invalid/a b',
      'https://example.invalid/\npath',
      'https://example.invalid/\\path',
    ])
      expect(ProfileLinkSchema.safeParse({ label: '公开链接', url }).success, url).toBe(false);
    for (const url of ['https://example.invalid/path?a=1#intro', 'http://example.invalid/'])
      expect(ProfileLinkSchema.parse({ label: '公开链接', url }).url).toBe(url);
  });

  it('公开链接限五条，规范化相同地址不能重复', () => {
    expect(
      ProfileContentSchema.safeParse({
        ...fields,
        links: Array.from({ length: 6 }, (_, index) => ({
          label: '站点',
          url: 'https://example.invalid/' + index,
        })),
      }).success,
    ).toBe(false);
    expect(
      ProfileContentSchema.safeParse({
        ...fields,
        links: [
          { label: '一', url: 'https://EXAMPLE.invalid' },
          { label: '二', url: 'https://example.invalid/' },
        ],
      }).success,
    ).toBe(false);
  });

  it('头像只能是受控素材ID，资料保存不能附带所有者、角色或审核状态', () => {
    expect(
      ProfileContentSchema.safeParse({
        ...fields,
        avatarAssetId: 'https://example.invalid/avatar.png',
      }).success,
    ).toBe(false);
    expect(SaveProfileSchema.parse({ content: fields, expectedRevision: 0 }).expectedRevision).toBe(
      0,
    );
    for (const property of ['userId', 'ownerId', 'role', 'status', 'publishedSubmissionId'])
      expect(
        SaveProfileSchema.safeParse({ content: fields, expectedRevision: 1, [property]: 'forged' })
          .success,
      ).toBe(false);
    expect(
      ProfileContentSchema.safeParse({ ...fields, email: 'private@example.invalid' }).success,
    ).toBe(false);
  });

  it('保存、提交、审核和下架各自要求实际修订与确认条件', () => {
    expect(SaveProfileSchema.safeParse({ content: fields, expectedRevision: -1 }).success).toBe(
      false,
    );
    expect(
      SubmitProfileSchema.safeParse({ expectedDraftRevision: 0, confirmed: true }).success,
    ).toBe(false);
    expect(
      SubmitProfileSchema.safeParse({ expectedDraftRevision: 1, confirmed: false }).success,
    ).toBe(false);
    expect(
      ReviewProfileSchema.safeParse({ decision: 'reject', expectedRevision: 1, reason: ' ' })
        .success,
    ).toBe(false);
    expect(
      ReviewProfileSchema.safeParse({ decision: 'approve', expectedRevision: 1 }).success,
    ).toBe(true);
    expect(
      SetProfileVisibilitySchema.safeParse({ hidden: true, expectedRevision: 1, reason: '' })
        .success,
    ).toBe(false);
  });

  it('公开DTO拒绝邮箱、待审快照和认证字段，也不能返回任意外部头像URL', () => {
    const creator = {
      id: '3155c83d-9965-4cf1-8ec6-54ff68dabdb7',
      username: 'creator',
      displayName: fields.displayName,
      bio: fields.bio,
      links: fields.links,
      avatarUrl: null,
      approvedRevisionId: null,
      updatedAt: null,
    };
    expect(PublicCreatorSchema.parse(creator)).toEqual(creator);
    for (const property of ['email', 'passwordHash', 'mfaEnabled', 'latestSubmission', 'draft'])
      expect(PublicCreatorSchema.safeParse({ ...creator, [property]: 'private' }).success).toBe(
        false,
      );
    expect(
      PublicCreatorSchema.safeParse({
        ...creator,
        avatarUrl: 'https://example.invalid/private.png',
      }).success,
    ).toBe(false);
    expect(
      PublicCreatorSchema.safeParse({
        ...creator,
        avatarUrl: '/api/v1/users/creator/avatar/' + '-'.repeat(36),
      }).success,
    ).toBe(false);
  });
});
