import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeController } from '../controller/users/me.controller.js';
import { User } from '../entities/user.entity.js';
import { ProfileService } from '../services/users/profile.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [MeController],
  providers: [ProfileService],
})
export class ProfileModule {}