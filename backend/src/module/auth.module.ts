import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from '../controller/auth/auth.controller.js';
import { RefreshToken } from '../entities/refresh-token.entity.js';
import { UserToken } from '../entities/user-token.entity.js';
import { User } from '../entities/user.entity.js';
import { AuthService } from '../services/auth/auth.service.js';
import { SessionService } from '../services/auth/session.service.js';
import { MailModule } from './mail.module.js';
import { SecurityModule } from './security.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserToken, RefreshToken]),
    SecurityModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  exports: [SessionService],
})
export class AuthModule {}