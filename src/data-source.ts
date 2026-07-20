import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { env } from './config/env';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.get('DATABASE_URL', { infer: true }),
  // ssl: {
  //   rejectUnauthorized: false,
  // },
  synchronize: false,
  logging: true,
  entities: ['src/models/**/*.entity.ts'],
  migrations: ['src/migrations/**/*.ts'],
});
