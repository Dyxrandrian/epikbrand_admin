import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { PageQueryDto, intPipe, uuidPipe } from '../../dto/index.js';
import {
  ArticleListQueryDto,
  CreateArticleDto,
  RestoreVersionDto,
  UpdateArticleDto,
} from '../../dto/articles/article.dto.js';
import { FileContentQueryDto } from '../../dto/files/file-list-query.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { ArticleVersionService } from '../../services/articles/article-version.service.js';
import { ArticleService } from '../../services/articles/article.service.js';
import { contentDisposition } from '../../services/files/file-name.js';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('articles')
export class ArticlesController {
  constructor(
    private readonly articles: ArticleService,
    private readonly versions: ArticleVersionService,
  ) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: ArticleListQueryDto) {
    return this.articles.list(viewer, query);
  }

  // Déclarée AVANT ':id'
  @Get('navigation')
  navigation(@CurrentUser() viewer: AuthenticatedUser) {
    return this.articles.navigation(viewer);
  }

  @Roles(...MANAGERS)
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateArticleDto) {
    return this.articles.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.articles.get(viewer, id);
  }

  @Roles(...MANAGERS)
  @RateLimit({ limit: 120, windowSeconds: 60, scope: 'user' })
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articles.update(user, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @Post(':id/archive')
  archive(@CurrentUser() admin: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.articles.archive(admin, id);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @Post(':id/restore')
  restore(@CurrentUser() admin: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.articles.restore(admin, id);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() admin: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.articles.remove(admin, id);
  }

  @RateLimit({ limit: 30, windowSeconds: 60, scope: 'user' })
  @Get(':id/export')
  async export(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: FileContentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { markdown, fileName } = await this.articles.exportMarkdown(viewer, id);

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      contentDisposition(query.inline === true ? 'inline' : 'attachment', fileName),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(Buffer.from(markdown, 'utf8'));
  }

  // ----- Historique des versions -----

  @Roles(...MANAGERS)
  @Get(':id/versions')
  listVersions(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.versions.list(viewer, id, query);
  }

  @Roles(...MANAGERS)
  @Get(':id/versions/:version')
  getVersion(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Param('version', intPipe('version')) version: number,
  ) {
    return this.versions.get(viewer, id, version);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/versions/:version/restore')
  restoreVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Param('version', intPipe('version')) version: number,
    @Body() dto: RestoreVersionDto,
  ) {
    return this.versions.restore(user, id, version, dto);
  }
}