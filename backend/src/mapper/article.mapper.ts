import type { AgencyArticleVersion } from '../entities/agency-article-version.entity.js';
import type { AgencyArticle } from '../entities/agency-article.entity.js';
import type { AgencyStructure } from '../entities/agency-structure.entity.js';
import type { StructureTypeRow } from '../repository/agency-structure.repository.js';
import { parseStoredContent } from '../services/articles/article-blocks.js';

const reference = (item: { id: string; name: string; slug: string } | null | undefined) =>
  item ? { id: item.id, name: item.name, slug: item.slug } : null;

function articleBase(article: AgencyArticle) {
  return {
    id: article.id,
    title: article.title,
    section_id: article.sectionId,
    category_id: article.categoryId,
    section: reference(article.section),
    category: reference(article.category),
    updated_by: article.updatedBy
      ? {
          id: article.updatedBy.id,
          name: article.updatedBy.name,
          avatar_url: article.updatedBy.avatarUrl,
        }
      : null,
    archived_at: article.archivedAt,
    version: article.version, // à renvoyer lors d'une modification
    created_at: article.createdAt,
    updated_at: article.updatedAt,
  };
}

/** Liste : sans le contenu, avec un extrait. */
export const toArticle = (article: AgencyArticle, excerpt: string) => ({
  ...articleBase(article),
  excerpt,
});

export const toArticleDetail = (article: AgencyArticle) => ({
  ...articleBase(article),
  content: parseStoredContent(article.content),
});

const editorOf = (version: AgencyArticleVersion) =>
  version.editedBy ? { id: version.editedBy.id, name: version.editedBy.name } : null;

export const toArticleVersionSummary = (version: AgencyArticleVersion) => ({
  version: version.version,
  title: version.title,
  edited_by: editorOf(version),
  created_at: version.createdAt,
});

export const toArticleVersionDetail = (version: AgencyArticleVersion) => ({
  ...toArticleVersionSummary(version),
  content: parseStoredContent(version.content),
});

export const toStructureElement = (element: AgencyStructure) => ({
  id: element.id,
  type_id: element.typeId,
  ...(element.type ? { type: reference(element.type) } : {}),
  value: element.value,
  description: element.description,
  created_at: element.createdAt,
  updated_at: element.updatedAt,
});

/** Un groupe par type, y compris les types sans élément. */
export function toStructureGroups(
  types: readonly StructureTypeRow[],
  elements: readonly AgencyStructure[],
) {
  return types.map((type) => ({
    type: { id: type.id, name: type.name, slug: type.slug },
    elements: elements
      .filter((element) => element.typeId === type.id)
      .map((element) => ({
        id: element.id,
        value: element.value,
        description: element.description,
        created_at: element.createdAt,
        updated_at: element.updatedAt,
      })),
  }));
}