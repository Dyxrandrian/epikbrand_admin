import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { uuidPipe } from '../../dto/index.js';
import {
  FileCategoryQueryDto,
  FileContentQueryDto,
  FileListQueryDto,
} from '../../dto/files/file-list-query.dto.js';
import { UploadFileDto } from '../../dto/files/upload-file.dto.js';
import { UploadCleanupInterceptor } from '../../interceptors/upload-cleanup.interceptor.js';
import { CurrentUser, Public, RateLimit } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { sendFile } from '../../services/files/file-response.js';
import { FileService } from '../../services/files/file.service.js';
import type { UploadedTempFile } from '../../services/files/uploaded-file.js';
import { uploadOptions } from './upload-options.js';

@Controller()
export class FilesController {
  constructor(private readonly files: FileService) {}

  // ----- Envoi et liste -----

  @RateLimit({ limit: 60, windowSeconds: 600, scope: 'user' })
  @UseInterceptors(FileInterceptor('file', uploadOptions), UploadCleanupInterceptor)
  @Post('files')
  upload(
    @CurrentUser() viewer: AuthenticatedUser,
    @UploadedFile() file: UploadedTempFile | undefined,
    @Body() dto: UploadFileDto,
  ) {
    return this.files.upload(viewer, dto, file);
  }

  @Get('files')
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: FileListQueryDto) {
    return this.files.list(viewer, query);
  }

  // ----- Routes publiques : AVANT 'files/:id' -----

  /** Logo, couverture, avatar : URL stable et affichable dans un <img>. */
  @Public()
  @Get('files/public/:companyId/:id')
  async publicFile(
    @Param('companyId', uuidPipe('companyId')) companyId: string,
    @Param('id', uuidPipe('id')) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.files.openPublic(companyId, id);
    return sendFile(res, file, stream, { inline: true, visibility: 'public' });
  }

  /** Lien signé obtenu par POST /files/:id/link. */
  @Public()
  @Get('files/shared/:token')
  async shared(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const { file, stream, inline } = await this.files.openShared(token);
    return sendFile(res, file, stream, { inline, visibility: 'private' });
  }

  // ----- Un fichier -----

  @Get('files/:id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.files.get(viewer, id);
  }

  @Get('files/:id/content')
  async content(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: FileContentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.files.open(viewer, id);
    return sendFile(res, file, stream, { inline: query.inline === true, visibility: 'private' });
  }

  @HttpCode(200)
  @Post('files/:id/link')
  link(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: FileContentQueryDto,
  ) {
    return this.files.createLink(viewer, id, query.inline === true);
  }

  @HttpCode(204)
  @Delete('files/:id')
  remove(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.files.remove(viewer, id);
  }

  // ----- Liste par parent -----

  @Get('tasks/:taskId/files')
  forTask(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('taskId', uuidPipe('taskId')) taskId: string,
    @Query() query: FileCategoryQueryDto,
  ) {
    return this.files.listForParent(viewer, 'task', taskId, query);
  }

  @Get('projects/:projectId/files')
  forProject(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('projectId', uuidPipe('projectId')) projectId: string,
    @Query() query: FileCategoryQueryDto,
  ) {
    return this.files.listForParent(viewer, 'project', projectId, query);
  }

  @Get('articles/:articleId/files')
  forArticle(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('articleId', uuidPipe('articleId')) articleId: string,
    @Query() query: FileCategoryQueryDto,
  ) {
    return this.files.listForParent(viewer, 'article', articleId, query);
  }
}