import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { FindOptionsWhere, SelectQueryBuilder } from 'typeorm';
import type { SortOrder } from '../dto/index.js';
import type { FileCategoryQueryDto, FileListQueryDto } from '../dto/files/file-list-query.dto.js';
import { MediaAttachment } from '../entities/media-attachment.entity.js';
import { MediaPurpose } from '../enums/app.enums.js';
import type { FileCategory } from '../enums/file.enums.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { mimesForCategory } from '../services/files/file-types.js';
import { applyWordSearch } from './search.js';
import type { TaskViewer } from './task.repository.js';
import { TenantRepository } from './tenant.repository.js';

export type ParentKind = 'task' | 'project' | 'article';
export type ImageKind = 'logo' | 'cover';

const PARENT_COLUMN = { task: 'taskId', project: 'projectId', article: 'articleId' } as const;

@Injectable()
export class FileRepository extends TenantRepository<MediaAttachment> {
  protected readonly alias = 'file';
  protected readonly label = 'Fichier';
  protected readonly sortableFields = {
    created_at: 'createdAt',
    file_name: 'fileName',
    file_size: 'fileSize',
  };
  protected readonly defaultSort: SortOrder = { created_at: 'DESC' };

  constructor(@InjectRepository(MediaAttachment) repo: Repository<MediaAttachment>) {
    super(repo);
  }

  // ---------- Lectures ----------

  /** Liste globale : pièces jointes et reçus accessibles à l'utilisateur. */
  list(companyId: string, query: FileListQueryDto, viewer: TaskViewer) {
    const qb = this.scoped(companyId).andWhere('file.purpose IN (:...listPurposes)', {
      listPurposes: [MediaPurpose.ATTACHMENT, MediaPurpose.RECEIPT],
    });
    this.applyIncludes(qb, query.include, {}); // aucune relation disponible : include est refusé

    if (query.purpose) qb.andWhere('file.purpose = :listPurpose', { listPurpose: query.purpose });
    if (query.uploaded_by) {
      qb.andWhere('file.uploadedById = :listUploader', { listUploader: query.uploaded_by });
    }
    this.applyCategory(qb, query.category);
    this.restrictToAccessible(qb, viewer);
    this.joinUploader(qb);
    applyWordSearch(qb, '"file"."file_name"', query.q);
    return this.paginate(qb, query);
  }

  /** Pièces jointes d'un parent. Les droits sur le parent sont vérifiés par l'appelant. */
  listForParent(
    companyId: string,
    kind: ParentKind,
    parentId: string,
    query: FileCategoryQueryDto,
  ) {
    const qb = this.scoped(companyId)
      .andWhere('file.purpose = :parentPurpose', { parentPurpose: MediaPurpose.ATTACHMENT })
      .andWhere(`file.${PARENT_COLUMN[kind]} = :parentId`, { parentId });
    this.applyIncludes(qb, query.include, {});
    this.applyCategory(qb, query.category);
    this.joinUploader(qb);
    applyWordSearch(qb, '"file"."file_name"', query.q);
    return this.paginate(qb, query);
  }

  async getWithUploader(companyId: string, id: string): Promise<MediaAttachment> {
    const qb = this.scoped(companyId).andWhere('file.id = :fileId', { fileId: id });
    this.joinUploader(qb);
    const file = await qb.getOne();
    if (!file) throw new ResourceNotFoundException(this.label);
    return file;
  }

