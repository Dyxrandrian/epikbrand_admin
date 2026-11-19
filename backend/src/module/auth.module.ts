import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from '../controller/auth/auth.controller.js';
import { Company } from '../entities/company.entity.js';
import { RefreshToken } from '../entities/refresh-token.entity.js';
import { UserToken } from '../entities/user-token.entity.js';
import { User } from '../entities/user.entity.js';
import { AccountService } from '../services/auth/account.service.js';
import { AuthService } from '../services/auth/auth.service.js';
import { InvitationService } from '../services/auth/invitation.service.js';
import { SessionService } from '../services/auth/session.service.js';
import { UserTokenService } from '../services/auth/user-token.service.js';
import { MailModule } from './mail.module.js';
import { SecurityModule } from './security.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserToken, RefreshToken, Company]),
    SecurityModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccountService,
    InvitationService,
    SessionService,
    UserTokenService,
  ],
  exports: [SessionService, UserTokenService, InvitationService],
})
export class AuthModule {}