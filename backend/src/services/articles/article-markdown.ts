import type { Block, Inline, TableContent, TextInline } from './article-blocks.js';

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem']);
type Newline = 'break' | 'space' | 'html';

const escapeMarkdown = (text: string): string => text.replace(/[\\`*_[\]<>|~]/g, '\\$&');

const encodeHref = (href: string): string =>
  href.replace(/[()\s]/g, (char) => (char === '(' ? '%28' : char === ')' ? '%29' : '%20'));

/** Garde les espaces de bord hors des marques (**gras** ne tolère pas « ** gras ** »). */
function wrap(text: string, mark: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!match || match[2] === '') return text;
  return `${match[1]}${mark}${match[2]}${mark}${match[3]}`;
}

function textMarkdown(node: TextInline, newline: Newline): string {
  const lineBreak = newline === 'break' ? '  \n' : newline === 'html' ? '<br>' : ' ';

  if (node.styles.code) {
    let code = node.text.replace(/\r?\n/g, ' ').replace(/`/g, "'");
    if (newline === 'html') code = code.replace(/\|/g, '\\|');
    return `\`${code}\``;
  }

  let text = escapeMarkdown(node.text).replace(/\n/g, lineBreak);
  if (node.styles.bold) text = wrap(text, '**');
  if (node.styles.italic) text = wrap(text, '*');
  if (node.styles.strike) text = wrap(text, '~~');
  return text; // le souligné n'a pas d'équivalent Markdown : il est perdu
}

function inlinesMarkdown(items: readonly Inline[], newline: Newline): string {
  return items
    .map((item) => {
      if (item.type === 'text') return textMarkdown(item, newline);
      const inner = item.content.map((node) => textMarkdown(node, newline)).join('');
      return `[${inner}](${encodeHref(item.href)})`;
    })
    .join('');
}

function tableMarkdown(table: TableContent, pad: string): string {
  const rows = table.rows.map((row) =>
    row.cells.map((cell) => inlinesMarkdown(Array.isArray(cell) ? cell : cell.content, 'html')),
  );
  if (rows.length === 0) return '';

  const width = Math.max(1, ...rows.map((row) => row.length));
  const line = (cells: string[]): string =>
    `${pad}| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const separator = `${pad}| ${Array.from({ length: width }, () => '---').join(' | ')} |`;

  const [header, ...body] = rows;
  return [line(header), separator, ...body.map(line)].join('\n');
}

const continued = (text: string, pad: string): string => text.split('\n').join(`\n${pad}`);

function renderBlock(block: Block, pad: string, counter: number): string {
  const inline = Array.isArray(block.content) ? block.content : [];
  const props = block.props ?? {};

  switch (block.type) {
    case 'heading': {
      const level = typeof props.level === 'number' ? Math.min(Math.max(props.level, 1), 6) : 1;
      return `${pad}${'#'.repeat(level)} ${inlinesMarkdown(inline, 'space')}`;
    }
    case 'bulletListItem':
      return `${pad}- ${continued(inlinesMarkdown(inline, 'break'), `${pad}  `)}`;
    case 'numberedListItem':
      return `${pad}${counter}. ${continued(inlinesMarkdown(inline, 'break'), `${pad}   `)}`;
    case 'checkListItem':
      return `${pad}- [${props.checked === true ? 'x' : ' '}] ${continued(inlinesMarkdown(inline, 'break'), `${pad}  `)}`;
    case 'quote':
      return inlinesMarkdown(inline, 'break')
        .split('\n')
        .map((line) => `${pad}> ${line}`)
        .join('\n');
    case 'codeBlock': {
      const text = inline.map((node) => (node.type === 'text' ? node.text : '')).join('');
      const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      const language = typeof props.language === 'string' && props.language !== 'text' ? props.language : '';
      const body = text.split('\n').map((line) => `${pad}${line}`).join('\n');
      return `${pad}${fence}${language}\n${body}\n${pad}${fence}`;
    }
    case 'table':
      return block.content && !Array.isArray(block.content) ? tableMarkdown(block.content, pad) : '';
    case 'image': {
      const url = typeof props.url === 'string' ? props.url : '';
      if (!url) return '';
      const label = [props.caption, props.name].find((v) => typeof v === 'string' && v) as string | undefined;
      return `${pad}![${escapeMarkdown(label ?? '')}](${encodeHref(url)})`;
    }
    case 'divider':
      return `${pad}---`;
    default:
      return `${pad}${continued(inlinesMarkdown(inline, 'break'), pad)}`;
  }
}

function renderBlocks(blocks: readonly Block[], depth: number): string {
  const pad = '  '.repeat(depth);
  let out = '';
  let counter = 0;
  let previous: Block | null = null;

  for (const block of blocks) {
    const isList = LIST_TYPES.has(block.type);
    if (block.type === 'numberedListItem') {
      const start = typeof block.props?.start === 'number' ? block.props.start : 1;
      counter = previous?.type === 'numberedListItem' ? counter + 1 : start;
    }

    const body = renderBlock(block, pad, counter);
    const children = block.children?.length
      ? `${isList ? '\n' : '\n\n'}${renderBlocks(block.children, depth + 1)}`
      : '';

    if (previous) out += LIST_TYPES.has(previous.type) && isList ? '\n' : '\n\n';
    out += body + children;
    previous = block;
  }
  return out;
}

export function blocksToMarkdown(blocks: readonly Block[]): string {
  return `${renderBlocks(blocks, 0).trimEnd()}\n`;
}