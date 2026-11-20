export interface UploadedTempFile {
  /** Fichier temporaire sur disque, supprimé par l'intercepteur de nettoyage. */
  path: string;
  size: number;
  originalname: string;
  mimetype: string;
}