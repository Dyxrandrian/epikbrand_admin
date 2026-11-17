import { Controller, Get } from '@nestjs/common';
import { UserRole } from '../enums/app.enums.js';
import { CurrentUser, Public, Roles } from '../security/index.js';
import type { AuthenticatedUser } from '../security/index.js';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok' };
  }

  // TEMPORAIRE : à supprimer après vérification de l'étape 4
  @Roles(UserRole.ADMIN)
  @Get('secure')
  secure(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, role: user.role, companyId: user.companyId };
  }
}