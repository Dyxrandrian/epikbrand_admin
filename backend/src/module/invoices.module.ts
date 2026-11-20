import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceActionsController } from '../controller/invoices/invoice-actions.controller.js';
import { InvoicesController } from '../controller/invoices/invoices.controller.js';
import { Client } from '../entities/client.entity.js';
import { InvoiceItem } from '../entities/invoice-item.entity.js';
import { InvoicePayment } from '../entities/invoice-payment.entity.js';
import { Invoice } from '../entities/invoice.entity.js';
import { ClientRepository } from '../repository/client.repository.js';
import { InvoicePaymentRepository } from '../repository/invoice-payment.repository.js';
import { InvoiceRepository } from '../repository/invoice.repository.js';
import { InvoiceDocumentsService } from '../services/invoices/invoice-documents.service.js';
import { InvoicePaymentService } from '../services/invoices/invoice-payment.service.js';
import { InvoiceSendService } from '../services/invoices/invoice-send.service.js';
import { InvoiceService } from '../services/invoices/invoice.service.js';
import { InvoicePdfService } from '../services/invoices/pdf/invoice-pdf.service.js';
import { CompanyModule } from './company.module.js';
import { FilesModule } from './files.module.js';
import { MailModule } from './mail.module.js';
import { ProjectsModule } from './projects.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceItem, InvoicePayment, Client]),
    CompanyModule,
    ProjectsModule,
    FilesModule,
    MailModule,
  ],
  controllers: [InvoicesController, InvoiceActionsController],
  providers: [
    InvoiceRepository,
    InvoicePaymentRepository,
    ClientRepository,
    InvoiceService,
    InvoicePaymentService,
    InvoiceDocumentsService,
    InvoicePdfService,
    InvoiceSendService,
  ],
  exports: [InvoiceRepository, InvoicePaymentRepository],
})
export class InvoicesModule {}