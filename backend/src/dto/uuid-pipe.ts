import { ParseUUIDPipe } from '@nestjs/common';
import { ValidationFailedException } from '../exceptions/index.js';

export const uuidPipe = (field: string) =>
  new ParseUUIDPipe({
    exceptionFactory: () =>
      new ValidationFailedException([
        { field, reason: 'isUuid', message: `${field} doit être un UUID valide.` },
      ]),
  });