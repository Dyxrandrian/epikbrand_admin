import { buffer as readAll } from 'node:stream/consumers';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InvoiceDetail } from '../../../mapper/invoice.mapper.js';
import { FileRepository } from '../../../repository/file.repository.js';
import { FileStorage } from '../../files/storage/file-storage.js';
import { InvoiceService } from '../invoice.service.js';
import { renderInvoicePdf } from './invoice-pdf.renderer.js';
import { resolvePdfTheme } from './pdf-theme.js';
import type { PdfTheme } from './pdf-theme.js';

export interface GeneratedPdf {
  buffer: Buffer;
  fileName: string;
}

const PDF_LOGO_MIMES = ['image/jpeg', 'image/png'];

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);
  private readonly theme: PdfTheme;

  constructor(
    config: ConfigService,
    private readonly invoices: InvoiceService,
    private readonly files: FileRepository,
    private readonly storage: FileStorage,
  ) {
    this.theme = resolvePdfTheme(config);
  }

  /** 404 si le document n'existe pas ou appartient à une autre entreprise. */
  async forDocument(companyId: string, id: string): Promise<GeneratedPdf> {
    return this.forDetail(companyId, await this.invoices.detail(companyId, id));
  }

  /** Un document émis est dessiné avec ses données figées (vendeur et client). */
  async forDetail(companyId: string, detail: InvoiceDetail): Promise<GeneratedPdf> {
    const logo = await this.loadLogo(companyId);
    const buffer = await renderInvoicePdf(detail, { theme: this.theme, logo });
    return { buffer, fileName: this.fileName(detail) };
  }

  private fileName(detail: InvoiceDetail): string {
    const base = detail.invoice_number ?? `brouillon-${detail.type}-${detail.id.slice(0, 8)}`;
    return `${base.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
  }

  /** Le logo reste « vivant » : seul élément du PDF qui n'est pas figé à l'émission. */
  private async loadLogo(companyId: string): Promise<Buffer | null> {
    try {
      const logo = await this.files.findCompanyLogo(companyId);
      if (!logo || !PDF_LOGO_MIMES.includes(logo.fileType)) return null;
      return await readAll(await this.storage.getStream(logo.fileUrl));
    } catch (error) {
      this.logger.warn(`Logo indisponible pour le PDF : ${(error as Error).message}`);
      return null;
    }
  }
}