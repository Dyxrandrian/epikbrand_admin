// src/database/data-source.testdb.ts
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.config.js';

const database = process.env.DB_NAME_TEST;
if (!database) throw new Error('DB_NAME_TEST manquant dans .env');

const options = buildDataSourceOptions({
  ...process.env,
  DB_NAME: database,
});

// 🔎 Ajoute ceci pour vérifier en direct dans la console
console.log("🛠️ Connexion TypeORM sur la base :", options.database);

export default new DataSource(options);