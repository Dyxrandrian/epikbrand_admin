import type { ValidationError } from 'class-validator';
import { ValidationFailedException } from './app.exception.js';
import type { ErrorDetail } from './app.exception.js';

function flatten(errors: ValidationError[], parentPath = ''): ErrorDetail[] {
  const details: ErrorDetail[] = [];

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      for (const [reason, message] of Object.entries(error.constraints)) {
        details.push({
          field: path,
          reason,
          message:
            reason === 'whitelistValidation'
              ? `Le champ « ${error.property} » n'est pas autorisé.`
              : message,
        });
      }
    }
    if (error.children?.length) {
      details.push(...flatten(error.children, path));
    }
  }
  return details;
}

export function validationExceptionFactory(errors: ValidationError[]) {
  return new ValidationFailedException(flatten(errors));
}