import { Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import type { UploadFileDto } from '../../dto/files/upload-file.dto.js';
import type {
  FileCategoryQueryDto,
  FileListQueryDto,
} from '../../dto/files/file-list-query.dto.js';
import type { MediaAttachment } from '../../entities/media-attachment.entity.js';
import { MediaPurpose, UserRole } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  AccessDeniedException,
  BusinessRuleException,
  ErrorCode,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../../exceptions/index.js';
import { toFile } from '../../mapper/file.mapper.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { FileRepository } from '../../repository/file.repository.js';
import type { ImageKind, ParentKind } from '../../repository/file.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { AuditService } from '../audit/audit.service.js';
import { viewerOf } from '../tasks/task-rules.js';
import { FileAccessService } from './file-access.service.js';
import { FileLinkService } from './file-link.service.js';
import { publicFilePath, sharedFilePath } from './file-paths.js';
import { inspectUpload } from './file-inspection.js';
import { PUBLIC_PURPOSES, REPLACING_PURPOSES } from './file-types.js';
import { VirusScanner } from './scan/virus-scanner.js';
import { FileStorage, StorageObjectNotFoundError, newStorageKey } from './storage/file-storage.js';
import type { UploadedTempFile } from './uploaded-file.js';

export interface OpenedFile {
  file: MediaAttachment;
  stream: Readable;
}

const megabytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} Mo`;

function imageKindOf(purpose: MediaPurpose): ImageKind | null {
  if (purpose === MediaPurpose.LOGO) return 'logo';
  if (purpose === MediaPurpose.COVER) return 'cover';
  return null;
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly files: FileRepository,
    private readonly access: FileAccessService,
    private readonly storage: FileStorage,
    private readonly scanner: VirusScanner,
    private readonly links: FileLinkService,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
  ) {}

  // ---------- Envoi ----------

  /** Le fichier temporaire est supprimé par l'intercepteur de nettoyage, quoi qu'il arrive. */
  async upload(viewer: AuthenticatedUser, dto: UploadFileDto, upload: UploadedTempFile | undefined) {
    if (!upload) {
      throw new ValidationFailedException([
        {
          field: 'file',
          reason: 'fileRequired',
          message: 'Le fichier est obligatoire (champ multipart « file »).',
        },
      ]);
    }

    const { companyId } = viewer;
    const purpose = dto.purpose ?? MediaPurpose.ATTACHMENT;

    if (
      (purpose === MediaPurpose.LOGO || purpose === MediaPurpose.COVER) &&
      viewer.role !== UserRole.ADMIN
    ) {
      throw new AccessDeniedException(
        "Seul un administrateur peut modifier le logo et la couverture de l'entreprise.",
      );
    }

    const parent = await this.access.resolveUploadParent(viewer, purpose, dto); // 403 / 422
    const inspected = await inspectUpload(upload, purpose); // 422
    await this.scanner.scan(upload.path); // 422 / 503

    // Contrôle rapide avant d'envoyer quoi que ce soit au stockage (le contrôle définitif est plus bas)
    if (!REPLACING_PURPOSES.includes(purpose)) {
      const company = await this.companies.getById(companyId);
      this.assertQuota(await this.files.usedBytes(companyId), inspected.size, company.storageQuotaBytes);
    }

    const key = newStorageKey(companyId);
    await this.storage.put(key, upload.path, { contentType: inspected.mime, size: inspected.size });

    try {
      const stored = await this.dataSource.transaction(async (manager) => {
        const repo = this.files.withManager(manager);
        await repo.lockQuota(companyId);

        const replaced = REPLACING_PURPOSES.includes(purpose)
          ? await repo.findReplaceable(companyId, purpose, viewer.id)
          : [];
        const replacedBytes = replaced.reduce((sum, item) => sum + item.fileSize, 0);

        const company = await this.companies.getById(companyId, manager);
        const used = await repo.usedBytes(companyId);
        this.assertQuota(used - replacedBytes, inspected.size, company.storageQuotaBytes);

        await repo.deleteMany(companyId, replaced.map((item) => item.id));

        const created = await repo.createOne(companyId, {
          purpose,
          fileName: inspected.fileName,
          fileUrl: key,
          fileType: inspected.mime,
          fileSize: inspected.size,
          taskId: parent.taskId ?? null,
          projectId: parent.projectId ?? null,
          articleId: parent.articleId ?? null,
          uploadedById: viewer.id,
        });
        const file = await repo.getWithUploader(companyId, created.id);
        const url = publicFilePath(companyId, file.id);

        const kind = imageKindOf(purpose);
        if (kind) {
          const before = kind === 'logo' ? company.logoUrl : company.coverUrl;
          await repo.setCompanyImageUrl(companyId, kind, url);
          await this.audit.record(
            {
              action: AuditAction.UPDATE,
              entityType: AuditEntityType.COMPANY,
              entityId: companyId,
              companyId,
              userId: viewer.id,
              changes: { before: { [`${kind}_url`]: before }, after: { [`${kind}_url`]: url } },
            },
            manager,
          );
        } else if (purpose === MediaPurpose.AVATAR) {
          await repo.setUserAvatarUrl(companyId, viewer.id, url);
        }
        return { file, replaced };
      });

      // Les anciens objets sont supprimés après validation de la transaction
      for (const old of stored.replaced) await this.deleteObject(old.fileUrl);
      return toFile(stored.file);
    } catch (error) {
      await this.deleteObject(key); // rien n'a été enregistré en base : on ne laisse pas d'objet orphelin
      throw error;
    }
  }

  // ---------- Lectures ----------

  async list(viewer: AuthenticatedUser, query: FileListQueryDto) {
    const result = await this.files.list(viewer.companyId, query, viewerOf(viewer));
    return result.map(toFile);
  }

  async listForParent(
    viewer: AuthenticatedUser,
    kind: ParentKind,
    parentId: string,
    query: FileCategoryQueryDto,
  ) {
    await this.access.assertParentReadable(viewer, kind, parentId); // 404
    const result = await this.files.listForParent(viewer.companyId, kind, parentId, query);
    return result.map(toFile);
  }

  async get(viewer: AuthenticatedUser, id: string) {
    const file = await this.files.getWithUploader(viewer.companyId, id);
    await this.access.assertCanRead(viewer, file);
    return toFile(file);
  }

  /** Téléchargement authentifié. */
  async open(viewer: AuthenticatedUser, id: string): Promise<OpenedFile> {
    const file = await this.files.getById(viewer.companyId, id);
    await this.access.assertCanRead(viewer, file);
    return { file, stream: await this.openStream(file) };
  }

  /** Lien signé de 5 minutes, délivré seulement à qui peut lire le fichier. */
  async createLink(viewer: AuthenticatedUser, id: string, inline: boolean) {
    const file = await this.files.getById(viewer.companyId, id);
    await this.access.assertCanRead(viewer, file);

    const { token, expiresAt } = this.links.sign({
      fileId: file.id,
      companyId: file.companyId,
      inline,
    });
    return { url: sharedFilePath(token), expires_at: expiresAt };
  }

  /** Route publique : la signature du lien tient lieu d'authentification. */
  async openShared(token: string): Promise<OpenedFile & { inline: boolean }> {
    const { fileId, companyId, inline } = this.links.verify(token);
    const file = await this.files.getById(companyId, fileId);
    return { file, stream: await this.openStream(file), inline };
  }

  /** Route publique : uniquement logo, couverture et avatar. */
  async openPublic(companyId: string, id: string): Promise<OpenedFile> {
    const file = await this.files.getById(companyId, id);
    if (!PUBLIC_PURPOSES.includes(file.purpose)) throw new ResourceNotFoundException('Fichier');
    return { file, stream: await this.openStream(file) };
  }

  // ---------- Suppression ----------

  async remove(viewer: AuthenticatedUser, id: string): Promise<void> {
    const { companyId } = viewer;
    const file = await this.files.getById(companyId, id);
    await this.access.assertCanRead(viewer, file); // 404 si invisible
    this.assertCanDelete(viewer, file); // 403

    await this.dataSource.transaction(async (manager) => {
      const repo = this.files.withManager(manager);
      await repo.deleteById(companyId, id);

      const url = publicFilePath(companyId, id);
      const kind = imageKindOf(file.purpose);
      if (kind) {
        const company = await this.companies.getById(companyId, manager);
        const before = kind === 'logo' ? company.logoUrl : company.coverUrl;
        if (await repo.clearCompanyImageUrl(companyId, kind, url)) {
          await this.audit.record(
            {
              action: AuditAction.UPDATE,
              entityType: AuditEntityType.COMPANY,
              entityId: companyId,
              companyId,
              userId: viewer.id,
              changes: { before: { [`${kind}_url`]: before }, after: { [`${kind}_url`]: null } },
            },
            manager,
          );
        }
      } else if (file.purpose === MediaPurpose.AVATAR && file.uploadedById) {
        await repo.clearUserAvatarUrl(companyId, file.uploadedById, url);
      }
    });

    await this.deleteObject(file.fileUrl);
  }

  // ---------- Outils internes ----------

  private assertCanDelete(viewer: AuthenticatedUser, file: MediaAttachment): void {
    const privileged = viewerOf(viewer).privileged;
    const isAuthor = file.uploadedById === viewer.id;

    let allowed: boolean;
    switch (file.purpose) {
      case MediaPurpose.LOGO:
      case MediaPurpose.COVER:
        allowed = viewer.role === UserRole.ADMIN;
        break;
      case MediaPurpose.AVATAR:
        allowed = isAuthor || viewer.role === UserRole.ADMIN;
        break;
      default:
        allowed = isAuthor || privileged;
    }
    if (!allowed) {
      throw new AccessDeniedException("Vous n'avez pas le droit de supprimer ce fichier.");
    }
  }

  private assertQuota(used: number, adding: number, quota: number): void {
    if (used + adding > quota) {
      throw new BusinessRuleException(
        `Quota de stockage dépassé : ${megabytes(used)} utilisés sur ${megabytes(quota)}, ce fichier ajouterait ${megabytes(adding)}.`,
        ErrorCode.STORAGE_QUOTA_EXCEEDED,
        { used_bytes: used, quota_bytes: quota, file_size: adding },
      );
    }
  }

  private async openStream(file: MediaAttachment): Promise<Readable> {
    try {
      return await this.storage.getStream(file.fileUrl);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        // Ligne en base sans objet : incohérence à investiguer, invisible pour l'utilisateur
        this.logger.error(`Objet manquant pour le fichier ${file.id} (${file.fileUrl})`);
        throw new ResourceNotFoundException('Fichier');
      }
      throw error;
    }
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.error(`Suppression de l'objet de stockage impossible : ${key}`, error as Error);
    }
  }
}