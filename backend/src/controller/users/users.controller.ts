import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { InviteUserDto } from '../../dto/auth/invite-user.dto.js';
import { uuidPipe } from '../../dto/index.js';
import { UpdateUserDto } from '../../dto/users/update-user.dto.js';
import { UserListQueryDto } from '../../dto/users/user-list-query.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { UserService } from '../../services/users/user.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UserService) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: UserListQueryDto) {
    return this.users.list(viewer, query);
  }

  // Déclarée AVANT ':id'
  @Get('directory')
  directory(@CurrentUser() viewer: AuthenticatedUser) {
    return this.users.directory(viewer);
  }

  @Roles(UserRole.ADMIN)
  @RateLimit({ limit: 30, windowSeconds: 3600, scope: 'user' })
  @Post()
  create(@CurrentUser() admin: AuthenticatedUser, @Body() dto: InviteUserDto) {
    return this.users.create(admin, dto);
  }

  @Get(':id')
  get(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
  ) {
    return this.users.get(viewer, id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(admin, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  remove(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
  ) {
    return this.users.remove(admin, id);
  }
}