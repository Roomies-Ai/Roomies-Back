import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { User } from './models/user.entity';
import { Task } from './models/task.entity';
import { Household } from './models/household.entity';
import { Pet } from './models/pet.entity';
import { HouseType } from './models/house-type.entity';
import { TaskType } from './models/task-type.entity';
import { UsersModule } from './users/users.module';
import { HouseholdsModule } from './households/households.module';
import { StatsModule } from './stats/stats.module';
import { HouseTypesModule } from './house-types/house-types.module';
import { TelegramModule } from './telegram/telegram.module';
import { AuthMiddleware } from './auth/auth.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        return {
          type: 'postgres',
          url: databaseUrl,
          host: !databaseUrl ? configService.get<string>('DB_HOST') : undefined,
          port: !databaseUrl ? configService.get<number>('DB_PORT') : undefined,
          username: !databaseUrl
            ? configService.get<string>('DB_USERNAME')
            : undefined,
          password: !databaseUrl
            ? configService.get<string>('DB_PASSWORD')
            : undefined,
          database: !databaseUrl
            ? configService.get<string>('DB_NAME')
            : undefined,
          entities: [User, Task, Household, Pet, HouseType, TaskType],
          synchronize: true, // Note: Set to false in production
          ...(configService.get<string>('DB_IS_SSL') === 'true'
            ? {
                ssl: {
                  rejectUnauthorized: false,
                },
              }
            : {}),
        };
      },
    }),

    AuthModule,
    TasksModule,
    UsersModule,
    HouseholdsModule,
    StatsModule,
    HouseTypesModule,
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .exclude(
        { path: 'auth/(.*)', method: RequestMethod.ALL },
        { path: 'auth', method: RequestMethod.ALL },
        { path: '/', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}
