import { Injectable } from '@nestjs/common';
import type { MediaAttachment } from '../../entities/media-attachment.entity.js';
import { MediaPurpose } from '../../enums/app.enums.js';
import {
  AccessDeniedException,
  BusinessRuleException,
  ErrorCode,
  InvalidReferenceException,
  ResourceNotFoundException,
} from '../../exceptions/index.js';
import type { UploadFileDto } from '../../dto/files/upload-file.dto.js';
import { FileRepository } from '../../repository/file.repository.js';
import type { ParentKind } from '../../repository/file.repository.js';
import { ProjectRepository } from '../../repository/project.repository.js';
import { TaskRepository } from '../../repository/task.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { viewerOf } from '../tasks/task-rules.js';

export interface UploadParent {
  taskId?: string;
  projectId?: string;
  articleId?: string;
}

const PARENT_LABELS: Record<ParentKind, string> = {
  task: 'Tâche',
  project: 'Projet',
  article: 'Article',
};

@Injectable()
export class FileAccessService {
  constructor(
    private readonly files: FileRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
  ) {}

  /** 404 « Fichier introuvable » si l'utilisateur ne peut pas lire ce fichier. */
  async assertCanRead(viewer: AuthenticatedUser, file: MediaAttachment): Promise<void> {
    if (!(await this.canRead(viewer, file))) throw new ResourceNotFoundException('Fichier');
  }

  async canRead(viewer: AuthenticatedUser, file: MediaAttachment): Promise<boolean> {
    const privileged = viewerOf(viewer).privileged;

    switch (file.purpose) {
      case MediaPurpose.ATTACHMENT:
        if (file.taskId) return this.parentReadable(viewer, 'task', file.taskId);
        if (file.projectId) return this.parentReadable(viewer, 'project', file.projectId);
        if (file.articleId) return this.parentReadable(viewer, 'article', file.articleId);
        return false;
      case MediaPurpose.RECEIPT:
        return privileged || file.uploadedById === viewer.id;
      default:
        return true; // logo, couverture, avatar : membres de l'entreprise (déjà filtrés par entreprise)
    }
  }

  /** 404 si le parent n'existe pas ou n'est pas lisible pour cet utilisateur. */
  async assertParentReadable(viewer: AuthenticatedUser, kind: ParentKind, id: string): Promise<void> {
    if (!(await this.parentReadable(viewer, kind, id))) {
      throw new ResourceNotFoundException(PARENT_LABELS[kind]);
    }
  }

  /**
   * Parent d'un envoi, avec les droits d'écriture.
   * Pièce jointe : exactement un parent (422). Autres usages : aucun parent (422).
   * Rôle insuffisant : 403. Parent introuvable ou invisible : 422 sur le champ concerné.
   */
  async resolveUploadParent(
    viewer: AuthenticatedUser,
    purpose: MediaPurpose,
    dto: UploadFileDto,
  ): Promise<UploadParent> {
    const given = [dto.task_id, dto.project_id, dto.article_id].filter(
      (value): value is string => value !== undefined,
    );

    if (purpose !== MediaPurpose.ATTACHMENT) {
      if (given.length > 0) {
        throw new BusinessRuleException(
          'Ce type de fichier ne se rattache à aucun parent : retirez task_id, project_id et article_id.',
          ErrorCode.INVALID_FILE_PARENT,
        );
      }
      return {};
    }
    if (given.length !== 1) {
      throw new BusinessRuleException(
        'Une pièce jointe doit être rattachée à exactement un parent : task_id, project_id ou article_id.',
        ErrorCode.INVALID_FILE_PARENT,
      );
    }

    const { companyId } = viewer;
    const ctx = viewerOf(viewer);

    if (dto.task_id) {
      if (!(await this.parentReadable(viewer, 'task', dto.task_id, { activeOnly: true }))) {
        throw new InvalidReferenceException('task_id', 'Tâche');
      }
      return { taskId: dto.task_id };
    }

    // Projets et articles : réservés aux admins et managers (contrôle du rôle AVANT l'existence)
    if (!ctx.privileged) {
      throw new AccessDeniedException(
        'Seuls les administrateurs et managers peuvent joindre un fichier à un projet ou à un article.',
      );
    }
    if (dto.project_id) {
      await this.projects.assertReference(companyId, dto.project_id, 'project_id');
      return { projectId: dto.project_id };
    }
    const articleId = dto.article_id as string;
    if (!(await this.files.articleExists(companyId, articleId, { includeArchived: false }))) {
      throw new InvalidReferenceException('article_id', 'Article');
    }
    return { articleId };
  }

  // ---------- Outils internes ----------

  private async parentReadable(
    viewer: AuthenticatedUser,
    kind: ParentKind,
    id: string,
    options: { activeOnly?: boolean } = {},
  ): Promise<boolean> {
    const { companyId } = viewer;
    const ctx = viewerOf(viewer);
    const includeArchived = ctx.privileged && !options.activeOnly;

    try {
      switch (kind) {
        case 'task':
          await this.tasks.getVisible(companyId, id, ctx, { includeArchived });
          return true;
        case 'project': {
          if (includeArchived) {
            await this.projects.getByIdIncludingArchived(companyId, id);
            return true;
          }
          const project = await this.projects.findById(companyId, id);
          if (!project) return false;
          return ctx.privileged || (await this.projects.isParticipant(companyId, id, viewer.id));
        }
        case 'article':
          return await this.files.articleExists(companyId, id, { includeArchived });
      }
    } catch (error) {
      if (error instanceof ResourceNotFoundException) return false;
      throw error;
    }
  }
}