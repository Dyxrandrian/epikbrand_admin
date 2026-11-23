import PDFDocument from 'pdfkit';
import type { Company } from '../../../entities/company.entity.js';
import { PaymentMethod, SalaryItemType, SalaryStatus } from '../../../enums/app.enums.js';
import type { SalaryDetail } from '../../../mapper/payroll.mapper.js';
import {
  formatDate,
  formatMoney,
  formatPercent,
  moneyDecimals,
  pdfSafe,
} from '../../invoices/pdf/pdf-format.js';
import { PDF_LAYOUT, currencySymbol } from '../../invoices/pdf/pdf-theme.js';
import type { PdfTheme } from '../../invoices/pdf/pdf-theme.js';

type Doc = InstanceType<typeof PDFDocument>;
type Align = 'left' | 'right' | 'center';
type FontKind = 'regular' | 'bold';

interface OpenedImage {
  width: number;
  height: number;
}

const TEXT = {
  title: 'BULLETIN DE PAIE',
  period: 'Période',
  employee: 'Salarié',
  matricule: 'Matricule',
  job: 'Poste',
  dependents: 'Personnes à charge',
  status: { paid: 'PAYÉ', pending: 'NON PAYÉ', cancelled: 'ANNULÉ' },
  columns: { label: 'Libellé', base: 'Base', rate: 'Taux', earnings: 'Gains', deductions: 'Retenues' },
  baseSalary: 'Salaire de base',
  gross: 'Salaire brut',
  totalDeductions: 'Total des retenues',
  net: 'NET À PAYER',
  payment: 'Paiement',
  unpaid: 'Non payé',
  paidOn: 'Payé le',
  by: 'par',
  page: 'Page',
};

const METHODS: Record<PaymentMethod, string> = {
  [PaymentMethod.VIREMENT]: 'virement',
  [PaymentMethod.CHEQUE]: 'chèque',
  [PaymentMethod.ESPECES]: 'espèces',
  [PaymentMethod.MOBILE_MONEY]: 'mobile money',
  [PaymentMethod.AUTRE]: 'autre moyen',
};

interface Row {
  label: string;
  base: string;
  rate: string;
  earning: string;
  deduction: string;
}

const M = PDF_LAYOUT.margin;
const SIZE = PDF_LAYOUT.fontSize;
const HEADER_H = 22;
const TOTALS_W = 270;

export interface PayslipPdfOptions {
  theme: PdfTheme;
  /** JPEG ou PNG ; null = pas de logo. */
  logo: Buffer | null;
}

export function renderPayslipPdf(
  detail: SalaryDetail,
  company: Company,
  options: PayslipPdfOptions,
): Promise<Buffer> {
  return new PayslipRenderer(detail, company, options).render();
}

class PayslipRenderer {
  private readonly doc: Doc;
  private readonly colors: PdfTheme['colors'];
  private readonly width: number;
  private readonly decimals: 0 | 2;
  private readonly symbol: string;
  private cols: Array<{ key: keyof Row; label: string; width: number; align: Align }> = [];
  private y: number = M;

