const REQUIRED = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_ACCESS_SECRET',
];

const R2_REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const SMTP_REQUIRED = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];

export function validateEnv(env: Record<string, unknown>) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
  }

  const secret = String(env.JWT_ACCESS_SECRET);
  if (secret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET doit contenir au moins 32 caractères.');
  }

  const driver = String(env.STORAGE_DRIVER ?? 'local');
  if (driver !== 'local' && driver !== 'r2') {
    throw new Error('STORAGE_DRIVER doit valoir « local » ou « r2 ».');
  }
  if (driver === 'r2') {
    const missingR2 = R2_REQUIRED.filter((key) => !env[key]);
    if (missingR2.length > 0) {
      throw new Error(`STORAGE_DRIVER=r2 exige : ${missingR2.join(', ')}`);
    }
  }

  const mailDriver = String(env.MAIL_DRIVER ?? 'console');
  if (mailDriver !== 'console' && mailDriver !== 'smtp') {
    throw new Error('MAIL_DRIVER doit valoir « console » ou « smtp ».');
  }
  if (mailDriver === 'smtp') {
    const missingSmtp = SMTP_REQUIRED.filter((key) => !env[key]);
    if (missingSmtp.length > 0) {
      throw new Error(`MAIL_DRIVER=smtp exige : ${missingSmtp.join(', ')}`);
    }
  }

  return env;
}