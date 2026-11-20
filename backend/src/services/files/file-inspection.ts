import { open, stat } from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';
import { MediaPurpose } from '../../enums/app.enums.js';
import type { FileCategory } from '../../enums/file.enums.js';
import { BusinessRuleException, ErrorCode } from '../../exceptions/index.js';
import { extensionOf, sanitizeFileName } from './file-name.js';
import {
  ALLOWED_MIMES_BY_PURPOSE,
  MAX_BYTES_BY_PURPOSE,
  MB,
  findRule,
} from './file-types.js';
import type { UploadedTempFile } from './uploaded-file.js';

export interface InspectedFile {
  fileName: string;
  /** Type déterminé par le contenu du fichier, jamais par ce que déclare le navigateur. */
  mime: string;
  category: FileCategory;
  size: number;
}

const TEXT_SAMPLE_BYTES = 64 * 1024;

const FORMATS_BY_MIME: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
};

const unsupported = (detail: string): BusinessRuleException =>
  new BusinessRuleException(detail, ErrorCode.UNSUPPORTED_FILE_TYPE);

/** Texte valide : pas d'octet nul, UTF-8 correct (un caractère coupé en fin d'échantillon est toléré). */
async function looksLikeText(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(TEXT_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, TEXT_SAMPLE_BYTES, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
      return true;
    } catch {
      return false;
    }
  } finally {
    await handle.close();
  }
}

export async function inspectUpload(
  upload: UploadedTempFile,
  purpose: MediaPurpose,
): Promise<InspectedFile> {
  const size = (await stat(upload.path)).size;
  if (size === 0) throw new BusinessRuleException('Le fichier est vide.');

  const limit = MAX_BYTES_BY_PURPOSE[purpose];
  if (size > limit) {
    throw new BusinessRuleException(
      `Le fichier est trop volumineux (${limit / MB} Mo maximum pour cet usage).`,
      ErrorCode.FILE_TOO_LARGE,
    );
  }

  const fileName = sanitizeFileName(upload.originalname);
  const ext = extensionOf(fileName);

  const detected = await fileTypeFromFile(upload.path).catch(() => undefined);
  const rule = findRule(detected?.mime, ext);
  if (!rule || (rule.detected === undefined && !(await looksLikeText(upload.path)))) {
    throw unsupported(
      `Ce type de fichier n'est pas autorisé${ext ? ` (.${ext})` : ''}, ou son contenu ne correspond pas à son extension.`,
    );
  }

  const allowed = ALLOWED_MIMES_BY_PURPOSE[purpose];
  if (allowed && !allowed.includes(rule.mime)) {
    const formats = [...new Set(allowed.map((mime) => FORMATS_BY_MIME[mime] ?? mime))].join(', ');
    throw unsupported(`Ce format n'est pas accepté pour cet usage (formats acceptés : ${formats}).`);
  }

  return { fileName, mime: rule.mime, category: rule.category, size };
}