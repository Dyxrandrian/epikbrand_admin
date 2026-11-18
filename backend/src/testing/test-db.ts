import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import * as entityModule from '../entities/index.js';

export async function createTestDataSource(): Promise<DataSource> {
  const database = process.env.DB_NAME_TEST;

  if (!database) {
    throw new Error("DB_NAME_TEST manquant dans .env : les tests d'intégration refusent de tourner.");
  }
  if (database === process.env.DB_NAME || !/test/i.test(database)) {
    throw new Error(
      `Base "${database}" refusée : DB_NAME_TEST doit être distincte de DB_NAME et contenir "test".`,
    );
  }

  const entities = Object.values(entityModule).filter((value) => typeof value === 'function');

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database,
    entities,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
  });
  return dataSource.initialize();
}