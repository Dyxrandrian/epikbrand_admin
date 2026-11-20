import type { MediaAttachment } from '../entities/media-attachment.entity.js';
import { categoryOfMime, PUBLIC_PURPOSES } from '../services/files/file-types.js';
import { privateFilePath, publicFilePath } from '../services/files/file-paths.js';

/**
 * `url` est l'adresse à utiliser : stable et directement affichable pour logo, couverture et
 * avatar ; à appeler avec l'en-tête Authorization (ou via POST /files/:id/link) pour le reste.
 * `uploader` n'apparaît que si la relation a été chargée.
 */
export function toFile(file: MediaAttachment) {
  const isPublic = PUBLIC_PURPOSES.includes(file.purpose);
  return {
    id: file.id,
    purpose: file.purpose,
    file_name: file.fileName,
    file_type: file.fileType,
    file_size: file.fileSize,
    category: categoryOfMime(file.fileType),
    url: isPublic ? publicFilePath(file.companyId, file.id) : privateFilePath(file.id),
    is_public: isPublic,
    task_id: file.taskId,
    project_id: file.projectId,
    article_id: file.articleId,
    uploaded_by: file.uploadedById, // null si l'auteur a été supprimé
    ...(file.uploadedBy !== undefined
      ? {
          uploader: file.uploadedBy
            ? {
                id: file.uploadedBy.id,
                name: file.uploadedBy.name,
                avatar_url: file.uploadedBy.avatarUrl,
              }
            : null,
        }
      : {}),
    created_at: file.createdAt,
  };
}