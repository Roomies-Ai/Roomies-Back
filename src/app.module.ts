import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { User } from './models/user.entity';
import { Task } from './models/task.entity';
import { Household } from './models/household.entity';
import { Pet } from './models/pet.entity';
import { TaskType } from './models/task-type.entity';
import { UsersModule } from './users/users.module';
import { HouseholdsModule } from './households/households.module';
import { StatsModule } from './stats/stats.module';
import { TelegramModule } from './telegram/telegram.module';
import { AuthMiddleware } from './auth/auth.middleware';
import { LoggerModule } from './logger/logger.module';
import { RequestLoggerMiddleware } from './logger/request-logger.middleware';
import { NotificationsModule } from './notifications/notifications.module';
import { GoogleCalendarModule } from './google-calendar/google-calendar.module';
import { EnvironmentVariables } from './config/environment-variables.type';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule, LoggerModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables>) => {
        const databaseUrl = configService.get('DATABASE_URL', {
          infer: true,
        });
        return {
          type: 'postgres',
          url: databaseUrl,
          host: !databaseUrl
            ? configService.get('DB_HOST', { infer: true })
            : undefined,
          port: !databaseUrl
            ? configService.get('DB_PORT', { infer: true })
            : undefined,
          username: !databaseUrl
            ? configService.get('DB_USERNAME', { infer: true })
            : undefined,
          password: !databaseUrl
            ? configService.get('DB_PASSWORD', { infer: true })
            : undefined,
          database: !databaseUrl
            ? configService.get('DB_NAME', { infer: true })
            : undefined,
          entities: [User, Task, Household, Pet, TaskType],
          synchronize: false,
          ...(configService.get('DB_IS_SSL', { infer: true }) === 'true'
            ? {
                ssl: {
                  rejectUnauthorized: false,
                },
              }
            : {}),
        };
      },
    }),

    ScheduleModule.forRoot(),
    LoggerModule,
    AuthModule,
    TasksModule,
    UsersModule,
    HouseholdsModule,
    StatsModule,
    TelegramModule,
    NotificationsModule,
    GoogleCalendarModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestLoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      .apply(AuthMiddleware)
      .exclude('auth/(.*)', 'auth', '/', 'google-calendar/callback')
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
