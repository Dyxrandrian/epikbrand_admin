import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateCompanySettingsDto } from '../../dto/company/update-company-settings.dto.js';
import { UpdateCompanyDto } from '../../dto/company/update-company.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { CompanyService } from '../../services/company/company.service.js';

@Controller('company')
export class CompanyController {
  constructor(private readonly company: CompanyService) { }

  @Get()
  get(@CurrentUser() viewer: AuthenticatedUser) {
    return this.company.getProfile(viewer);
  }

  @Roles(UserRole.ADMIN)
  @Patch()
  update(@CurrentUser() admin: AuthenticatedUser, @Body() dto: UpdateCompanyDto) {
    return this.company.updateProfile(admin, dto);
  }

  @Get('settings')
  getSettings(@CurrentUser('companyId') companyId: string) {
    return this.company.getSettings(companyId);
  }

  @Roles(UserRole.ADMIN)
  @Patch('settings')
  updateSettings(@CurrentUser() admin: AuthenticatedUser, @Body() dto: UpdateCompanySettingsDto) {
    return this.company.updateSettings(admin, dto);
  }

  @Roles(UserRole.ADMIN)
  @Get('usage')
  usage(@CurrentUser('companyId') companyId: string) {
    return this.company.getUsage(companyId);
  }
}