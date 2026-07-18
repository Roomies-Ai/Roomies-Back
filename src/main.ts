import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { AppLogger } from './logger/app-logger.service';
import compression from 'compression';
import { EnvironmentVariables } from './config/environment-variables.type';
import { mkdirSync } from 'fs';
import { join } from 'path';

async function bootstrap() {
  const logger = new AppLogger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(logger);
  app.use(compression());
  app.use(cookieParser());
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(join(uploadsDir, 'profile-pictures'), { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  const configService = app.get(ConfigService) as ConfigService<EnvironmentVariables>;
  await app.listen(configService.get('PORT', { infer: true }) ?? 3000);
}
bootstrap();
