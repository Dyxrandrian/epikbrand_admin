import { buffer as readAll } from 'node:stream/consumers';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyRepository } from '../../../repository/company.repository.js';
import { FileRepository } from '../../../repository/file.repository.js';
import { slugify } from '../../../repository/slug.js';
import { FileStorage } from '../../files/storage/file-storage.js';
import { resolvePdfTheme } from '../../invoices/pdf/pdf-theme.js';
import type { PdfTheme } from '../../invoices/pdf/pdf-theme.js';
import type { AuthenticatedUser } from '../../../security/index.js';
import { SalaryService } from '../salary.service.js';
import { renderPayslipPdf } from './payslip-pdf.renderer.js';

const PDF_LOGO_MIMES = ['image/jpeg', 'image/png'];

@Injectable()
export class SalaryPdfService {
  private readonly logger = new Logger(SalaryPdfService.name);
  private readonly theme: PdfTheme;

  constructor(
    config: ConfigService,
    private readonly salaries: SalaryService,
    private readonly companies: CompanyRepository,
    private readonly files: FileRepository,
    private readonly storage: FileStorage,
  ) {
    this.theme = resolvePdfTheme(config);
  }

  /** Mêmes droits que la fiche ; la consultation est journalisée avec son format. */
  async forSalary(viewer: AuthenticatedUser, id: string) {
    const detail = await this.salaries.readForPdf(viewer, id);
    const [company, logo] = await Promise.all([
      this.companies.getById(viewer.companyId),
      this.loadLogo(viewer.companyId),
    ]);

    const buffer = await renderPayslipPdf(detail, company, { theme: this.theme, logo });
    const who = detail.employee ? slugify(detail.employee.name) : 'salarie';
    return { buffer, fileName: `bulletin-${detail.month}-${who}.pdf` };
  }

  private async loadLogo(companyId: string): Promise<Buffer | null> {
    try {
      const logo = await this.files.findCompanyLogo(companyId);
      if (!logo || !PDF_LOGO_MIMES.includes(logo.fileType)) return null;
      return await readAll(await this.storage.getStream(logo.fileUrl));
    } catch (error) {
      this.logger.warn(`Logo indisponible pour le bulletin : ${(error as Error).message}`);
      return null;
    }
  }
}