import { EditorSection } from './editor-section';
import { CategoryField, TagsField } from './taxonomy-fields';
import { RecommendedModelsFields } from './model-fields';
import { OriginFields } from './origin-fields';
export function MetadataFields() {
  return (
    <>
      <EditorSection
        id="persona-taxonomy"
        step="04"
        title="分类标签"
        description="帮助读者了解角色适合的场景"
      >
        <CategoryField />
        <TagsField />
      </EditorSection>
      <RecommendedModelsFields step="05" />
      <OriginFields step="06" />
    </>
  );
}
