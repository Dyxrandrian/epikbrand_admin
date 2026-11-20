import { Injectable, Logger } from '@nestjs/common';
import type { SendInvoiceDto } from '../../dto/invoices/send-invoice.dto.js';
import { InvoiceDocumentType, InvoicePaymentStatus } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
  ServiceUnavailableAppException,
} from '../../exceptions/index.js';
import type { InvoiceDetail } from '../../mapper/invoice.mapper.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { formatDate, formatMoney, moneyDecimals } from './pdf/pdf-format.js';
import { InvoicePdfService } from './pdf/invoice-pdf.service.js';
import { PDF_TEXT, currencySymbol } from './pdf/pdf-theme.js';
import { InvoiceService } from './invoice.service.js';

@Injectable()
export class InvoiceSendService {
  private readonly logger = new Logger(InvoiceSendService.name);

  constructor(
    private readonly invoices: InvoiceService,
    private readonly pdf: InvoicePdfService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Brouillon : émis d'abord (numéro, figement), puis envoyé. Si l'e-mail échoue après
   * l'émission, la réponse est un 503 qui le précise : renvoyer ne réémet pas le document.
   */
  async send(user: AuthenticatedUser, id: string, dto: SendInvoiceDto) {
    const { companyId } = user;
    let detail = await this.invoices.detail(companyId, id); // 404 si étranger

    if (detail.status === InvoicePaymentStatus.CANCELLED) {
      throw new ConflictAppException(
        'Ce document est annulé : il ne peut pas être envoyé.',
        ErrorCode.INVALID_STATE,
      );
    }

    const to = dto.to ?? detail.client_details.email;
    if (!to) {
      throw new BusinessRuleException(
        "Ce client n'a pas d'adresse e-mail : renseignez-la dans sa fiche, ou indiquez le destinataire (champ « to »).",
        ErrorCode.RECIPIENT_MISSING,
      );
    }

    let issuedNow = false;
    if (detail.status === InvoicePaymentStatus.DRAFT) {
      detail = await this.invoices.issue(user, id); // 409 / 422 si le brouillon n'est pas émettable
      issuedNow = true;
    }

    try {
      const { buffer, fileName } = await this.pdf.forDetail(companyId, detail);
      const { subject, text } = this.compose(detail, dto);
      await this.mail.sendWithAttachment(to, subject, text, {
        filename: fileName,
        content: buffer,
        contentType: 'application/pdf',
      });
    } catch (error) {
      this.logger.error(`Envoi du document ${id} impossible`, error as Error);
      throw new ServiceUnavailableAppException(
        issuedNow
          ? "Le document a été émis, mais l'e-mail n'a pas pu être envoyé. Réessayez l'envoi : le document ne sera pas émis une seconde fois."
          : "L'e-mail n'a pas pu être envoyé. Réessayez dans un instant.",
        ErrorCode.EMAIL_DELIVERY_FAILED,
        { issued: issuedNow, invoice_id: id },
      );
    }

    await this.audit.recordQuietly({
      action: AuditAction.SEND,
      entityType: AuditEntityType.INVOICE,
      entityId: id,
      companyId,
      userId: user.id,
      changes: {
        after: { sent_to: to, invoice_number: detail.invoice_number, issued_now: issuedNow },
      },
    });

    return { ...detail, email: { sent_to: to, issued_now: issuedNow } };
  }

  private compose(detail: InvoiceDetail, dto: SendInvoiceDto): { subject: string; text: string } {
    const symbol = currencySymbol(detail.currency);
    const decimals = moneyDecimals([detail.total_ttc]);
    const total = `${formatMoney(detail.total_ttc, decimals)} ${symbol}`;
    const number = detail.invoice_number ?? '';
    const client = detail.client_details;

    const subject = (dto.subject ?? `${PDF_TEXT.mailSubject[detail.type]} ${number} - ${detail.seller.name}`)
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 200);

    const lines = [
      `Bonjour ${client.contact_name ?? client.company_name},`,
      '',
      `Veuillez trouver ci-joint ${PDF_TEXT.documentLabel[detail.type]} ${number} d'un montant de ${total} TTC.`,
    ];
    if (detail.type === InvoiceDocumentType.INVOICE && detail.due_date) {
      lines.push(`Échéance de paiement : ${formatDate(detail.due_date)}.`);
    }
    if (detail.type === InvoiceDocumentType.QUOTE && detail.valid_until) {
      lines.push(`Ce devis est valable jusqu'au ${formatDate(detail.valid_until)}.`);
    }
    if (dto.message) lines.push('', dto.message);

    lines.push('', 'Cordialement,', detail.seller.name);
    if (detail.seller.phone) lines.push(detail.seller.phone);

    return { subject, text: `${lines.join('\n')}\n` };
  }
}