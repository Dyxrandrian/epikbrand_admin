import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

const currentDir = dirname(fileURLToPath(import.meta.url));

export function buildDataSourceOptions(env: NodeJS.ProcessEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: [join(currentDir, '..', 'entities', '**', '*.entity.{ts,js}')],
    migrations: [join(currentDir, 'migrations', '*.{ts,js}')],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: env.DB_LOGGING === 'true',
  };
}