import { randomUUID } from 'node:crypto';
import { BusinessRuleException, ErrorCode, ValidationFailedException } from '../../exceptions/index.js';
import type { ErrorDetail } from '../../exceptions/index.js';
import { privateFileIdFromUrl } from '../files/file-paths.js';

export const MAX_CONTENT_BYTES = 1_000_000;
const MAX_BLOCKS = 3000;
const MAX_DEPTH = 8;
const MAX_TEXT_LENGTH = 100_000;
const MAX_PLAIN_TEXT = 100_000;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 30;
const MAX_PROBLEMS = 20;

const COLOR = /^(?:[a-z]{3,20}|#[0-9A-Fa-f]{3,8})$/;
const LANGUAGE = /^[A-Za-z0-9_+#.-]{1,30}$/;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HREF = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

// ---------- Types (format BlockNote) ----------

export interface TextStyles {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  textColor?: string;
  backgroundColor?: string;
}
export interface TextInline {
  type: 'text';
  text: string;
  styles: TextStyles;
}
export interface LinkInline {
  type: 'link';
  href: string;
  content: TextInline[];
}
export type Inline = TextInline | LinkInline;
export interface TableCell {
  type: 'tableCell';
  props: Record<string, unknown>;
  content: Inline[];
}
export interface TableContent {
  type: 'tableContent';
  columnWidths?: Array<number | null>;
  headerRows?: number;
  headerCols?: number;
  rows: Array<{ cells: Array<Inline[] | TableCell> }>;
}
export interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: Inline[] | TableContent;
  children: Block[];
}

// ---------- Blocs et propriétés autorisés ----------

type ContentKind = 'inline' | 'code' | 'table' | 'none';
type PropKind =
  | 'color' | 'align' | 'level' | 'boolean' | 'start'
  | 'language' | 'caption' | 'name' | 'width' | 'imageUrl';

const TEXT_PROPS: Record<string, PropKind> = {
  textColor: 'color',
  backgroundColor: 'color',
  textAlignment: 'align',
};

const BLOCKS: Record<string, { content: ContentKind; props: Record<string, PropKind> }> = {
  paragraph: { content: 'inline', props: TEXT_PROPS },
  heading: { content: 'inline', props: { ...TEXT_PROPS, level: 'level', isToggleable: 'boolean' } },
  bulletListItem: { content: 'inline', props: TEXT_PROPS },
  numberedListItem: { content: 'inline', props: { ...TEXT_PROPS, start: 'start' } },
  checkListItem: { content: 'inline', props: { ...TEXT_PROPS, checked: 'boolean' } },
  quote: { content: 'inline', props: TEXT_PROPS },
  codeBlock: { content: 'code', props: { language: 'language' } },
  table: { content: 'table', props: { textColor: 'color' } },
  image: {
    content: 'none',
    props: {
      url: 'imageUrl',
      caption: 'caption',
      name: 'name',
      showPreview: 'boolean',
      previewWidth: 'width',
      textAlignment: 'align',
    },
  },
  divider: { content: 'none', props: {} },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Retient tabulation et saut de ligne ; retire les autres caractères de contrôle. */
const cleanText = (value: string): string =>
  value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');

class Normalizer {
  readonly problems: ErrorDetail[] = [];
  readonly imageIds = new Set<string>();
  private readonly usedIds = new Set<string>();
  private count = 0;

  fail(field: string, reason: string, message: string): void {
    if (this.problems.length < MAX_PROBLEMS) this.problems.push({ field, reason, message });
  }

  blocks(input: unknown, path: string, depth: number): Block[] {
    if (!Array.isArray(input)) {
      this.fail(path, 'invalidBlocks', 'Une liste de blocs est attendue.');
      return [];
    }
    if (depth > MAX_DEPTH) {
      this.fail(path, 'tooDeep', `Les blocs ne peuvent pas être imbriqués sur plus de ${MAX_DEPTH} niveaux.`);
      return [];
    }
    const out: Block[] = [];
    input.forEach((raw, index) => {
      const block = this.block(raw, `${path}[${index}]`, depth);
      if (block) out.push(block);
    });
    return out;
  }

  private block(raw: unknown, path: string, depth: number): Block | null {
    this.count += 1;
    if (this.count === MAX_BLOCKS + 1) {
      this.fail(path, 'tooManyBlocks', `Un article ne peut pas contenir plus de ${MAX_BLOCKS} blocs.`);
    }
    if (this.count > MAX_BLOCKS) return null;

    if (!isRecord(raw)) {
      this.fail(path, 'invalidBlock', 'Un bloc doit être un objet.');
      return null;
    }
    const type = raw.type;
    if (typeof type !== 'string' || !Object.hasOwn(BLOCKS, type)) {
      this.fail(`${path}.type`, 'unsupportedBlock', `Type de bloc non pris en charge : ${String(type)}.`);
      return null;
    }

    const definition = BLOCKS[type];
    const props = this.props(raw.props, definition.props, `${path}.props`);
    const content = this.content(raw.content, definition.content, `${path}.content`);
    const children =
      raw.children === undefined || raw.children === null
        ? []
        : this.blocks(raw.children, `${path}.children`, depth + 1);

    const block: Block = { id: this.blockId(raw.id), type, props, children };
    if (content !== undefined) block.content = content;
    return block;
  }

  private blockId(raw: unknown): string {
    const wanted = typeof raw === 'string' && BLOCK_ID.test(raw) ? raw : null;
    const id = wanted && !this.usedIds.has(wanted) ? wanted : randomUUID();
    this.usedIds.add(id);
    return id;
  }

  /** Les propriétés inconnues sont retirées sans erreur : une nouvelle propriété de l'éditeur ne bloque rien. */
  private props(
    raw: unknown,
    allowed: Record<string, PropKind>,
    path: string,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (raw === undefined || raw === null) return out;
    if (!isRecord(raw)) {
      this.fail(path, 'invalidProps', 'Les propriétés du bloc doivent être un objet.');
      return out;
    }
    for (const [key, kind] of Object.entries(allowed)) {
      if (!Object.hasOwn(raw, key) || raw[key] === undefined || raw[key] === null) continue;
      const clean = this.prop(kind, raw[key], `${path}.${key}`);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  private prop(kind: PropKind, value: unknown, path: string): unknown {
    const bad = (message: string): undefined => {
      this.fail(path, 'invalidProp', message);
      return undefined;
    };

    switch (kind) {
      case 'color':
        return typeof value === 'string' && COLOR.test(value) ? value : bad('Couleur invalide.');
      case 'align':
        return typeof value === 'string' && ALIGNMENTS.has(value) ? value : bad('Alignement invalide.');
      case 'level':
        return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6
          ? value
          : bad('Le niveau de titre doit être un entier de 1 à 6.');
      case 'boolean':
        return typeof value === 'boolean' ? value : bad('Un booléen est attendu.');
      case 'start':
        return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1_000_000
          ? value
          : bad('Numéro de départ invalide.');
      case 'language':
        return typeof value === 'string' && LANGUAGE.test(value) ? value : bad('Langage invalide.');
      case 'caption':
      case 'name': {
        const max = kind === 'caption' ? 500 : 255;
        if (typeof value !== 'string') return bad('Un texte est attendu.');
        const text = cleanText(value);
        return text.length <= max ? text : bad(`Texte trop long (${max} caractères au plus).`);
      }
      case 'width':
        return Number.isInteger(value) && (value as number) >= 16 && (value as number) <= 4000
          ? value
          : bad('Largeur invalide (16 à 4000).');
      case 'imageUrl': {
        if (typeof value !== 'string') return bad("L'adresse de l'image doit être un texte.");
        if (value === '') return ''; // bloc image encore vide (avant l'envoi du fichier)
        const fileId = privateFileIdFromUrl(value);
        if (!fileId) {
          return bad(
            "Les images doivent être des fichiers joints à l'article (envoyez-les avec POST /files, puis utilisez l'url renvoyée).",
          );
        }
        this.imageIds.add(fileId);
        return value;
      }
    }
  }

  private content(
    raw: unknown,
    kind: ContentKind,
    path: string,
  ): Inline[] | TableContent | undefined {
    switch (kind) {
      case 'none':
        return undefined;
      case 'inline':
        return this.inlines(raw, path, { rich: true, links: true });
      case 'code':
        return this.inlines(raw, path, { rich: false, links: false });
      case 'table':
        return this.table(raw, path);
    }
  }

  private inlines(
    raw: unknown,
    path: string,
    options: { rich: boolean; links: boolean },
  ): Inline[] {
    if (raw === undefined || raw === null) return [];
    if (typeof raw === 'string') {
      return raw ? [{ type: 'text', text: cleanText(raw), styles: {} }] : [];
    }
    if (!Array.isArray(raw)) {
      this.fail(path, 'invalidContent', 'Le contenu du bloc doit être une liste.');
      return [];
    }

    const out: Inline[] = [];
    raw.forEach((item, index) => {
      const here = `${path}[${index}]`;
      if (!isRecord(item)) {
        this.fail(here, 'invalidInline', 'Un élément de texte doit être un objet.');
        return;
      }
      if (item.type === 'text') {
        const node = this.textNode(item, here, options.rich);
        if (node) out.push(node);
      } else if (item.type === 'link' && options.links) {
        const href = typeof item.href === 'string' ? item.href.trim() : '';
        if (!HREF.test(href) || href.length > 2000 || /[\u0000-\u001f\u007f]/.test(href)) {
          this.fail(`${here}.href`, 'invalidLink', 'Adresse de lien non autorisée (http, https, mailto, tel, chemin interne ou ancre).');
          return;
        }
        const content = this.inlines(item.content, `${here}.content`, { rich: true, links: false });
        out.push({
          type: 'link',
          href,
          content: content.filter((node): node is TextInline => node.type === 'text'),
        });
      } else {
        this.fail(`${here}.type`, 'unsupportedInline', `Élément de texte non pris en charge : ${String(item.type)}.`);
      }
    });
    return out;
  }

  private textNode(item: Record<string, unknown>, path: string, rich: boolean): TextInline | null {
    if (typeof item.text !== 'string') {
      this.fail(`${path}.text`, 'invalidText', 'Un texte est attendu.');
      return null;
    }
    const text = cleanText(item.text);
    if (text.length > MAX_TEXT_LENGTH) {
      this.fail(`${path}.text`, 'textTooLong', `Texte trop long (${MAX_TEXT_LENGTH} caractères au plus).`);
      return null;
    }
    return { type: 'text', text, styles: rich ? this.styles(item.styles, `${path}.styles`) : {} };
  }

  private styles(raw: unknown, path: string): TextStyles {
    const out: TextStyles = {};
    if (!isRecord(raw)) return out;

    for (const key of ['bold', 'italic', 'underline', 'strike', 'code'] as const) {
      if (raw[key] === true) out[key] = true;
    }
    for (const key of ['textColor', 'backgroundColor'] as const) {
      const value = raw[key];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && COLOR.test(value)) out[key] = value;
      else this.fail(`${path}.${key}`, 'invalidProp', 'Couleur invalide.');
    }
    return out;
  }

  private table(raw: unknown, path: string): TableContent | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!isRecord(raw) || raw.type !== 'tableContent' || !Array.isArray(raw.rows)) {
      this.fail(path, 'invalidTable', 'Le contenu d’un tableau doit être de type tableContent, avec des lignes.');
      return undefined;
    }
    if (raw.rows.length === 0 || raw.rows.length > MAX_TABLE_ROWS) {
      this.fail(`${path}.rows`, 'invalidTable', `Un tableau contient de 1 à ${MAX_TABLE_ROWS} lignes.`);
      return undefined;
    }

    const table: TableContent = { type: 'tableContent', rows: [] };

    if (Array.isArray(raw.columnWidths)) {
      table.columnWidths = raw.columnWidths
        .slice(0, MAX_TABLE_COLUMNS)
        .map((width) => (typeof width === 'number' && width > 0 && width < 5000 ? width : null));
    }
    for (const key of ['headerRows', 'headerCols'] as const) {
      const value = raw[key];
      if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_TABLE_ROWS) {
        table[key] = value as number;
      }
    }

    raw.rows.forEach((row, rowIndex) => {
      const here = `${path}.rows[${rowIndex}]`;
      if (!isRecord(row) || !Array.isArray(row.cells) || row.cells.length === 0 || row.cells.length > MAX_TABLE_COLUMNS) {
        this.fail(here, 'invalidTable', `Une ligne de tableau contient de 1 à ${MAX_TABLE_COLUMNS} cellules.`);
        return;
      }
      const cells = row.cells.map((cell, cellIndex): Inline[] | TableCell => {
        const cellPath = `${here}.cells[${cellIndex}]`;
        if (Array.isArray(cell) || typeof cell === 'string' || cell === null || cell === undefined) {
          return this.inlines(cell, cellPath, { rich: true, links: true });
        }
        if (isRecord(cell) && cell.type === 'tableCell') {
          return {
            type: 'tableCell',
            props: this.cellProps(cell.props, `${cellPath}.props`),
            content: this.inlines(cell.content, `${cellPath}.content`, { rich: true, links: true }),
          };
        }
        this.fail(cellPath, 'invalidTable', 'Cellule de tableau invalide.');
        return [];
      });
      table.rows.push({ cells });
    });
    return table;
  }

  private cellProps(raw: unknown, path: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!isRecord(raw)) return out;
    for (const [key, kind] of [
      ['backgroundColor', 'color'],
      ['textColor', 'color'],
      ['textAlignment', 'align'],
    ] as const) {
      if (raw[key] === undefined || raw[key] === null) continue;
      const clean = this.prop(kind, raw[key], `${path}.${key}`);
      if (clean !== undefined) out[key] = clean;
    }
    for (const key of ['colspan', 'rowspan'] as const) {
      const value = raw[key];
      if (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_TABLE_COLUMNS) {
        out[key] = value;
      }
    }
    return out;
  }
}

