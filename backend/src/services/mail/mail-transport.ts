import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

/** Classe abstraite : sert aussi de jeton d'injection. Lève une erreur si l'envoi échoue. */
export abstract class MailTransport {
  abstract send(mail: Mail): Promise<void>;
}

/** Développement : le message s'affiche dans la console, les pièces jointes sont écrites sur disque. */
export class ConsoleMailTransport extends MailTransport {
  private readonly logger = new Logger('Mail');

  constructor(private readonly production: boolean) {
    super();
  }

  async send(mail: Mail): Promise<void> {
    if (this.production) {
      throw new Error("Aucun fournisseur d'e-mail configuré (MAIL_DRIVER=smtp requis en production).");
    }

    const saved: string[] = [];
    if (mail.attachments?.length) {
      const dir = join(tmpdir(), 'epikbrand-mail');
      await mkdir(dir, { recursive: true });
      for (const attachment of mail.attachments) {
        const safeName = attachment.filename.replace(/[^A-Za-z0-9._-]/g, '_');
        const path = join(dir, `${Date.now()}-${safeName}`);
        await writeFile(path, attachment.content);
        saved.push(`${path} (${attachment.content.length} octets)`);
      }
    }

    const files = saved.length ? `\nPièces jointes :\n${saved.map((s) => `  ${s}`).join('\n')}\n` : '';
    this.logger.log(
      `\n--- E-MAIL (mode console) ---\nÀ : ${mail.to}\nObjet : ${mail.subject}\n\n${mail.text}${files}-----------------------------------`,
    );
  }
}

/** SMTP : Mailtrap sandbox pour tester, n'importe quel fournisseur SMTP ensuite. */
export class SmtpMailTransport extends MailTransport {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;

  constructor(config: ConfigService) {
    super();
    this.from = config.get<string>('MAIL_FROM') ?? 'EpikBrand <no-reply@epikbrand.test>';
    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: Number(config.get('SMTP_PORT') ?? 2525),
      secure: config.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: config.getOrThrow<string>('SMTP_USER'),
        pass: config.getOrThrow<string>('SMTP_PASS'),
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  async send(mail: Mail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    });
  }
}

export function createMailTransport(config: ConfigService): MailTransport {
  if (config.get<string>('MAIL_DRIVER') === 'smtp') return new SmtpMailTransport(config);

  const production = config.get<string>('NODE_ENV') === 'production';
  if (production) {
    new Logger('Mail').warn('MAIL_DRIVER=console en production : aucun e-mail ne sera envoyé.');
  }
  return new ConsoleMailTransport(production);
}