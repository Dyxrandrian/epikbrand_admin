const MAX_NAME_LENGTH = 200;

/**
 * Certains envois arrivent avec un nom UTF-8 relu comme du latin-1 (« Ã©tÃ© » pour « été »).
 * On ne corrige que si le résultat est du UTF-8 valide : un vrai nom en latin-1 reste intact.
 */
export function fixFilenameEncoding(name: string): string {
  if (/^[\u0000-\u00ff]*$/.test(name) && /[\u0080-\u00ff]/.test(name)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) return decoded;
  }
  return name;
}

function truncate(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  return (
    name
      .slice(0, MAX_NAME_LENGTH - ext.length)
      .replace(/[\ud800-\udbff]$/, '') + // ne jamais couper un emoji en deux
    ext
  );
}

/** Nom sûr à stocker et à renvoyer : sans chemin, sans caractère de contrôle ni de renversement. */
export function sanitizeFileName(raw: string): string {
  let name = fixFilenameEncoding(raw).normalize('NFC');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name
    // contrôles, espaces de largeur nulle, marques bidirectionnelles (RLO : « fdp.exe » affiché « exe.pdf »)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // pas de fichier caché
    .replace(/[. ]+$/, '');
  return truncate(name) || 'fichier';
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** En-tête Content-Disposition avec nom accentué (RFC 5987). */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}