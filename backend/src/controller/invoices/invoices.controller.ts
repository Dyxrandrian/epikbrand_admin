import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { uuidPipe } from '../../dto/index.js';
import {
  CreateInvoiceDto,
  InvoiceListQueryDto,
  UpdateInvoiceDto,
} from '../../dto/invoices/index.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { InvoiceService } from '../../services/invoices/invoice.service.js';

// Facturation : admin et manager. Un collaborateur n'a accès à rien pour l'instant.
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: InvoiceListQueryDto) {
    return this.invoices.list(user, query);
  }

  @RateLimit({ limit: 120, windowSeconds: 60, scope: 'user' })
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.invoices.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoices.update(user, id, dto);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.invoices.remove(user, id);
  }

  @HttpCode(200)
  @Post(':id/issue')
  issue(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.invoices.issue(user, id);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.invoices.cancel(user, id);
  }
}