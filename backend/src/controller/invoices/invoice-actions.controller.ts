import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { uuidPipe } from '../../dto/index.js';
import { FileContentQueryDto } from '../../dto/files/file-list-query.dto.js';
import {
  ConvertQuoteDto,
  CreateCreditNoteDto,
  CreatePaymentDto,
  DuplicateInvoiceDto,
  MarkPaidDto,
  SendInvoiceDto,
} from '../../dto/invoices/index.js';
import { UserRole } from '../../enums/app.enums.js';
import { Idempotent } from '../../interceptors/idempotent.decorator.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { contentDisposition } from '../../services/files/file-name.js';
import { InvoiceDocumentsService } from '../../services/invoices/invoice-documents.service.js';
import { InvoicePaymentService } from '../../services/invoices/invoice-payment.service.js';
import { InvoiceSendService } from '../../services/invoices/invoice-send.service.js';
import { InvoicePdfService } from '../../services/invoices/pdf/invoice-pdf.service.js';

@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('invoices')
export class InvoiceActionsController {
  constructor(
    private readonly payments: InvoicePaymentService,
    private readonly documents: InvoiceDocumentsService,
    private readonly pdf: InvoicePdfService,
    private readonly sender: InvoiceSendService,
  ) {}

  // ----- PDF et envoi -----

  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Get(':id/pdf')
  async downloadPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: FileContentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, fileName } = await this.pdf.forDocument(user.companyId, id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader(
      'Content-Disposition',
      contentDisposition(query.inline === true ? 'inline' : 'attachment', fileName),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(buffer);
  }

  @Idempotent()
  @RateLimit({ limit: 30, windowSeconds: 3600, scope: 'user' })
  @HttpCode(200)
  @Post(':id/send')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: SendInvoiceDto,
  ) {
    return this.sender.send(user, id, dto);
  }

  // ----- Documents liés -----

  @Get(':id/documents')
  linked(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.documents.linkedDocuments(user, id);
  }

  // ----- Paiements -----

  @Get(':id/payments')
  listPayments(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.payments.list(user, id);
  }

  @Idempotent()
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Post(':id/payments')
  recordPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.payments.record(user, id, dto);
  }

  @Idempotent()
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @HttpCode(200)
  @Post(':id/mark-paid')
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.payments.markPaid(user, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Delete(':id/payments/:paymentId')
  removePayment(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Param('paymentId', uuidPipe('paymentId')) paymentId: string,
  ) {
    return this.payments.remove(admin, id, paymentId);
  }

  // ----- Avoirs -----

  @Idempotent()
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Post(':id/credit-notes')
  createCreditNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.documents.createCreditNote(user, id, dto);
  }

  // ----- Devis -----

  @HttpCode(200)
  @Post(':id/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.documents.accept(user, id);
  }

  @HttpCode(200)
  @Post(':id/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.documents.reject(user, id);
  }

  @Idempotent()
  @RateLimit({ limit: 30, windowSeconds: 60, scope: 'user' })
  @HttpCode(200)
  @Post(':id/convert')
  convert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: ConvertQuoteDto,
  ) {
    return this.documents.convertQuote(user, id, dto);
  }

  // ----- Duplication -----

  @Idempotent()
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Post(':id/duplicate')
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DuplicateInvoiceDto,
  ) {
    return this.documents.duplicate(user, id, dto);
  }
}