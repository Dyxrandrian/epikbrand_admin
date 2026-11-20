import { MediaPurpose } from '../../enums/app.enums.js';
import { FileCategory } from '../../enums/file.enums.js';

export const MB = 1024 * 1024;
/** Plafond appliqué à la réception ; chaque usage a ensuite sa propre limite. */
export const MAX_UPLOAD_BYTES = 25 * MB;

export const MAX_BYTES_BY_PURPOSE: Record<MediaPurpose, number> = {
  [MediaPurpose.ATTACHMENT]: 25 * MB,
  [MediaPurpose.RECEIPT]: 10 * MB,
  [MediaPurpose.AVATAR]: 5 * MB,
  [MediaPurpose.LOGO]: 5 * MB,
  [MediaPurpose.COVER]: 5 * MB,
};

/** Affichés dans l'interface (<img>) : URL stable, sans en-tête d'authentification. */
export const PUBLIC_PURPOSES: readonly MediaPurpose[] = [
  MediaPurpose.AVATAR,
  MediaPurpose.LOGO,
  MediaPurpose.COVER,
];

/** Un nouvel envoi remplace le précédent (un seul avatar par personne, un seul logo…). */
export const REPLACING_PURPOSES: readonly MediaPurpose[] = PUBLIC_PURPOSES;

const PROFILE_IMAGES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Formats acceptés par usage ; absent = tous les formats autorisés. */
export const ALLOWED_MIMES_BY_PURPOSE: Partial<Record<MediaPurpose, readonly string[]>> = {
  [MediaPurpose.AVATAR]: PROFILE_IMAGES,
  [MediaPurpose.LOGO]: PROFILE_IMAGES,
  [MediaPurpose.COVER]: PROFILE_IMAGES,
  [MediaPurpose.RECEIPT]: [...PROFILE_IMAGES, 'application/pdf'],
};

interface TypeRule {
  /** Types reconnus par la signature du fichier ; absent = fichier texte, sans signature. */
  detected?: readonly string[];
  exts: readonly string[];
  /** Type enregistré et renvoyé au téléchargement. */
  mime: string;
  category: FileCategory;
}

const OOXML = 'application/vnd.openxmlformats-officedocument';
const ODF = 'application/vnd.oasis.opendocument';
// Anciens formats Office : conteneur binaire commun, distingué par l'extension
const CFB = ['application/x-cfb'];

export const TYPE_RULES: readonly TypeRule[] = [
  { detected: ['image/jpeg'], exts: ['jpg', 'jpeg'], mime: 'image/jpeg', category: FileCategory.IMAGE },
  { detected: ['image/png'], exts: ['png'], mime: 'image/png', category: FileCategory.IMAGE },
  { detected: ['image/webp'], exts: ['webp'], mime: 'image/webp', category: FileCategory.IMAGE },
  { detected: ['image/gif'], exts: ['gif'], mime: 'image/gif', category: FileCategory.IMAGE },
  { detected: ['application/pdf'], exts: ['pdf'], mime: 'application/pdf', category: FileCategory.PDF },

  { detected: [`${OOXML}.wordprocessingml.document`], exts: ['docx'], mime: `${OOXML}.wordprocessingml.document`, category: FileCategory.DOCUMENT },
  { detected: [`${ODF}.text`], exts: ['odt'], mime: `${ODF}.text`, category: FileCategory.DOCUMENT },
  { detected: CFB, exts: ['doc'], mime: 'application/msword', category: FileCategory.DOCUMENT },

  { detected: [`${OOXML}.spreadsheetml.sheet`], exts: ['xlsx'], mime: `${OOXML}.spreadsheetml.sheet`, category: FileCategory.SPREADSHEET },
  { detected: [`${ODF}.spreadsheet`], exts: ['ods'], mime: `${ODF}.spreadsheet`, category: FileCategory.SPREADSHEET },
  { detected: CFB, exts: ['xls'], mime: 'application/vnd.ms-excel', category: FileCategory.SPREADSHEET },

  { detected: [`${OOXML}.presentationml.presentation`], exts: ['pptx'], mime: `${OOXML}.presentationml.presentation`, category: FileCategory.PRESENTATION },
  { detected: [`${ODF}.presentation`], exts: ['odp'], mime: `${ODF}.presentation`, category: FileCategory.PRESENTATION },
  { detected: CFB, exts: ['ppt'], mime: 'application/vnd.ms-powerpoint', category: FileCategory.PRESENTATION },

  { detected: ['application/zip'], exts: ['zip'], mime: 'application/zip', category: FileCategory.ARCHIVE },
  { detected: ['application/x-7z-compressed'], exts: ['7z'], mime: 'application/x-7z-compressed', category: FileCategory.ARCHIVE },
  { detected: ['application/x-rar-compressed', 'application/vnd.rar'], exts: ['rar'], mime: 'application/vnd.rar', category: FileCategory.ARCHIVE },
  { detected: ['application/gzip'], exts: ['gz'], mime: 'application/gzip', category: FileCategory.ARCHIVE },

  { exts: ['txt'], mime: 'text/plain', category: FileCategory.TEXT },
  { exts: ['csv'], mime: 'text/csv', category: FileCategory.TEXT },
  { exts: ['md'], mime: 'text/markdown', category: FileCategory.TEXT },
];

/** Seuls ces types peuvent s'afficher dans le navigateur ; tout le reste se télécharge. */
export const INLINE_SAFE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export function findRule(detectedMime: string | undefined, ext: string): TypeRule | undefined {
  return TYPE_RULES.find((rule) =>
    detectedMime === undefined
      ? rule.detected === undefined && rule.exts.includes(ext)
      : rule.detected?.includes(detectedMime) === true && rule.exts.includes(ext),
  );
}

export function categoryOfMime(mime: string): FileCategory {
  return TYPE_RULES.find((rule) => rule.mime === mime)?.category ?? FileCategory.DOCUMENT;
}

export function mimesForCategory(category: FileCategory): string[] {
  return [...new Set(TYPE_RULES.filter((rule) => rule.category === category).map((rule) => rule.mime))];
}