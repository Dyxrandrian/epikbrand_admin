import PDFDocument from 'pdfkit';
import { InvoiceDocumentType, InvoicePaymentStatus } from '../../../enums/app.enums.js';
import type { InvoiceDetail } from '../../../mapper/invoice.mapper.js';
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  moneyDecimals,
  pdfSafe,
} from './pdf-format.js';
import { PDF_LAYOUT, PDF_TEXT, currencySymbol } from './pdf-theme.js';
import type { PdfTheme } from './pdf-theme.js';

type Doc = InstanceType<typeof PDFDocument>;
type Align = 'left' | 'right' | 'center';
type FontKind = 'regular' | 'bold';
type Item = InvoiceDetail['items'][number];

interface Column {
  key: 'description' | 'quantity' | 'unitPrice' | 'vat' | 'discount' | 'total';
  label: string;
  width: number;
  align: Align;
}

interface TotalsRow {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  muted?: boolean;
}

interface OpenedImage {
  width: number;
  height: number;
}

export interface PdfRenderOptions {
  theme: PdfTheme;
  /** JPEG ou PNG ; null = pas de logo. */
  logo: Buffer | null;
}

const M = PDF_LAYOUT.margin;
const SIZE = PDF_LAYOUT.fontSize;
const TOTALS_WIDTH = 270;
const HEADER_HEIGHT = 22;
const { INVOICE, QUOTE } = InvoiceDocumentType;
const { DRAFT, CANCELLED, PAID } = InvoicePaymentStatus;

export function renderInvoicePdf(detail: InvoiceDetail, options: PdfRenderOptions): Promise<Buffer> {
  return new InvoicePdfRenderer(detail, options).render();
}

class InvoicePdfRenderer {
  private readonly doc: Doc;
  private readonly colors: PdfTheme['colors'];
  private readonly width: number;
  private readonly decimals: 0 | 2;
  private readonly symbol: string;
  private cols: Column[] = [];
  private y: number = M;

  constructor(
    private readonly d: InvoiceDetail,
    private readonly options: PdfRenderOptions,
  ) {
    this.colors = options.theme.colors;
    this.symbol = currencySymbol(d.currency);
    this.decimals = moneyDecimals([
      d.subtotal_ht,
      d.discount_amount,
      d.total_ht,
      d.total_vat,
      d.total_ttc,
      d.amount_paid,
      d.credited_total,
      d.balance_due,
      d.refund_due,
      ...d.items.flatMap((item) => [
        item.unit_price,
        item.total_ht,
        item.discount_amount,
        item.discount_type === 'amount' ? item.discount_value : 0,
      ]),
      ...d.vat_breakdown.flatMap((group) => [group.base_ht, group.vat]),
    ]);

    this.doc = new PDFDocument({
      size: 'A4',
      // La marge basse réserve la zone du pied de page : les sauts de page automatiques la respectent
      margins: { top: M, bottom: M + PDF_LAYOUT.footerHeight, left: M, right: M },
      bufferPages: true,
      info: {
        Title: `${PDF_TEXT.title[d.type]} ${d.invoice_number ?? ''}`.trim(),
        Author: d.seller.name,
      },
    });
    this.width = this.doc.page.width - 2 * M;

    const { fonts } = options.theme;
    if (fonts.files) {
      this.doc.registerFont(fonts.regular, fonts.files.regular);
      this.doc.registerFont(fonts.bold, fonts.files.bold);
    }
  }

  async render(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const finished = new Promise<Buffer>((resolve, reject) => {
      this.doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      this.doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.doc.on('error', reject);
    });

    try {
      this.drawHeader();
      this.drawParties();
      this.drawTable();
      this.drawSummary();
      this.drawTextSection(PDF_TEXT.sections.notes, this.d.notes);
      this.drawTextSection(PDF_TEXT.sections.paymentTerms, this.d.payment_terms);
      this.drawFooters();
    } catch (error) {
      this.doc.end();
      throw error;
    }
    this.doc.end();
    return finished;
  }

  // ---------- Outils ----------

  private get bottom(): number {
    return this.doc.page.height - M - PDF_LAYOUT.footerHeight;
  }

  private safe(value: string | null | undefined): string {
    return pdfSafe(value, this.options.theme.fonts.custom);
  }

  private money(value: number): string {
    return `${formatMoney(value, this.decimals)} ${this.symbol}`;
  }

