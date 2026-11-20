import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { InvoiceDocumentType } from '../../../enums/app.enums.js';

type ByType = Record<InvoiceDocumentType, string>;

// ---------- Couleurs ----------
/** Valeurs par défaut. Surchargées par les variables PDF_COLOR_* du .env. */
export const DEFAULT_PDF_COLORS = {
  primary: '#111827', // titre, noms, intitulés de section
  text: '#1F2937', // texte courant
  muted: '#6B7280', // libellés secondaires
  border: '#D1D5DB', // traits et cadres
  tableHeaderBg: '#F3F4F6', // fond de l'en-tête du tableau
  tableHeaderText: '#111827',
  highlightBg: '#111827', // bandeau « Total TTC »
  highlightText: '#FFFFFF',
} as const;

export type PdfColors = Record<keyof typeof DEFAULT_PDF_COLORS, string>;

const COLOR_VARIABLES: Record<keyof PdfColors, string> = {
  primary: 'PDF_COLOR_PRIMARY',
  text: 'PDF_COLOR_TEXT',
  muted: 'PDF_COLOR_MUTED',
  border: 'PDF_COLOR_BORDER',
  tableHeaderBg: 'PDF_COLOR_TABLE_HEADER_BG',
  tableHeaderText: 'PDF_COLOR_TABLE_HEADER_TEXT',
  highlightBg: 'PDF_COLOR_HIGHLIGHT_BG',
  highlightText: 'PDF_COLOR_HIGHLIGHT_TEXT',
};

// ---------- Mise en page (A4, en points) ----------
export const PDF_LAYOUT = {
  margin: 40,
  footerHeight: 60,
  logoMaxWidth: 150,
  logoMaxHeight: 64,
  rowPadding: 6,
  fontSize: { title: 22, heading: 11, body: 9.5, small: 8.5, tiny: 8 },
} as const;

// ---------- Devises ----------
export const CURRENCY_SYMBOLS: Record<string, string> = { MGA: 'Ar', EUR: '€', USD: '$' };
export const currencySymbol = (code: string): string => CURRENCY_SYMBOLS[code] ?? code;

// ---------- Textes ----------
const titles: ByType = {
  [InvoiceDocumentType.INVOICE]: 'FACTURE',
  [InvoiceDocumentType.QUOTE]: 'DEVIS',
  [InvoiceDocumentType.CREDIT_NOTE]: 'AVOIR',
};
const clientHeadings: ByType = {
  [InvoiceDocumentType.INVOICE]: 'Facturé à',
  [InvoiceDocumentType.QUOTE]: 'Devis pour',
  [InvoiceDocumentType.CREDIT_NOTE]: 'Avoir pour',
};
const documentLabels: ByType = {
  [InvoiceDocumentType.INVOICE]: 'la facture',
  [InvoiceDocumentType.QUOTE]: 'le devis',
  [InvoiceDocumentType.CREDIT_NOTE]: 'l’avoir',
};
const mailSubjects: ByType = {
  [InvoiceDocumentType.INVOICE]: 'Facture',
  [InvoiceDocumentType.QUOTE]: 'Devis',
  [InvoiceDocumentType.CREDIT_NOTE]: 'Avoir',
};

export const PDF_TEXT = {
  title: titles,
  clientHeading: clientHeadings,
  documentLabel: documentLabels,
  mailSubject: mailSubjects,
  draftNumber: 'Brouillon (non numéroté)',
  status: {
    draft: 'BROUILLON',
    cancelled: 'ANNULÉ',
    cancelledInvoice: 'ANNULÉE',
    paid: 'PAYÉE',
    overdue: 'EN RETARD',
    accepted: 'ACCEPTÉ',
    rejected: 'REFUSÉ',
    expired: 'EXPIRÉ',
  },
  meta: {
    issueDate: 'Date d’émission',
    dueDate: 'Échéance',
    validUntil: 'Valable jusqu’au',
    sourceInvoice: 'Facture d’origine',
    sourceQuote: 'Devis d’origine',
    project: 'Projet',
  },
  table: {
    description: 'Description',
    quantity: 'Qté',
    unitPrice: 'P.U. HT',
    vat: 'TVA',
    discount: 'Remise',
    total: 'Total HT',
  },
  totals: {
    subtotal: 'Sous-total HT',
    discount: 'Remise',
    totalHt: 'Total HT',
    vat: 'TVA',
    totalTtc: 'Total TTC',
    paid: 'Déjà réglé',
    credited: 'Avoirs imputés',
    balance: 'Reste à payer',
    refund: 'Trop-perçu à rembourser',
  },
  sections: { notes: 'Notes', paymentTerms: 'Conditions de paiement' },
  payment: {
    heading: 'Moyens de paiement',
    bank: 'Banque',
    holder: 'Titulaire',
    account: 'Compte',
    swift: 'SWIFT/BIC',
    mobile: 'Mobile money',
  },
  page: 'Page',
} as const;

// ---------- Thème résolu au démarrage ----------
export interface PdfTheme {
  colors: PdfColors;
  fonts: {
    regular: string;
    bold: string;
    custom: boolean;
    files: { regular: string; bold: string } | null;
  };
}

const HEX = /^#?([0-9a-fA-F]{6})$/;

export function resolvePdfTheme(config: ConfigService): PdfTheme {
  const logger = new Logger('PdfTheme');

  const colors: PdfColors = { ...DEFAULT_PDF_COLORS };
  for (const [name, variable] of Object.entries(COLOR_VARIABLES) as Array<[keyof PdfColors, string]>) {
    const raw = config.get<string>(variable)?.trim();
    if (!raw) continue;
    const match = HEX.exec(raw);
    if (match) colors[name] = `#${match[1].toUpperCase()}`;
    else logger.warn(`${variable} invalide (« ${raw} ») : couleur par défaut conservée.`);
  }

  const regular = config.get<string>('PDF_FONT_REGULAR')?.trim();
  const bold = config.get<string>('PDF_FONT_BOLD')?.trim();
  let files: { regular: string; bold: string } | null = null;
  if (regular || bold) {
    if (regular && bold && existsSync(regular) && existsSync(bold)) files = { regular, bold };
    else {
      logger.warn(
        'PDF_FONT_REGULAR et PDF_FONT_BOLD doivent désigner deux fichiers existants : polices standard conservées.',
      );
    }
  }

  return {
    colors,
    fonts: files
      ? { regular: 'Body', bold: 'BodyBold', custom: true, files }
      : { regular: 'Helvetica', bold: 'Helvetica-Bold', custom: false, files: null },
  };
}