import { API_PREFIX } from '../../config/api-prefix.js';

/** Logo, couverture, avatar : URL stable, sans authentification. */
export const publicFilePath = (companyId: string, fileId: string): string =>
  `/${API_PREFIX}/files/public/${companyId}/${fileId}`;

/** Autres fichiers : téléchargement avec l'en-tête Authorization. */
export const privateFilePath = (fileId: string): string => `/${API_PREFIX}/files/${fileId}/content`;

export const sharedFilePath = (token: string): string => `/${API_PREFIX}/files/shared/${token}`;