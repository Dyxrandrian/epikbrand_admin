import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  EmailDto,
  InviteUserDto,
  LoginDto,
  RefreshTokenDto,
  RegisterCompanyDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '../../dto/auth/index.js';
import { uuidPipe } from '../../dto/index.js';
import { UserRole } from '../../enums/app.enums.js';
import { ClientMeta, CurrentUser, Public, Roles } from '../../security/index.js';
import type { AuthenticatedUser, ClientMetadata } from '../../security/index.js';
import { AccountService } from '../../services/auth/account.service.js';
import { AuthService } from '../../services/auth/auth.service.js';
import { InvitationService } from '../../services/auth/invitation.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
    private readonly invitations: InvitationService,
  ) {}

  // ---------- Publiques ----------

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
  @Post('resend-verification')
  resendVerification(@Body() dto: EmailDto) {
    return this.account.resendVerification(dto);
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

  @Public()
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body() dto: EmailDto) {
    return this.account.forgotPassword(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.account.resetPassword(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('accept-invitation')
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(dto);
  }

  // ---------- Utilisateur connecté ----------

  @HttpCode(204)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutAll(user.id);
  }

  @HttpCode(200)
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(user.id, dto);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.account.listSessions(user.id);
  }

  @HttpCode(204)
  @Delete('sessions/:sessionId')
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', uuidPipe('sessionId')) sessionId: string,
  ) {
    return this.account.revokeSession(user.id, sessionId);
  }

  // ---------- Admin ----------

  @Roles(UserRole.ADMIN)
  @Post('invitations')
  invite(@CurrentUser() admin: AuthenticatedUser, @Body() dto: InviteUserDto) {
    return this.invitations.invite(admin, dto);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @Post('invitations/:userId/resend')
  resendInvitation(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId', uuidPipe('userId')) userId: string,
  ) {
    return this.invitations.resend(admin, userId);
  }
}