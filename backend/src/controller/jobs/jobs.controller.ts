import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { RunJobQueryDto } from '../../dto/jobs/run-job-query.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { JobAdminService } from '../../jobs/job-admin.service.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';

@Roles(UserRole.ADMIN)
@Controller('admin/jobs')
export class JobsController {
  constructor(private readonly jobs: JobAdminService) {}

  @Get()
  list(@CurrentUser() admin: AuthenticatedUser) {
    return this.jobs.list(admin);
  }

  @RateLimit({ limit: 10, windowSeconds: 60, scope: 'user' })
  @HttpCode(200)
  @Post(':name/run')
  run(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('name') name: string,
    @Query() query: RunJobQueryDto,
  ) {
    return this.jobs.run(admin, name, query.force === true);
  }
}