import { sql } from 'drizzle-orm';
import { releaseSubmissions } from '@personamarket/database';

// 探索与榜单共用卡片白名单，不把正文、README或完整来源资料带入列表
export const publicCardSnapshot = sql<unknown>`jsonb_strip_nulls(jsonb_build_object(
  'title',${releaseSubmissions.snapshot}->'title',
  'summary',${releaseSubmissions.snapshot}->'summary',
  'categoryId',${releaseSubmissions.snapshot}->'categoryId',
  'tagIds',${releaseSubmissions.snapshot}->'tagIds',
  'avatarAssetId',${releaseSubmissions.snapshot}->'avatarAssetId',
  'coverAssetId',${releaseSubmissions.snapshot}->'coverAssetId',
  'platform',${releaseSubmissions.snapshot}->'platform',
  'origin',jsonb_build_object(
    'type',${releaseSubmissions.snapshot}->'origin'->'type',
    'redistribution',${releaseSubmissions.snapshot}->'origin'->'redistribution'
  )))`.as('snapshot');