  constructor(
    private readonly d: SalaryDetail,
    private readonly company: Company,
    private readonly options: PayslipPdfOptions,
  ) {
    this.colors = options.theme.colors;
    this.symbol = currencySymbol(d.currency);
    this.decimals = moneyDecimals([
      d.base_salary,
      d.gross_salary,
      d.total_deductions,
      d.net_salary,
      ...d.items.flatMap((item) => [item.amount, item.base_amount]),
    ]);

    this.doc = new PDFDocument({
      size: 'A4',
      margins: { top: M, bottom: M + PDF_LAYOUT.footerHeight, left: M, right: M },
      bufferPages: true,
      info: { Title: `${TEXT.title} ${d.month_label}`, Author: company.name },
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
      this.drawEmployee();
      this.drawTable();
      this.drawTotals();
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

  private text(value: string, x: number, y: number, width: number, align: Align = 'left'): number {
    this.doc.text(value, x, y, { width, align });
    return this.doc.y;
  }

  private lines(values: ReadonlyArray<string | null | undefined>, x: number, y: number, w: number): number {
    let cursor = y;
    for (const value of values) {
      const text = this.safe(value);
      if (text) cursor = this.text(text, x, cursor, w) + 1;
    }
    return cursor;
  }

  private ensureSpace(height: number, repeatHeader = false): void {
    if (this.y + height <= this.bottom) return;
    this.doc.addPage();
    this.y = M;
    if (repeatHeader) this.drawTableHeader();
  }

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
      return 0; // logo illisible : le bulletin s'imprime sans
    }
  }

  // ---------- En-tête : entreprise à gauche, titre et période à droite ----------

  private drawHeader(): void {
    const c = this.company;
    const leftW = this.width * 0.56;
    const rightX = M + this.width * 0.6;
    const rightW = this.width * 0.4;

    let ly: number = M;
    const logoHeight = this.drawLogo(M, ly);
    if (logoHeight > 0) ly += logoHeight + 10;

    this.font('bold', SIZE.heading + 1, this.colors.primary);
    ly = this.text(this.safe(c.name), M, ly, leftW) + 4;
    this.font('regular', SIZE.body, this.colors.text);
    ly = this.lines([c.address, c.phone, c.websiteUrl], M, ly, leftW) + 4;
    this.font('regular', SIZE.small, this.colors.muted);
    ly = this.lines(
      [c.nif ? `NIF : ${c.nif}` : null, c.stat ? `STAT : ${c.stat}` : null, c.rcs ? `RCS : ${c.rcs}` : null],
      M,
      ly,
      leftW,
    );

    this.font('bold', SIZE.title - 2, this.colors.primary);
    let ry: number = this.text(TEXT.title, rightX, M, rightW, 'right') + 2;
    this.font('bold', SIZE.heading, this.colors.text);
    ry = this.text(`${TEXT.period} : ${this.d.month_label}`, rightX, ry, rightW, 'right') + 4;

    const status =
      this.d.status === SalaryStatus.PAID
        ? TEXT.status.paid
        : this.d.status === SalaryStatus.CANCELLED
          ? TEXT.status.cancelled
          : TEXT.status.pending;
    this.font('bold', SIZE.body + 0.5, this.colors.primary);
    ry = this.text(status, rightX, ry, rightW, 'right');

    this.y = Math.max(ly, ry) + 22;
  }

  // ---------- Salarié ----------

  private drawEmployee(): void {
    const e = this.d.employee;
    const rows: Array<[string, string]> = [
      [TEXT.employee, e?.name ?? ''],
      [TEXT.matricule, e?.matricule ?? ''],
      [TEXT.job, e?.job_title ?? ''],
      [TEXT.dependents, String(this.d.dependents_count)],
    ];

    const boxH = rows.filter(([, value]) => value).length * 15 + 16;
    this.ensureSpace(boxH + 10);
    this.doc.lineWidth(0.7).strokeColor(this.colors.border).roundedRect(M, this.y, this.width, boxH, 3).stroke();

    let cy = this.y + 8;
    for (const [label, value] of rows) {
      const safe = this.safe(value);
      if (!safe) continue;
      this.font('regular', SIZE.body, this.colors.muted);
      this.doc.text(label, M + 10, cy, { width: 130, lineBreak: false });
      this.font('bold', SIZE.body, this.colors.text);
      this.doc.text(safe, M + 145, cy, { width: this.width - 160, lineBreak: false });
      cy += 15;
    }
    this.y += boxH + 18;
  }

  // ---------- Tableau : base, taux, gains, retenues ----------

  private rows(): Row[] {
    const rows: Row[] = [
      {
        label: TEXT.baseSalary,
        base: '',
        rate: '',
        earning: formatMoney(this.d.base_salary, this.decimals),
        deduction: '',
      },
    ];
    for (const item of this.d.items) {
      const amount = formatMoney(item.amount, this.decimals);
      rows.push({
        label: item.label,
        base: item.base_amount === null ? '' : formatMoney(item.base_amount, this.decimals),
        rate: item.rate === null ? '' : formatPercent(item.rate),
        earning: item.type === SalaryItemType.EARNING ? amount : '',
        deduction: item.type === SalaryItemType.DEDUCTION ? amount : '',
      });
    }
    return rows;
  }

  private drawTableHeader(): void {
    const pad = PDF_LAYOUT.rowPadding;
    this.doc.rect(M, this.y, this.width, HEADER_H).fill(this.colors.tableHeaderBg);
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
    this.y += HEADER_H;
  }

  private drawTable(): void {
    const t = TEXT.columns;
    const fixed = 90 + 54 + 88 + 88;
    this.cols = [
      { key: 'label', label: t.label, width: this.width - fixed, align: 'left' },
      { key: 'base', label: t.base, width: 90, align: 'right' },
      { key: 'rate', label: t.rate, width: 54, align: 'right' },
      { key: 'earning', label: t.earnings, width: 88, align: 'right' },
      { key: 'deduction', label: t.deductions, width: 88, align: 'right' },
    ];
    const pad = PDF_LAYOUT.rowPadding;

    this.ensureSpace(HEADER_H + 40);
    this.drawTableHeader();

    for (const row of this.rows()) {
      const label = this.safe(row.label);
      this.font('regular', SIZE.body, this.colors.text);
      const rowH =
        Math.max(this.doc.heightOfString(label, { width: this.cols[0].width - 2 * pad }), SIZE.body) +
        2 * pad;

      this.ensureSpace(rowH, true);
      this.font('regular', SIZE.body, this.colors.text);

      let x = M;
      for (const column of this.cols) {
        const value = column.key === 'label' ? label : row[column.key];
        if (value) {
          this.doc.text(value, x + pad, this.y + pad, {
            width: column.width - 2 * pad,
            align: column.align,
            lineBreak: column.key === 'label',
          });
        }
        x += column.width;
      }

      this.y += rowH;
      this.doc.moveTo(M, this.y).lineTo(M + this.width, this.y).lineWidth(0.5).strokeColor(this.colors.border).stroke();
    }
    this.y += 16;
  }

  // ---------- Totaux à droite, paiement à gauche ----------

  private drawTotals(): void {
    const d = this.d;
    const rows = [
      { label: TEXT.gross, value: this.money(d.gross_salary), highlight: false },
      { label: TEXT.totalDeductions, value: `-${this.money(d.total_deductions)}`, highlight: false },
      { label: TEXT.net, value: this.money(d.net_salary), highlight: true },
    ];
    const rowH = 20;
    const highlightH = 28;
    const blockH = rows.reduce((sum, row) => sum + (row.highlight ? highlightH : rowH), 0);

    this.ensureSpace(blockH + 10);
    const top = this.y;

    // Paiement
    this.font('bold', SIZE.body, this.colors.primary);
    this.doc.text(TEXT.payment, M, top, { width: this.width - TOTALS_W - 24, lineBreak: false });
    this.font('regular', SIZE.body, this.colors.text);
    const paid =
      d.status === SalaryStatus.PAID && d.payment_date
        ? `${TEXT.paidOn} ${formatDate(d.payment_date)}${d.payment_method ? ` ${TEXT.by} ${METHODS[d.payment_method]}` : ''}`
        : TEXT.unpaid;
    this.text(paid, M, top + 16, this.width - TOTALS_W - 24);

    // Totaux
    const x = M + this.width - TOTALS_W;
    let ry = top;
    for (const row of rows) {
      const h = row.highlight ? highlightH : rowH;
      const size = row.highlight ? SIZE.heading : SIZE.body;
      if (row.highlight) this.doc.rect(x, ry, TOTALS_W, h).fill(this.colors.highlightBg);

      this.font(
        row.highlight ? 'bold' : 'regular',
        size,
        row.highlight ? this.colors.highlightText : this.colors.text,
      );
      const ty = ry + (h - size) / 2 - 1;
      this.doc.text(row.label, x + 8, ty, { width: TOTALS_W * 0.5 - 8, lineBreak: false });
      this.doc.text(row.value, x + TOTALS_W * 0.5, ty, {
        width: TOTALS_W * 0.5 - 8,
        align: 'right',
        lineBreak: false,
      });
      ry += h;
    }
    this.y = top + blockH + 18;
  }

  // ---------- Pied de page, dessiné sur toutes les pages ----------

  private drawFooters(): void {
    const c = this.company;
    const legal = this.safe(
      [c.name, c.nif ? `NIF : ${c.nif}` : null, c.stat ? `STAT : ${c.stat}` : null, c.rcs ? `RCS : ${c.rcs}` : null]
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
      this.doc.moveTo(M, zoneTop + 6).lineTo(M + this.width, zoneTop + 6).lineWidth(0.5).strokeColor(this.colors.border).stroke();

      this.font('regular', SIZE.tiny, this.colors.muted);
      this.doc.text(legal, M, zoneTop + 42, { width: this.width - 80, height: 10, ellipsis: true });
      this.doc.text(`${TEXT.page} ${index + 1} / ${range.count}`, M + this.width - 70, zoneTop + 42, {
        width: 70,
        align: 'right',
        lineBreak: false,
      });

      page.margins.bottom = savedBottom;
    }
  }
}