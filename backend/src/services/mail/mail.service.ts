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
    const link = `${this.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.deliver({
      to,
      subject: 'Vérifiez votre adresse e-mail',
      text:
        `Bonjour ${name},\n\n` +
        `Confirmez votre adresse e-mail en ouvrant ce lien (valable 24 h) :\n${link}\n`,
    });
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