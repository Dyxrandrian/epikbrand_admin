import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { uuidPipe } from '../../dto/index.js';
import {
  AttachReceiptDto,
  CreateExpenseDto,
  ExpenseListQueryDto,
  PayExpenseDto,
  UpdateExpenseDto,
} from '../../dto/expenses/index.js';
import { UserRole } from '../../enums/app.enums.js';
import { Idempotent } from '../../interceptors/idempotent.decorator.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { ExpenseService } from '../../services/expenses/expense.service.js';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpenseService) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: ExpenseListQueryDto) {
    return this.expenses.list(viewer, query);
  }

  @Idempotent()
  @RateLimit({ limit: 120, windowSeconds: 60, scope: 'user' })
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseDto) {
    return this.expenses.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.expenses.get(viewer, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenses.update(viewer, id, dto);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/validate')
  validate(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.expenses.validate(user, id);
  }

  @Roles(...MANAGERS)
  @Idempotent()
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @HttpCode(200)
  @Post(':id/pay')
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: PayExpenseDto,
  ) {
    return this.expenses.pay(user, id, dto);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.expenses.cancel(viewer, id);
  }

  @Put(':id/receipt')
  attachReceipt(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: AttachReceiptDto,
  ) {
    return this.expenses.attachReceipt(viewer, id, dto.file_id);
  }

  @HttpCode(204)
  @Delete(':id/receipt')
  detachReceipt(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.expenses.detachReceipt(viewer, id);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() admin: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.expenses.remove(admin, id);
  }
}