import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  // ssl: {
  //   rejectUnauthorized: false,
  // },
  synchronize: false,
  logging: true,
  entities: ['src/models/**/*.entity.ts'],
  migrations: ['src/migrations/**/*.ts'],
});
