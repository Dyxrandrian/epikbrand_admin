import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ValidationFailedException } from '../../exceptions/index.js';
import { FileRepository } from '../../repository/file.repository.js';
import {
  dropImages,
  normalizeBlocks,
  plainTextOf,
  serializeBlocks,
} from './article-blocks.js';
import type { Block } from './article-blocks.js';

export interface PreparedContent {
  blocks: Block[];
  /** Ce qui est enregistré dans agency_articles.content */
  json: string;
  /** Ce qui est enregistré dans agency_articles.search_text */
  plainText: string;
  droppedImages: number;
}

@Injectable()
export class ArticleContentService {
  constructor(private readonly files: FileRepository) {}

  /**
   * Valide et normalise le contenu. Les images doivent être des fichiers joints à cet article :
   * en mode « strict » une image absente est refusée (400), en mode « lenient » (restauration
   * d'une ancienne version) elle est simplement retirée.
   */
  async prepare(
    manager: EntityManager | null,
    companyId: string,
    articleId: string | null,
    input: unknown[],
    mode: 'strict' | 'lenient',
  ): Promise<PreparedContent> {
    const { blocks, imageIds } = normalizeBlocks(input);
    let finalBlocks = blocks;
    let dropped = 0;

    if (imageIds.size > 0) {
      if (articleId === null) {
        throw new ValidationFailedException([
          {
            field: 'content',
            reason: 'imagesNeedArticle',
            message:
              "Enregistrez d'abord l'article, puis joignez les images (POST /files avec article_id) et mettez le contenu à jour.",
          },
        ]);
      }

      const files = manager ? this.files.withManager(manager) : this.files;
      const valid = await files.imageAttachmentIds(companyId, articleId, [...imageIds]);
      const missing = new Set([...imageIds].filter((id) => !valid.has(id)));

      if (missing.size > 0) {
        if (mode === 'strict') {
          throw new ValidationFailedException([
            {
              field: 'content',
              reason: 'imageNotAttached',
              message: `Image(s) introuvable(s) ou non jointes à cet article : ${[...missing].join(', ')}.`,
            },
          ]);
        }
        const result = dropImages(blocks, missing);
        finalBlocks = result.blocks;
        dropped = result.dropped;
      }
    }

    return {
      blocks: finalBlocks,
      json: serializeBlocks(finalBlocks),
      plainText: plainTextOf(finalBlocks),
      droppedImages: dropped,
    };
  }
}