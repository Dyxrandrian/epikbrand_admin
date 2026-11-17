import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity.js';
import {
  AccessTokenService,
  JwtAuthGuard,
  PasswordService,
  RolesGuard,
} from '../security/index.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
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
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // 1er : qui es-tu ?
    { provide: APP_GUARD, useClass: RolesGuard }, // 2e : as-tu le droit ?
  ],
  exports: [PasswordService, AccessTokenService],
})
export class SecurityModule {}