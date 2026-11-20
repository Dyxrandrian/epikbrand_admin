import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMailTransport, MailTransport } from '../services/mail/mail-transport.js';
import { MailService } from '../services/mail/mail.service.js';

@Module({
  providers: [
    { provide: MailTransport, inject: [ConfigService], useFactory: createMailTransport },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}