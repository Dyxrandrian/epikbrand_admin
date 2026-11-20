import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailTransport } from './mail-transport.js';
import type { Mail, MailAttachment } from './mail-transport.js';

@Injectable()
export class MailService {
  private readonly frontendUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly transport: MailTransport,
  ) {
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

  async sendNotification(
    to: string,
    name: string,
    title: string,
    content: string,
    redirectUrl: string | null,
  ): Promise<void> {
    const link = `${this.frontendUrl}${redirectUrl ?? ''}`;
    await this.deliver({
      to,
      subject: title,
      text: `Bonjour ${name},\n\n${content}\n\nOuvrir dans EpikBrand :\n${link}\n`,
    });
  }

  /** Message libre avec pièce jointe (devis, facture, avoir). Lève une erreur si l'envoi échoue. */
  async sendWithAttachment(
    to: string,
    subject: string,
    text: string,
    attachment: MailAttachment,
  ): Promise<void> {
    await this.deliver({ to, subject, text, attachments: [attachment] });
  }

  private link(path: string, token: string): string {
    return `${this.frontendUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  private deliver(mail: Mail): Promise<void> {
    return this.transport.send(mail);
  }
}