// ---------- API publique ----------

export interface NormalizedBlocks {
  blocks: Block[];
  /** Fichiers référencés par des blocs image. */
  imageIds: Set<string>;
}

/** Valide et normalise le contenu envoyé par l'éditeur (400 avec le chemin de chaque problème). */
export function normalizeBlocks(input: unknown): NormalizedBlocks {
  const normalizer = new Normalizer();
  const blocks = normalizer.blocks(input, 'content', 0);
  if (normalizer.problems.length > 0) throw new ValidationFailedException(normalizer.problems);
  return { blocks, imageIds: normalizer.imageIds };
}

/** Retire les blocs image dont le fichier n'existe plus (les enfants sont conservés). */
export function dropImages(
  blocks: readonly Block[],
  ids: ReadonlySet<string>,
): { blocks: Block[]; dropped: number } {
  let dropped = 0;
  const walk = (list: readonly Block[]): Block[] =>
    list.flatMap((block) => {
      const children = walk(block.children ?? []);
      if (block.type === 'image' && typeof block.props?.url === 'string') {
        const id = privateFileIdFromUrl(block.props.url);
        if (id && ids.has(id)) {
          dropped += 1;
          return children;
        }
      }
      return [{ ...block, children }];
    });
  return { blocks: walk(blocks), dropped };
}

