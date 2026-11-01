import { PublicSnapshotSchema, PublicationSchema } from '@personamarket/contracts';
import { markdownSearchText } from './search-text.js';

/** 仅派生已审核快照的可重建搜索字段，不改写作者原稿 */
export function buildPublicSearchProjection(snapshotInput: unknown, publicationInput: unknown) {
  const snapshot = PublicSnapshotSchema.parse(snapshotInput);
  const publication = PublicationSchema.parse(publicationInput);
  const readmeText = markdownSearchText(snapshot.readmeMarkdown);
  const tagNames = publication.tags.map((tag) => tag.name);
  const modelNames = snapshot.recommendedModels.map((model) => model.modelId).join(' ');
  const authorNames = [
    publication.publisher,
    snapshot.origin.type === 'repost' ? snapshot.origin.originalAuthor : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title: snapshot.title,
    summary: snapshot.summary,
    readmeText,
    publisherName: publication.publisher,
    authorNames,
    tagNames,
    modelNames,
    searchText: [
      snapshot.title,
      tagNames.join(' '),
      snapshot.summary,
      authorNames,
      modelNames,
      readmeText,
    ].join('\n'),
    categoryId: snapshot.categoryId,
    tagIds: snapshot.tagIds,
    platform: snapshot.platform,
    originType: snapshot.origin.type,
    redistribution: snapshot.origin.redistribution,
    dialogueCount: snapshot.platform === 'astrbot' ? snapshot.content.dialoguePairs.length : 0,
  };
}
