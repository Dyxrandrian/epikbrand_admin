import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { PageQueryDto, uuidPipe } from '../../dto/index.js';
import { FileContentQueryDto } from '../../dto/files/file-list-query.dto.js';
import {
  CreateSalaryDto,
  GenerateSalariesDto,
  PaySalaryDto,
  SalaryListQueryDto,
  UpdateSalaryDto,
} from '../../dto/payroll/salary.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { Idempotent } from '../../interceptors/idempotent.decorator.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { contentDisposition } from '../../services/files/file-name.js';
import { SalaryPdfService } from '../../services/payroll/pdf/salary-pdf.service.js';
import { SalaryGenerationService } from '../../services/payroll/salary-generation.service.js';
import { SalaryService } from '../../services/payroll/salary.service.js';

@Controller('salaries')
export class SalariesController {
  constructor(
    private readonly salaries: SalaryService,
    private readonly generation: SalaryGenerationService,
    private readonly pdf: SalaryPdfService,
  ) {}

  @Roles(UserRole.ADMIN)
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Get()
  list(@CurrentUser() admin: AuthenticatedUser, @Query() query: SalaryListQueryDto) {
    return this.salaries.list(admin, query);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreateSalaryDto) {
    return this.salaries.create(admin, dto);
  }

  // ----- Routes statiques : AVANT ':id' -----

  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Get('mine')
  mine(@CurrentUser() viewer: AuthenticatedUser, @Query() query: PageQueryDto) {
    return this.salaries.mine(viewer, query);
  }

  @Roles(UserRole.ADMIN)
  @Idempotent()
  @RateLimit({ limit: 10, windowSeconds: 60, scope: 'user' })
  @HttpCode(200)
  @Post('generate')
  generate(@CurrentUser() admin: AuthenticatedUser, @Body() dto: GenerateSalariesDto) {
    return this.generation.generate(admin, dto);
  }

  // ----- Un bulletin -----

  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.salaries.get(viewer, id);
  }

  @RateLimit({ limit: 30, windowSeconds: 60, scope: 'user' })
  @Get(':id/pdf')
  async downloadPdf(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: FileContentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, fileName } = await this.pdf.forSalary(viewer, id);

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

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateSalaryDto,
  ) {
    return this.salaries.update(admin, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Idempotent()
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @HttpCode(200)
  @Post(':id/pay')
  pay(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: PaySalaryDto,
  ) {
    return this.salaries.pay(admin, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentUser() admin: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.salaries.cancel(admin, id);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() admin: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.salaries.remove(admin, id);
  }
}