const inlineText = (items: readonly Inline[]): string =>
  items.map((item) => (item.type === 'text' ? item.text : inlineText(item.content))).join('');

/** Texte brut du document, pour la recherche. */
export function plainTextOf(blocks: readonly Block[]): string {
  const lines: string[] = [];

  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      const content = block.content;
      if (Array.isArray(content)) {
        const text = inlineText(content);
        if (text.trim()) lines.push(text);
      } else if (content && content.type === 'tableContent') {
        for (const row of content.rows) {
          const text = row.cells
            .map((cell) => inlineText(Array.isArray(cell) ? cell : cell.content))
            .filter(Boolean)
            .join(' ');
          if (text.trim()) lines.push(text);
        }
      }
      if (block.type === 'image') {
        for (const key of ['caption', 'name']) {
          const value = block.props?.[key];
          if (typeof value === 'string' && value.trim()) lines.push(value);
        }
      }
      walk(block.children ?? []);
    }
  };
  walk(blocks);
  return lines.join('\n').slice(0, MAX_PLAIN_TEXT);
}

export function serializeBlocks(blocks: readonly Block[]): string {
  const json = JSON.stringify(blocks);
  if (Buffer.byteLength(json, 'utf8') > MAX_CONTENT_BYTES) {
    throw new BusinessRuleException(
      `Le contenu de l'article dépasse ${MAX_CONTENT_BYTES / 1_000_000} Mo : scindez-le en plusieurs articles.`,
      ErrorCode.CONTENT_TOO_LARGE,
    );
  }
  return json;
}

/** Contenu enregistré vers blocs. Un texte brut ancien devient un paragraphe. */
export function parseStoredContent(text: string): Block[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as Block[];
  } catch {
    // contenu ancien, non JSON
  }
  return text.trim()
    ? [
        {
          id: randomUUID(),
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text, styles: {} }],
          children: [],
        },
      ]
    : [];
}