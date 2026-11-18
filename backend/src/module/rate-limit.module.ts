import { Module } from '@nestjs/common';
import {
  InMemoryRateLimitStore,
  RateLimitService,
  RateLimitStore,
} from '../security/index.js';

@Module({
  providers: [{ provide: RateLimitStore, useClass: InMemoryRateLimitStore }, RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}