import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'epikbrand_db',
  // Pointe vers src/entity/*.entity.ts en dev et dist/entity/*.entity.js en prod
  entities: [join(__dirname, '/../entity/**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, '/migration/*{.ts,.js}')],
  synchronize: false, // Toujours false en production pour passer par les migrations
  logging: process.env.NODE_ENV !== 'production',
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;