import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { AcceptInvitationDto, InviteUserDto } from '../../dto/auth/index.js';
import { Company } from '../../entities/company.entity.js';
import { User } from '../../entities/user.entity.js';
import { UserTokenPurpose } from '../../enums/app.enums.js';
import {
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
  InvalidTokenException,
  ResourceNotFoundException,
} from '../../exceptions/index.js';
import { toProfile } from '../../mapper/user.mapper.js';
import {
  INVITATION_TTL_DAYS,
  PasswordService,
} from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { MailService } from '../mail/mail.service.js';
import { UserTokenService } from './user-token.service.js';

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    private readonly userTokens: UserTokenService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}

  async invite(admin: AuthenticatedUser, dto: InviteUserDto) {
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

    const company = await this.companies.findOne({
      where: { id: admin.companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new ResourceNotFoundException('Entreprise');

    const { user, token } = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(User, {
          companyId: admin.companyId,
          name: dto.name,
          email: dto.email,
          passwordHash: null,
          role: dto.role,
          jobTitle: dto.job_title ?? null,
          matricule: dto.matricule ?? null,
          isActive: true,
          isVerified: false,
        }),
      );
      await manager.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [created.id]);

      const rawToken = await this.userTokens.issue(
        manager,
        created.id,
        UserTokenPurpose.INVITATION,
        INVITATION_TTL_DAYS * 86_400_000,
      );
      return { user: created, token: rawToken };
    });

    this.sendInBackground(() =>
      this.mail.sendInvitation(user.email, user.name, admin.name, company.name, token),
    );

    return { message: 'Invitation envoyée.', user: toProfile(user) };
  }

  async resend(admin: AuthenticatedUser, userId: string) {
    // Filtré par entreprise : un utilisateur d'une autre entreprise donne un 404
    const user = await this.users.findOne({
      where: { id: userId, companyId: admin.companyId },
    });
    if (!user) throw new ResourceNotFoundException('Utilisateur');

    if (user.passwordHash) {
      throw new ConflictAppException(
        'Cette invitation a déjà été acceptée.',
        ErrorCode.INVALID_STATE,
      );
    }
    if (!user.isActive) {
      throw new BusinessRuleException('Ce compte est désactivé.');
    }

    const company = await this.companies.findOne({
      where: { id: admin.companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new ResourceNotFoundException('Entreprise');

    const token = await this.dataSource.transaction((manager) =>
      this.userTokens.issue(
        manager,
        user.id,
        UserTokenPurpose.INVITATION,
        INVITATION_TTL_DAYS * 86_400_000,
      ),
    );
    this.sendInBackground(() =>
      this.mail.sendInvitation(user.email, user.name, admin.name, company.name, token),
    );

    return { message: 'Invitation renvoyée.' };
  }

  async accept(dto: AcceptInvitationDto) {
    const passwordHash = await this.passwords.hash(dto.password);

    await this.dataSource.transaction(async (manager) => {
      const record = await this.userTokens.consume(
        manager,
        dto.token,
        UserTokenPurpose.INVITATION,
      );

      const user = await manager.findOne(User, { where: { id: record.userId } });
      if (!user || !user.isActive || user.passwordHash) throw new InvalidTokenException();

      await manager.update(
        User,
        { id: user.id },
        { passwordHash, isVerified: true, passwordChangedAt: new Date() },
      );
    });

    return { message: 'Mot de passe défini. Vous pouvez maintenant vous connecter.' };
  }

  private sendInBackground(send: () => Promise<void>): void {
    void send().catch((error: unknown) =>
      this.logger.error("Échec d'envoi d'e-mail", error as Error),
    );
  }
}