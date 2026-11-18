import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    this.frontendUrl = (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
  }

  async sendEmailVerification(to: string, name: string, token: string): Promise<void> {
    await this.deliver({
      to,
      subject: 'Vérifiez votre adresse e-mail',
      text:
        `Bonjour ${name},\n\n` +
        `Confirmez votre adresse e-mail en ouvrant ce lien (valable 24 h) :\n` +
        `${this.link('/verify-email', token)}\n`,
    });
  }

  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    await this.deliver({
      to,
      subject: 'Réinitialisation de votre mot de passe',
      text:
        `Bonjour ${name},\n\n` +
        `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n` +
        `${this.link('/reset-password', token)}\n\n` +
        `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n`,
    });
  }

  async sendInvitation(
    to: string,
    name: string,
    inviterName: string,
    companyName: string,
    token: string,
  ): Promise<void> {
    await this.deliver({
      to,
      subject: `${inviterName} vous invite à rejoindre ${companyName}`,
      text:
        `Bonjour ${name},\n\n` +
        `${inviterName} vous invite à rejoindre ${companyName}.\n` +
        `Définissez votre mot de passe avec ce lien (valable 7 jours) :\n` +
        `${this.link('/accept-invitation', token)}\n`,
    });
  }

  private link(path: string, token: string): string {
    return `${this.frontendUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  /** À remplacer par un vrai fournisseur (SMTP, Resend…) plus tard. */
  private async deliver(mail: Mail): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      this.logger.warn(
        `Aucun fournisseur d'e-mail configuré : "${mail.subject}" pour ${mail.to} non envoyé.`,
      );
      return;
    }
    this.logger.log(
      `\n--- E-MAIL (mode développement) ---\nÀ : ${mail.to}\nObjet : ${mail.subject}\n\n${mail.text}-----------------------------------`,
    );
  }
}