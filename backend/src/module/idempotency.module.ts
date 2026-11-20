import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity.js';
import { IdempotencyRepository } from '../repository/idempotency.repository.js';
import { IdempotencyService } from '../services/idempotency/idempotency.service.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKey])],
  providers: [IdempotencyRepository, IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}