  /** Les articles n'ont pas encore de module : vérification directe sur leur table. */
  async articleExists(
    companyId: string,
    articleId: string,
    options: { includeArchived: boolean },
  ): Promise<boolean> {
    const rows: Array<{ ok: boolean }> = await this.repo.manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM agency_articles
          WHERE company_id = $1 AND id = $2
                ${options.includeArchived ? '' : 'AND archived_at IS NULL'}
       ) AS ok`,
      [this.requireCompanyId(companyId), articleId],
    );
    return rows[0].ok;
  }

  async usedBytes(companyId: string): Promise<number> {
    const rows: Array<{ used: string }> = await this.repo.manager.query(
      `SELECT COALESCE(SUM(file_size), 0)::text AS used FROM media_attachments WHERE company_id = $1`,
      [this.requireCompanyId(companyId)],
    );
    return Number(rows[0].used);
  }

  /** Verrou de transaction par entreprise : le contrôle du quota ne peut pas être doublé. */
  async lockQuota(companyId: string): Promise<void> {
    await this.repo.manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `storage-quota:${this.requireCompanyId(companyId)}`,
    ]);
  }

  /** Fichiers que le nouvel envoi remplace (un logo, une couverture, un avatar par personne). */
  findReplaceable(
    companyId: string,
    purpose: MediaPurpose,
    uploaderId: string,
  ): Promise<MediaAttachment[]> {
    const qb = this.scoped(companyId).andWhere('file.purpose = :replPurpose', {
      replPurpose: purpose,
    });
    if (purpose === MediaPurpose.AVATAR) {
      qb.andWhere('file.uploadedById = :replUploader', { replUploader: uploaderId });
    }
    return qb.getMany();
  }

  // ---------- Écritures ----------

  async deleteMany(companyId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.repo.delete({
      companyId: this.requireCompanyId(companyId),
      id: In([...ids]),
    } as FindOptionsWhere<MediaAttachment>);
  }

  async setCompanyImageUrl(companyId: string, kind: ImageKind, url: string | null): Promise<void> {
    const column = kind === 'logo' ? 'logo_url' : 'cover_url';
    await this.repo.manager.query(
      `UPDATE companies SET ${column} = $2, updated_at = now() WHERE id = $1`,
      [this.requireCompanyId(companyId), url],
    );
  }

  /** Efface l'URL seulement si elle pointe encore vers ce fichier. */
  async clearCompanyImageUrl(companyId: string, kind: ImageKind, url: string): Promise<boolean> {
    const column = kind === 'logo' ? 'logo_url' : 'cover_url';
    const rows: Array<{ n: number }> = await this.repo.manager.query(
      `WITH changed AS (
         UPDATE companies SET ${column} = NULL, updated_at = now()
          WHERE id = $1 AND ${column} = $2
          RETURNING id
       )
       SELECT COUNT(*)::int AS n FROM changed`,
      [this.requireCompanyId(companyId), url],
    );
    return rows[0].n > 0;
  }

  async setUserAvatarUrl(companyId: string, userId: string, url: string): Promise<void> {
    await this.repo.manager.query(
      `UPDATE users SET avatar_url = $3, updated_at = now() WHERE id = $2 AND company_id = $1`,
      [this.requireCompanyId(companyId), userId, url],
    );
  }

  async clearUserAvatarUrl(companyId: string, userId: string, url: string): Promise<void> {
    await this.repo.manager.query(
      `UPDATE users SET avatar_url = NULL, updated_at = now()
        WHERE id = $2 AND company_id = $1 AND avatar_url = $3`,
      [this.requireCompanyId(companyId), userId, url],
    );
  }

  // ---------- Outils internes ----------

  private applyCategory(qb: SelectQueryBuilder<MediaAttachment>, category?: FileCategory): void {
    if (!category) return;
    qb.andWhere('file.fileType IN (:...categoryMimes)', { categoryMimes: mimesForCategory(category) });
  }

  /** Auteur : id, nom et avatar seulement (jamais le reste du compte). */
  private joinUploader(qb: SelectQueryBuilder<MediaAttachment>): void {
    qb.leftJoin('file.uploadedBy', 'inc_uploader').addSelect([
      'inc_uploader.id',
      'inc_uploader.name',
      'inc_uploader.avatarUrl',
    ]);
  }

  /**
   * Collaborateur : ses reçus, plus les pièces jointes qu'il peut lire (même règle que le
   * téléchargement : article actif, projet où il participe, tâche qu'il voit).
   * Admin et manager : aucune restriction.
   */
  private restrictToAccessible(qb: SelectQueryBuilder<MediaAttachment>, viewer: TaskViewer): void {
    if (viewer.privileged) return;
    qb.andWhere(
      `(
         ("file"."purpose" = 'receipt' AND "file"."uploaded_by" = :accViewer)
         OR ("file"."purpose" = 'attachment' AND (
              ("file"."article_id" IS NOT NULL AND EXISTS (
                  SELECT 1 FROM agency_articles a
                   WHERE a.id = "file"."article_id"
                     AND a.company_id = "file"."company_id"
                     AND a.archived_at IS NULL))
           OR ("file"."project_id" IS NOT NULL AND EXISTS (
                  SELECT 1 FROM tasks t
                    JOIN task_assignees ta ON ta.task_id = t.id
                    JOIN projects p ON p.id = t.project_id
                   WHERE t.company_id = "file"."company_id"
                     AND t.project_id = "file"."project_id"
                     AND t.archived_at IS NULL AND p.archived_at IS NULL
                     AND ta.user_id = :accViewer))
           OR ("file"."task_id" IS NOT NULL AND EXISTS (
                  SELECT 1 FROM tasks tt
                   WHERE tt.id = "file"."task_id"
                     AND tt.company_id = "file"."company_id"
                     AND tt.archived_at IS NULL
                     AND (
                       EXISTS (SELECT 1 FROM task_assignees a2
                                WHERE a2.task_id = tt.id AND a2.user_id = :accViewer)
                       OR EXISTS (SELECT 1
                                    FROM tasks t3
                                    JOIN task_assignees ta3 ON ta3.task_id = t3.id
                                    JOIN projects p3 ON p3.id = t3.project_id
                                   WHERE t3.company_id = tt.company_id
                                     AND t3.project_id = tt.project_id
                                     AND t3.archived_at IS NULL AND p3.archived_at IS NULL
                                     AND ta3.user_id = :accViewer))))
         ))
       )`,
      { accViewer: viewer.id },
    );
  }

  /** Logo actuel de l'entreprise (le plus récent). */
  findCompanyLogo(companyId: string): Promise<MediaAttachment | null> {
    return this.scoped(companyId)
      .andWhere('file.purpose = :logoPurpose', { logoPurpose: MediaPurpose.LOGO })
      .orderBy('file.createdAt', 'DESC')
      .getOne();
  }

  /** Dépense à laquelle ce justificatif est rattaché (par son URL), le cas échéant. */
  async expenseOfReceipt(
    companyId: string,
    url: string,
  ): Promise<{ id: string; status: string; userId: string | null } | null> {
    const rows: Array<{ id: string; status: string; userId: string | null }> =
      await this.repo.manager.query(
        `SELECT id, status, user_id AS "userId"
           FROM expenses
          WHERE company_id = $1 AND receipt_url = $2
          LIMIT 1`,
        [this.requireCompanyId(companyId), url],
      );
    return rows[0] ?? null;
  }
}