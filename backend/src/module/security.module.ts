import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity.js';
import {
  AccessTokenService,
  IpRateLimitGuard,
  JwtAuthGuard,
  PasswordService,
  RolesGuard,
  UserRateLimitGuard,
} from '../security/index.js';
import { RateLimitModule } from './rate-limit.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    RateLimitModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: Number(config.get('JWT_ACCESS_TTL_SECONDS') ?? 900),
        },
      }),
    }),
  ],
  providers: [
    PasswordService,
    AccessTokenService,
    // L'ordre ci-dessous est l'ordre d'exécution :
    { provide: APP_GUARD, useClass: IpRateLimitGuard }, // 1. trop de requêtes depuis cette IP ?
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // 2. qui es-tu ?
    { provide: APP_GUARD, useClass: UserRateLimitGuard }, // 3. trop de requêtes pour cet utilisateur ?
    { provide: APP_GUARD, useClass: RolesGuard }, // 4. as-tu le droit ?
  ],
  exports: [PasswordService, AccessTokenService],
})
export class SecurityModule {}