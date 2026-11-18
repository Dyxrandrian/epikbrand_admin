import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { seedCompanyDefaults } from '../../database/seeds/company-defaults.js';
import { UserTokenService } from './user-token.service.js';
import type {
  LoginDto,
  RefreshTokenDto,
  RegisterCompanyDto,
  VerifyEmailDto,
} from '../../dto/auth/index.js';
import { Company } from '../../entities/company.entity.js';
import { UserToken } from '../../entities/user-token.entity.js';
import { User } from '../../entities/user.entity.js';
import { UserRole, UserTokenPurpose } from '../../enums/app.enums.js';
import {
  AccessDeniedException,
  AccountLockedException,
  ConflictAppException,
  ErrorCode,
  NotAuthenticatedException,
} from '../../exceptions/index.js';
import { toAuthUser } from '../../mapper/user.mapper.js';
import {
  ACCOUNT_LOCK_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  PasswordService,
  VERIFY_EMAIL_TTL_HOURS,
  generateOpaqueToken,
  hashToken,
} from '../../security/index.js';
import type { ClientMetadata } from '../../security/index.js';
import { MailService } from '../mail/mail.service.js';
import { SessionService } from './session.service.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { snapshot } from '../audit/audit-changes.js';
import { USER_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly userTokens: UserTokenService,
    private readonly audit: AuditService,
  ) { }

  /** Crée l'entreprise, son premier admin et les données par défaut, en une transaction. */
  async registerCompany(dto: RegisterCompanyDto) {
    const existing = await this.users.findOne({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictAppException(
        'Un compte existe déjà avec cette adresse e-mail.',
        ErrorCode.DUPLICATE_RESOURCE,
      );
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const verificationToken = generateOpaqueToken();

    // En cas de course entre deux inscriptions, la contrainte UNIQUE de la base
    // renvoie aussi un 409 (via le filtre d'erreurs).
    const admin = await this.dataSource.transaction(async (manager) => {
      const company = await manager.save(
        manager.create(Company, { name: dto.company_name }),
      );

      const user = await manager.save(
        manager.create(User, {
          companyId: company.id,
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: UserRole.ADMIN,
          isActive: true,
          isVerified: false,
        }),
      );

      await seedCompanyDefaults(manager, company.id);
      await manager.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [user.id]);

      await manager.save(
        manager.create(UserToken, {
          userId: user.id,
          purpose: UserTokenPurpose.VERIFY_EMAIL,
          tokenHash: hashToken(verificationToken),
          expiresAt: new Date(Date.now() + VERIFY_EMAIL_TTL_HOURS * 3_600_000),
        }),
      );
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.COMPANY,
          entityId: company.id,
          companyId: company.id,
          userId: user.id,
          changes: { after: snapshot(company, ['name']) },
        },
        manager,
      );

      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.USER,
          entityId: user.id,
          companyId: company.id,
          userId: user.id,
          changes: { after: snapshot(user, USER_AUDIT_FIELDS) },
        },
        manager,
      );
      return user;
    });

    // Le compte existe déjà : un échec d'envoi ne doit pas faire échouer l'inscription
    try {
      await this.mail.sendEmailVerification(admin.email, admin.name, verificationToken);
    } catch (error) {
      this.logger.error("Échec d'envoi de l'e-mail de vérification", error as Error);
    }

    return {
      message: 'Entreprise créée. Un e-mail de vérification a été envoyé.',
      user: toAuthUser(admin),
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    await this.dataSource.transaction(async (manager) => {
      const record = await this.userTokens.consume(
        manager,
        dto.token,
        UserTokenPurpose.VERIFY_EMAIL,
      );
      await manager.update(User, { id: record.userId }, { isVerified: true });
    });

    return { message: 'Adresse e-mail vérifiée. Vous pouvez vous connecter.' };
  }

  async login(dto: LoginDto, meta: ClientMetadata) {
    const user = await this.users.findOne({ where: { email: dto.email } });

    if (!user) {
      await this.passwords.burn(dto.password);
      throw this.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AccountLockedException(this.minutesLeft(user.lockedUntil));
    }

    const passwordOk = await this.passwords.verify(user.passwordHash, dto.password);
    if (!passwordOk) {
      const lockedUntil = await this.registerFailedAttempt(user);
      if (lockedUntil) throw new AccountLockedException(ACCOUNT_LOCK_MINUTES);
      throw this.invalidCredentials();
    }

    // Ces états ne sont révélés qu'à qui connaît le bon mot de passe
    if (!user.isActive) {
      throw new AccessDeniedException(
        'Ce compte a été désactivé. Contactez votre administrateur.',
        ErrorCode.ACCOUNT_DISABLED,
      );
    }
    if (!user.isVerified) {
      throw new AccessDeniedException(
        "Votre adresse e-mail n'est pas encore vérifiée.",
        ErrorCode.EMAIL_NOT_VERIFIED,
      );
    }

    await this.users.update(user.id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });

    await this.audit.recordQuietly({
      action: AuditAction.LOGIN,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      companyId: user.companyId,
      userId: user.id,
    });

    const tokens = await this.sessions.open(user, meta);
    return { ...tokens, user: toAuthUser(user) };
  }

  refresh(dto: RefreshTokenDto, meta: ClientMetadata) {
    return this.sessions.refresh(dto.refresh_token, meta);
  }

  logout(dto: RefreshTokenDto) {
    return this.sessions.logout(dto.refresh_token);
  }

  logoutAll(userId: string) {
    return this.sessions.revokeAllForUser(userId);
  }

  /** Incrémente le compteur ; renvoie la date de fin de verrouillage si le seuil est atteint. */
  private async registerFailedAttempt(user: User): Promise<Date | null> {
    const attempts = user.failedLoginAttempts + 1;

    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000);
      await this.users.update(user.id, { failedLoginAttempts: 0, lockedUntil });
      await this.audit.recordQuietly({
        action: AuditAction.ACCOUNT_LOCKED,
        entityType: AuditEntityType.USER,
        entityId: user.id,
        companyId: user.companyId,
        userId: null, // l'auteur des tentatives est inconnu
        changes: { after: { locked_until: lockedUntil.toISOString() } },
      });
      return lockedUntil;
    }

    await this.users.increment({ id: user.id }, 'failedLoginAttempts', 1);
    return null;
  }

  private minutesLeft(until: Date): number {
    return Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  }

  private invalidCredentials(): NotAuthenticatedException {
    return new NotAuthenticatedException(
      'E-mail ou mot de passe incorrect.',
      ErrorCode.INVALID_CREDENTIALS,
    );
  }
}