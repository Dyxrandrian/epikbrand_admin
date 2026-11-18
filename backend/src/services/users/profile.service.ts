import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UpdateProfileDto } from '../../dto/users/index.js';
import { User } from '../../entities/user.entity.js';
import { NotAuthenticatedException } from '../../exceptions/index.js';
import { toProfile } from '../../mapper/user.mapper.js';

@Injectable()
export class ProfileService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async get(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotAuthenticatedException();
    return toProfile(user);
  }

  async update(userId: string, dto: UpdateProfileDto) {
    const changes: { name?: string; phone?: string | null; address?: string | null } = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.phone !== undefined) changes.phone = dto.phone;
    if (dto.address !== undefined) changes.address = dto.address;

    if (Object.keys(changes).length > 0) {
      await this.users.update(userId, changes);
    }
    return this.get(userId);
  }
}