  private font(kind: FontKind, size: number, color: string): void {
    this.doc.font(this.options.theme.fonts[kind]).fontSize(size).fillColor(color);
  }

  /** Écrit un texte et renvoie l'ordonnée de sa fin. */
  private text(value: string, x: number, y: number, width: number, align: Align = 'left'): number {
    this.doc.text(value, x, y, { width, align });
    return this.doc.y;
  }

  private height(value: string, width: number): number {
    return this.doc.heightOfString(value, { width });
  }

  private lines(
    values: ReadonlyArray<string | null | undefined>,
    x: number,
    y: number,
    width: number,
  ): number {
    let cursor = y;
    for (const value of values) {
      const text = this.safe(value);
      if (text) cursor = this.text(text, x, cursor, width) + 1;
    }
    return cursor;
  }

  private ensureSpace(height: number, repeatTableHeader = false): void {
    if (this.y + height <= this.bottom) return;
    this.doc.addPage();
    this.y = M;
    if (repeatTableHeader) this.drawTableHeader();
  }

  private labelled(label: string, value: string | null | undefined): string | null {
    return value ? `${label} : ${value}` : null;
  }

  // ---------- En-tête : logo et vendeur à gauche, titre à droite ----------

  private drawHeader(): void {
    const { d } = this;
    const leftW = this.width * 0.56;
    const rightX = M + this.width * 0.6;
    const rightW = this.width * 0.4;

    let ly = M;
    const logoHeight = this.drawLogo(M, ly);
    if (logoHeight > 0) ly += logoHeight + 10;

    this.font('bold', SIZE.heading + 1, this.colors.primary);
    ly = this.text(this.safe(d.seller.name), M, ly, leftW) + 4;

    this.font('regular', SIZE.body, this.colors.text);
    ly = this.lines([d.seller.address, d.seller.phone, d.seller.website_url], M, ly, leftW) + 4;

    this.font('regular', SIZE.small, this.colors.muted);
    ly = this.lines(
      [
        this.labelled('NIF', d.seller.nif),
        this.labelled('STAT', d.seller.stat),
        this.labelled('RCS', d.seller.rcs),
        d.seller.tax_info,
      ],
      M,
      ly,
      leftW,
    );

    this.font('bold', SIZE.title, this.colors.primary);
    let ry = this.text(PDF_TEXT.title[d.type], rightX, M, rightW, 'right') + 2;

    this.font('bold', SIZE.heading, this.colors.text);
    ry =
      this.text(
        d.invoice_number ? `N° ${this.safe(d.invoice_number)}` : PDF_TEXT.draftNumber,
        rightX,
        ry,
        rightW,
        'right',
      ) + 2;

    const status = this.statusLabel();
    if (status) {
      this.font('bold', SIZE.body + 0.5, this.colors.primary);
      ry = this.text(status, rightX, ry + 3, rightW, 'right');
    }

    this.y = Math.max(ly, ry) + 24;
  }

  /** JPEG ou PNG. Un logo illisible est ignoré : le document s'imprime sans. */
  private drawLogo(x: number, y: number): number {
    const logo = this.options.logo;
    if (!logo) return 0;
    try {
      const opened = (this.doc as unknown as { openImage(src: Buffer): OpenedImage }).openImage(logo);
      const scale = Math.min(
        PDF_LAYOUT.logoMaxWidth / opened.width,
        PDF_LAYOUT.logoMaxHeight / opened.height,
        1,
      );
      this.doc.image(logo, x, y, { width: opened.width * scale });
      return opened.height * scale;
    } catch {
      return 0;
    }
  }

  private statusLabel(): string | null {
    const { d } = this;
    const s = PDF_TEXT.status;
    if (d.status === DRAFT) return s.draft;
    if (d.status === CANCELLED) return d.type === INVOICE ? s.cancelledInvoice : s.cancelled;
    if (d.type === INVOICE && d.status === PAID) return s.paid;
    if (d.type === QUOTE) {
      if (d.rejected_at) return s.rejected;
      if (d.accepted_at) return s.accepted;
      if (d.is_expired) return s.expired;
    }
    if (d.is_overdue) return s.overdue;
    return null;
  }

  // ---------- Références à gauche, cadre client à droite ----------

