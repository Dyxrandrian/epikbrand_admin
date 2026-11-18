import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateProfileDto } from '../../dto/users/index.js';
import { CurrentUser } from '../../security/index.js';
import { ProfileService } from '../../services/users/profile.service.js';

@Controller('me')
export class MeController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@CurrentUser('id') userId: string) {
    return this.profile.get(userId);
  }

  @Patch()
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.profile.update(userId, dto);
  }
}