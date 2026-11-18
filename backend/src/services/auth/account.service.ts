import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import type {
  ChangePasswordDto,
  EmailDto,
  ResetPasswordDto,
} from '../../dto/auth/index.js';
import { RefreshToken } from '../../entities/refresh-token.entity.js';
import { User } from '../../entities/user.entity.js';
import { UserTokenPurpose } from '../../enums/app.enums.js';
import {
  BusinessRuleException,
  ErrorCode,
  InvalidTokenException,
  NotAuthenticatedException,
} from '../../exceptions/index.js';
import { toSession } from '../../mapper/session.mapper.js';
import {
  PasswordService,
  RESET_PASSWORD_TTL_HOURS,
  TOKEN_RESEND_COOLDOWN_SECONDS,
  VERIFY_EMAIL_TTL_HOURS,
} from '../../security/index.js';
import { MailService } from '../mail/mail.service.js';
import { SessionService } from './session.service.js';
import { UserTokenService } from './user-token.service.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly userTokens: UserTokenService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) { }

  // ---------- Renvoi de l'e-mail de vérification ----------

  async resendVerification(dto: EmailDto) {
    const user = await this.users.findOne({ where: { email: dto.email } });

    // Les comptes invités (sans mot de passe) passent par leur invitation
    if (
      user &&
      user.isActive &&
      !user.isVerified &&
      user.passwordHash &&
      !(await this.userTokens.wasIssuedRecently(
        user.id,
        UserTokenPurpose.VERIFY_EMAIL,
        TOKEN_RESEND_COOLDOWN_SECONDS,
      ))
    ) {
      const token = await this.dataSource.transaction((manager) =>
        this.userTokens.issue(
          manager,
          user.id,
          UserTokenPurpose.VERIFY_EMAIL,
          VERIFY_EMAIL_TTL_HOURS * 3_600_000,
        ),
      );
      this.sendInBackground(() =>
        this.mail.sendEmailVerification(user.email, user.name, token),
      );
    }

    return {
      message: 'Si un compte non vérifié existe pour cette adresse, un e-mail a été envoyé.',
    };
  }

  // ---------- Mot de passe oublié / réinitialisation ----------

  async forgotPassword(dto: EmailDto) {
    const user = await this.users.findOne({ where: { email: dto.email } });

    if (
      user &&
      user.isActive &&
      user.passwordHash &&
      !(await this.userTokens.wasIssuedRecently(
        user.id,
        UserTokenPurpose.RESET_PASSWORD,
        TOKEN_RESEND_COOLDOWN_SECONDS,
      ))
    ) {
      const token = await this.dataSource.transaction((manager) =>
        this.userTokens.issue(
          manager,
          user.id,
          UserTokenPurpose.RESET_PASSWORD,
          RESET_PASSWORD_TTL_HOURS * 3_600_000,
        ),
      );
      this.sendInBackground(() => this.mail.sendPasswordReset(user.email, user.name, token));
    }

    return {
      message: 'Si un compte existe pour cette adresse, un e-mail a été envoyé.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const passwordHash = await this.passwords.hash(dto.new_password);

    await this.dataSource.transaction(async (manager) => {
      const record = await this.userTokens.consume(
        manager,
        dto.token,
        UserTokenPurpose.RESET_PASSWORD,
      );

      const user = await manager.findOne(User, { where: { id: record.userId } });
      if (!user || !user.isActive) throw new InvalidTokenException();

      await manager.update(
        User,
        { id: user.id },
        {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
          isVerified: true, // le lien reçu par e-mail prouve que l'adresse est la bonne
        },
      );

      // Les autres liens de réinitialisation en attente n'ont plus lieu d'être
      await this.userTokens.invalidateAll(manager, user.id, UserTokenPurpose.RESET_PASSWORD);

      // Toutes les sessions sont révoquées (contrat 3), dans la même transaction
      await manager.update(
        RefreshToken,
        { userId: user.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );

      await this.audit.record(
        {
          action: AuditAction.PASSWORD_RESET,
          entityType: AuditEntityType.USER,
          entityId: user.id,
          companyId: user.companyId,
          userId: user.id,
        },
        manager,
      );
    });

    return { message: 'Mot de passe modifié. Vous pouvez vous connecter.' };
  }

  // ---------- Changement de mot de passe (connecté) ----------

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotAuthenticatedException();

    const currentOk = await this.passwords.verify(user.passwordHash, dto.current_password);
    if (!currentOk) {
      throw new BusinessRuleException(
        'Le mot de passe actuel est incorrect.',
        ErrorCode.INVALID_CURRENT_PASSWORD,
      );
    }
    if (dto.current_password === dto.new_password) {
      throw new BusinessRuleException(
        "Le nouveau mot de passe doit être différent de l'ancien.",
      );
    }

    const passwordHash = await this.passwords.hash(dto.new_password);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: userId }, { passwordHash, passwordChangedAt: new Date() });
      await this.audit.record(
        {
          action: AuditAction.PASSWORD_CHANGED,
          entityType: AuditEntityType.USER,
          entityId: userId,
          companyId: user.companyId,
          userId,
        },
        manager,
      );
    });

    // Les autres sessions sont révoquées ; celle indiquée par keep_session_id est conservée
    await this.sessions.revokeOthers(userId, dto.keep_session_id);

    return { message: 'Mot de passe modifié.' };
  }

  // ---------- Sessions actives ----------

  async listSessions(userId: string) {
    const active = await this.sessions.listActive(userId);
    return active.map(toSession);
  }

  revokeSession(userId: string, sessionId: string) {
    return this.sessions.revokeSession(userId, sessionId);
  }

  private sendInBackground(send: () => Promise<void>): void {
    void send().catch((error: unknown) =>
      this.logger.error("Échec d'envoi d'e-mail", error as Error),
    );
  }
}