  private metaRows(): Array<[string, string]> {
    const { d } = this;
    const m = PDF_TEXT.meta;
    const rows: Array<[string, string]> = [[m.issueDate, formatDate(d.issue_date)]];
    if (d.type === INVOICE && d.due_date) rows.push([m.dueDate, formatDate(d.due_date)]);
    if (d.type === QUOTE && d.valid_until) rows.push([m.validUntil, formatDate(d.valid_until)]);
    if (d.source?.invoice_number) {
      rows.push([d.source.type === QUOTE ? m.sourceQuote : m.sourceInvoice, d.source.invoice_number]);
    }
    if (d.project) rows.push([m.project, d.project.title]);
    return rows;
  }

  private drawParties(): void {
    const { d } = this;
    const top = this.y;
    const leftW = this.width * 0.46;
    const labelW = 104;
    const boxX = M + this.width * 0.52;
    const boxW = this.width * 0.48;
    const pad = 10;

    // Références
    let ly = top;
    for (const [label, value] of this.metaRows()) {
      this.font('regular', SIZE.body, this.colors.muted);
      this.doc.text(label, M, ly, { width: labelW, lineBreak: false });
      this.font('bold', SIZE.body, this.colors.text);
      const end = this.text(this.safe(value), M + labelW, ly, leftW - labelW);
      ly = Math.max(end, ly + SIZE.body + 2) + 3;
    }

    // Client (données figées à l'émission)
    const c = d.client_details;
    const entries: Array<{ text: string; bold: boolean }> = [
      { text: this.safe(c.company_name), bold: true },
      { text: this.safe(c.contact_name), bold: false },
      { text: this.safe(c.address), bold: false },
      { text: this.safe(c.phone), bold: false },
      { text: this.safe(c.email), bold: false },
      { text: this.safe(this.labelled('NIF', c.nif)), bold: false },
      { text: this.safe(this.labelled('STAT', c.stat)), bold: false },
    ].filter((entry) => entry.text.length > 0);

    this.font('bold', SIZE.small, this.colors.muted);
    this.doc.text(this.safe(PDF_TEXT.clientHeading[d.type]), boxX, top, {
      width: boxW,
      lineBreak: false,
    });

    let contentH = 0;
    for (const entry of entries) {
      this.font(entry.bold ? 'bold' : 'regular', SIZE.body, this.colors.text);
      contentH += this.height(entry.text, boxW - 2 * pad) + 2;
    }
    const boxTop = top + 14;
    const boxH = contentH + 2 * pad - 2;

    this.doc.lineWidth(0.7).strokeColor(this.colors.border).roundedRect(boxX, boxTop, boxW, boxH, 3).stroke();

    let cy = boxTop + pad;
    for (const entry of entries) {
      this.font(entry.bold ? 'bold' : 'regular', SIZE.body, this.colors.text);
      cy = this.text(entry.text, boxX + pad, cy, boxW - 2 * pad) + 2;
    }

    this.y = Math.max(ly, boxTop + boxH) + 22;
  }

  // ---------- Tableau des lignes ----------

  private columns(): Column[] {
    const t = PDF_TEXT.table;
    const hasDiscount = this.d.items.some((item) => item.discount_amount > 0);

    const fixed: Column[] = [
      { key: 'quantity', label: t.quantity, width: 70, align: 'right' },
      { key: 'unitPrice', label: t.unitPrice, width: 76, align: 'right' },
      { key: 'vat', label: t.vat, width: 44, align: 'right' },
    ];
    if (hasDiscount) fixed.push({ key: 'discount', label: t.discount, width: 58, align: 'right' });
    fixed.push({ key: 'total', label: t.total, width: 84, align: 'right' });

    const used = fixed.reduce((sum, column) => sum + column.width, 0);
    return [{ key: 'description', label: t.description, width: this.width - used, align: 'left' }, ...fixed];
  }

  private drawTableHeader(): void {
    const pad = PDF_LAYOUT.rowPadding;
    this.doc.rect(M, this.y, this.width, HEADER_HEIGHT).fill(this.colors.tableHeaderBg);
    this.font('bold', SIZE.small, this.colors.tableHeaderText);

    let x = M;
    for (const column of this.cols) {
      this.doc.text(column.label, x + pad, this.y + 7, {
        width: column.width - 2 * pad,
        align: column.align,
        lineBreak: false,
      });
      x += column.width;
    }
    this.y += HEADER_HEIGHT;
  }

