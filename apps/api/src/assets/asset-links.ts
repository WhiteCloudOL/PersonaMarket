import { and, eq, inArray } from 'drizzle-orm';
import { assets, assetReferences } from '@personamarket/database';
import { BusinessError, markdownImages } from '@personamarket/server';
import type { PersonaDraft } from '@personamarket/contracts';
import type { Transaction } from '../auth/locked-identity.js';
export function draftAssetIds(payload: PersonaDraft) {
  return {
    content: [
      ...new Set([
        ...markdownImages(payload.readmeMarkdown).ids,
        ...(payload.avatarAssetId ? [payload.avatarAssetId] : []),
        ...(payload.coverAssetId ? [payload.coverAssetId] : []),
      ]),
    ],
    evidence: [...new Set(payload.evidenceAssetIds)],
  };
}
export async function validateDraftAssets(tx: Transaction, ownerId: string, payload: PersonaDraft) {
  const images = markdownImages(payload.readmeMarkdown);
  if (images.count > 20) throw new BusinessError('INVALID_INPUT', 'README 最多引用 20 张图片');
  const ids = draftAssetIds(payload);
  if (ids.content.some((id) => ids.evidence.includes(id)))
    throw new BusinessError('INVALID_INPUT', '授权证据不能作为公开图片');
  for (const purpose of ['content', 'evidence'] as const) {
    const required = ids[purpose];
    if (!required.length) continue;
    const found = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(eq(assets.ownerId, ownerId), eq(assets.purpose, purpose), inArray(assets.id, required)),
      )
      .for('share');
    if (found.length !== required.length)
      throw new BusinessError(
        'INVALID_INPUT',
        '存在不可使用的图片或授权证据，请重新选择自己的素材',
      );
  }
  return ids;
}
export async function setDraftAssetReferences(
  tx: Transaction,
  ownerId: string,
  personaId: string,
  payload: PersonaDraft,
) {
  const ids = await validateDraftAssets(tx, ownerId, payload);
  await tx
    .delete(assetReferences)
    .where(
      and(eq(assetReferences.resourceType, 'draft'), eq(assetReferences.resourceId, personaId)),
    );
  for (const purpose of ['content', 'evidence'] as const)
    if (ids[purpose].length)
      await tx.insert(assetReferences).values(
        ids[purpose].map((assetId) => ({
          assetId,
          personaId,
          resourceType: 'draft' as const,
          resourceId: personaId,
          purpose,
        })),
      );
}
