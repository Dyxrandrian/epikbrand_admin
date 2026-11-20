import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { Readable } from 'node:stream';
import type { MediaAttachment } from '../../entities/media-attachment.entity.js';
import { contentDisposition } from './file-name.js';
import { INLINE_SAFE_MIMES } from './file-types.js';

export function sendFile(
  res: Response,
  file: MediaAttachment,
  stream: Readable,
  options: { inline: boolean; visibility: 'public' | 'private' },
): StreamableFile {
  // Jamais d'affichage dans le navigateur pour un type qui pourrait exécuter du code
  const inline = options.inline && INLINE_SAFE_MIMES.has(file.fileType);

  res.setHeader(
    'Content-Type',
    file.fileType.startsWith('text/') ? `${file.fileType}; charset=utf-8` : file.fileType,
  );
  res.setHeader('Content-Length', String(file.fileSize));
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.fileName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader(
    'Cache-Control',
    // Un nouvel envoi crée un nouvel identifiant : une URL publique ne change jamais de contenu
    options.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
  );
  return new StreamableFile(stream);
}