  private cell(item: Item, key: Column['key']): string {
    switch (key) {
      case 'quantity':
        return `${formatQuantity(item.quantity)}${item.unit ? ` ${this.safe(item.unit)}` : ''}`;
      case 'unitPrice':
        return formatMoney(item.unit_price, this.decimals);
      case 'vat':
        return formatPercent(item.vat_rate);
      case 'discount':
        if (item.discount_amount <= 0) return '';
        return item.discount_type === 'percent'
          ? formatPercent(item.discount_value / 100)
          : formatMoney(item.discount_amount, this.decimals);
      case 'total':
        return formatMoney(item.total_ht, this.decimals);
      default:
        return '';
    }
  }

  private drawTable(): void {
    this.cols = this.columns();
    const pad = PDF_LAYOUT.rowPadding;
    const descriptionColumn = this.cols[0];

    this.ensureSpace(HEADER_HEIGHT + 40);
    this.drawTableHeader();

    for (const item of this.d.items) {
      const description = this.safe(item.description);
      this.font('regular', SIZE.body, this.colors.text);
      const rowH =
        Math.max(this.height(description, descriptionColumn.width - 2 * pad), SIZE.body) + 2 * pad;

      this.ensureSpace(rowH, true);
      this.font('regular', SIZE.body, this.colors.text); // la police est reposée après un saut de page

      let x = M;
      for (const column of this.cols) {
        const value = column.key === 'description' ? description : this.cell(item, column.key);
        if (value) {
          this.doc.text(value, x + pad, this.y + pad, {
            width: column.width - 2 * pad,
            align: column.align,
            lineBreak: column.key === 'description',
          });
        }
        x += column.width;
      }

      this.y += rowH;
      this.doc
        .moveTo(M, this.y)
        .lineTo(M + this.width, this.y)
        .lineWidth(0.5)
        .strokeColor(this.colors.border)
        .stroke();
    }
    this.y += 16;
  }

  // ---------- Totaux à droite, moyens de paiement à gauche ----------

  private totalsRows(): TotalsRow[] {
    const { d } = this;
    const t = PDF_TEXT.totals;
    const rows: TotalsRow[] = [];

    if (d.discount_amount > 0) {
      const percent = d.discount_type === 'percent' ? ` (${formatPercent(d.discount_value / 100)})` : '';
      rows.push({ label: t.subtotal, value: this.money(d.subtotal_ht) });
      rows.push({ label: `${t.discount}${percent}`, value: `-${this.money(d.discount_amount)}` });
    }
    rows.push({ label: t.totalHt, value: this.money(d.total_ht), bold: true });

    for (const group of d.vat_breakdown) {
      rows.push({ label: `${t.vat} ${formatPercent(group.rate)}`, value: this.money(group.vat) });
    }
    if (d.vat_breakdown.length === 0) rows.push({ label: t.vat, value: this.money(0) });

    rows.push({ label: t.totalTtc, value: this.money(d.total_ttc), highlight: true });

    if (d.type === INVOICE && (d.amount_paid > 0 || d.credited_total > 0)) {
      if (d.amount_paid > 0) rows.push({ label: t.paid, value: `-${this.money(d.amount_paid)}` });
      if (d.credited_total > 0) {
        rows.push({ label: t.credited, value: `-${this.money(d.credited_total)}` });
      }
      rows.push({ label: t.balance, value: this.money(d.balance_due), bold: true });
      if (d.refund_due > 0) rows.push({ label: t.refund, value: this.money(d.refund_due), bold: true });
    }
    return rows;
  }

  private paymentMethodLines(): string[] {
    const { d } = this;
    if (d.type !== INVOICE || d.status === CANCELLED || !(d.balance_due > 0)) return [];

    const p = PDF_TEXT.payment;
    const s = d.seller;
    return [
      this.labelled(p.bank, s.bank_name),
      this.labelled(p.holder, s.bank_account_holder),
      this.labelled(p.account, s.bank_account_number),
      this.labelled(p.swift, s.bank_swift),
      this.labelled(p.mobile, s.mobile_money_details),
    ]
      .map((line) => this.safe(line))
      .filter((line) => line.length > 0);
  }

