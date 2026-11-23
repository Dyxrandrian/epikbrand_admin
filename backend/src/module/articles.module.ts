import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyStructureController } from '../controller/articles/agency-structure.controller.js';
import { ArticlesController } from '../controller/articles/articles.controller.js';
import { AgencyArticleVersion } from '../entities/agency-article-version.entity.js';
import { AgencyArticle } from '../entities/agency-article.entity.js';
import { AgencyStructure } from '../entities/agency-structure.entity.js';
import { ArticleCategory } from '../entities/article-category.entity.js';
import { ArticleSection } from '../entities/article-section.entity.js';
import { StructureElementType } from '../entities/structure-element-type.entity.js';
import { AgencyStructureRepository } from '../repository/agency-structure.repository.js';
import { ArticleVersionRepository } from '../repository/article-version.repository.js';
import { ArticleRepository } from '../repository/article.repository.js';
import {
  ArticleCategoryRepository,
  ArticleSectionRepository,
  StructureElementTypeRepository,
} from '../repository/config-lists.repositories.js';
import { AgencyStructureService } from '../services/articles/agency-structure.service.js';
import { ArticleContentService } from '../services/articles/article-content.service.js';
import { ArticleVersionService } from '../services/articles/article-version.service.js';
import { ArticleService } from '../services/articles/article.service.js';
import { FilesModule } from './files.module.js';

// AuditService et NotificationService viennent de modules globaux
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgencyArticle,
      AgencyArticleVersion,
      AgencyStructure,
      ArticleSection,
      ArticleCategory,
      StructureElementType,
    ]),
    FilesModule,
  ],
  controllers: [ArticlesController, AgencyStructureController],
  providers: [
    ArticleRepository,
    ArticleVersionRepository,
    AgencyStructureRepository,
    ArticleSectionRepository,
    ArticleCategoryRepository,
    StructureElementTypeRepository,
    ArticleContentService,
    ArticleService,
    ArticleVersionService,
    AgencyStructureService,
  ],
  exports: [ArticleRepository],
})
export class ArticlesModule {}