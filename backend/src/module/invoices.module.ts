import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from '../controller/invoices/invoices.controller.js';
import { Client } from '../entities/client.entity.js';
import { InvoiceItem } from '../entities/invoice-item.entity.js';
import { Invoice } from '../entities/invoice.entity.js';
import { ClientRepository } from '../repository/client.repository.js';
import { InvoiceRepository } from '../repository/invoice.repository.js';
import { InvoiceService } from '../services/invoices/invoice.service.js';
import { CompanyModule } from './company.module.js';
import { ProjectsModule } from './projects.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, InvoiceItem, Client]), CompanyModule, ProjectsModule],
  controllers: [InvoicesController],
  providers: [InvoiceRepository, ClientRepository, InvoiceService],
  exports: [InvoiceRepository],
})
export class InvoicesModule {}