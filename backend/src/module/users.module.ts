import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from '../controller/users/users.controller.js';
import { User } from '../entities/user.entity.js';
import { UserRepository } from '../repository/user.repository.js';
import { UserService } from '../services/users/user.service.js';
import { AuthModule } from './auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [UsersController],
  providers: [UserRepository, UserService],
})
export class UsersModule {}