  private drawSummary(): void {
    const rows = this.totalsRows();
    const rowH = 18;
    const highlightH = 26;
    const totalsH = rows.reduce((sum, row) => sum + (row.highlight ? highlightH : rowH), 0);

    const methods = this.paymentMethodLines();
    const leftW = this.width - TOTALS_WIDTH - 24;
    let leftH = 0;
    if (methods.length > 0) {
      leftH = 16;
      this.font('regular', SIZE.body, this.colors.text);
      for (const line of methods) leftH += this.height(line, leftW) + 2;
    }

    const blockH = Math.max(totalsH, leftH);
    this.ensureSpace(blockH + 10);
    const top = this.y;

    // Moyens de paiement
    if (methods.length > 0) {
      this.font('bold', SIZE.body, this.colors.primary);
      let ly = this.text(PDF_TEXT.payment.heading, M, top, leftW) + 3;
      this.font('regular', SIZE.body, this.colors.text);
      for (const line of methods) ly = this.text(line, M, ly, leftW) + 2;
    }

    // Totaux
    const x = M + this.width - TOTALS_WIDTH;
    let ry = top;
    for (const row of rows) {
      const h = row.highlight ? highlightH : rowH;
      const size = row.highlight ? SIZE.heading : SIZE.body;
      if (row.highlight) this.doc.rect(x, ry, TOTALS_WIDTH, h).fill(this.colors.highlightBg);

      const color = row.highlight
        ? this.colors.highlightText
        : row.muted
          ? this.colors.muted
          : this.colors.text;
      this.font(row.bold || row.highlight ? 'bold' : 'regular', size, color);

      const ty = ry + (h - size) / 2 - 1;
      this.doc.text(row.label, x + 8, ty, { width: TOTALS_WIDTH * 0.5 - 8, lineBreak: false });
      this.doc.text(row.value, x + TOTALS_WIDTH * 0.5, ty, {
        width: TOTALS_WIDTH * 0.5 - 8,
        align: 'right',
        lineBreak: false,
      });
      ry += h;
    }

    this.y = top + blockH + 18;
  }

  // ---------- Notes et conditions (pleine largeur, peuvent se poursuivre sur la page suivante) ----------

  private drawTextSection(title: string, body: string | null): void {
    const content = this.safe(body);
    if (!content) return;

    this.font('regular', SIZE.body, this.colors.text);
    this.ensureSpace(14 + Math.min(this.height(content, this.width), 48));

    this.font('bold', SIZE.body, this.colors.primary);
    this.y = this.text(title, M, this.y, this.width) + 2;
    this.font('regular', SIZE.body, this.colors.text);
    this.y = this.text(content, M, this.y, this.width) + 12;
  }

  // ---------- Pied de page, dessiné sur toutes les pages une fois leur nombre connu ----------

  private drawFooters(): void {
    const { d } = this;
    const footerText = this.safe(d.footer ?? d.seller.invoice_footer);
    const legal = this.safe(
      [
        d.seller.name,
        this.labelled('NIF', d.seller.nif),
        this.labelled('STAT', d.seller.stat),
        this.labelled('RCS', d.seller.rcs),
      ]
        .filter(Boolean)
        .join('  ·  '),
    );

    const range = this.doc.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      this.doc.switchToPage(range.start + index);
      const page = this.doc.page;

      // La zone du pied de page est dans la marge basse : on la libère le temps d'y écrire
      const savedBottom = page.margins.bottom;
      page.margins.bottom = 0;

      const zoneTop = page.height - M - PDF_LAYOUT.footerHeight;
      this.doc
        .moveTo(M, zoneTop + 6)
        .lineTo(M + this.width, zoneTop + 6)
        .lineWidth(0.5)
        .strokeColor(this.colors.border)
        .stroke();

      this.font('regular', SIZE.tiny, this.colors.muted);
      if (footerText) {
        this.doc.text(footerText, M, zoneTop + 12, {
          width: this.width,
          align: 'center',
          height: 24,
          ellipsis: true,
        });
      }
      this.doc.text(legal, M, zoneTop + 42, {
        width: this.width - 80,
        align: 'left',
        height: 10,
        ellipsis: true,
      });
      this.doc.text(`${PDF_TEXT.page} ${index + 1} / ${range.count}`, M + this.width - 70, zoneTop + 42, {
        width: 70,
        align: 'right',
        lineBreak: false,
      });

      page.margins.bottom = savedBottom;
    }
  }
}