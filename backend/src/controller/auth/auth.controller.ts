import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  LoginDto,
  RefreshTokenDto,
  RegisterCompanyDto,
  VerifyEmailDto,
} from '../../dto/auth/index.js';
import { ClientMeta, CurrentUser, Public } from '../../security/index.js';
import type { AuthenticatedUser, ClientMetadata } from '../../security/index.js';
import { AuthService } from '../../services/auth/auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterCompanyDto) {
    return this.auth.registerCompany(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @ClientMeta() meta: ClientMetadata) {
    return this.auth.login(dto, meta);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @ClientMeta() meta: ClientMetadata) {
    return this.auth.refresh(dto, meta);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto);
  }

  @HttpCode(204)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutAll(user.id);
  }
}