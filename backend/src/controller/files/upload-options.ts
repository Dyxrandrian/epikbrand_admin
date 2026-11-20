import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import multer from 'multer';
import { MAX_UPLOAD_BYTES } from '../../services/files/file-types.js';

/** Dossier temporaire : le nom du fichier n'est jamais celui du client. */
export const UPLOAD_TMP_DIR = join(tmpdir(), 'epikbrand-uploads');

export const uploadOptions = {
  storage: multer.diskStorage({
    destination: UPLOAD_TMP_DIR,
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 1024, parts: 12 },
};