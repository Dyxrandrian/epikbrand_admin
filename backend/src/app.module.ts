import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.validation.js';
import { buildDataSourceOptions } from './database/database.config.js';
import { HealthModule } from './module/health.module.js';
import { SecurityModule } from './module/security.module.js';
import { AuthModule } from './module/auth.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDataSourceOptions(process.env),
    }),
    HealthModule,
    SecurityModule,
    AuthModule,
  ],
})
export class AppModule {}