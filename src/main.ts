import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { AppLogger } from './logger/app-logger.service';
import compression from 'compression';
import { EnvironmentVariables } from './config/environment-variables.type';

async function bootstrap() {
  const logger = new AppLogger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(logger);
  app.use(compression());
  app.use(cookieParser());
  app.enableCors({
    origin: true,
    credentials: true,
  });
  const configService = app.get(ConfigService) as ConfigService<EnvironmentVariables>;
  await app.listen(configService.get('PORT', { infer: true }) ?? 3000);
}
bootstrap();
