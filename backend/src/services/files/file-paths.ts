import { API_PREFIX } from '../../config/api-prefix.js';

/** Logo, couverture, avatar : URL stable, sans authentification. */
export const publicFilePath = (companyId: string, fileId: string): string =>
  `/${API_PREFIX}/files/public/${companyId}/${fileId}`;

/** Autres fichiers : téléchargement avec l'en-tête Authorization. */
export const privateFilePath = (fileId: string): string => `/${API_PREFIX}/files/${fileId}/content`;

export const sharedFilePath = (token: string): string => `/${API_PREFIX}/files/shared/${token}`;

const RECEIPT_URL_PATTERN = new RegExp(`^/${API_PREFIX}/files/([0-9a-f-]{36})/content$`);

/** Identifiant du fichier d'un justificatif, d'après l'URL stockée dans expenses.receipt_url. */
export const receiptIdFromUrl = (url: string | null | undefined): string | null =>
  (url ? RECEIPT_URL_PATTERN.exec(url)?.[1] : undefined) ?? null;

/** Identifiant du fichier d'une URL privée (/api/v1/files/<id>/content), ou null. */
export const privateFileIdFromUrl = receiptIdFromUrl;