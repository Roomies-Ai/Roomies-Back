import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { User } from './models/user.entity';
import { Task } from './models/task.entity';

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
          username: !databaseUrl ? configService.get<string>('DB_USERNAME') : undefined,
          password: !databaseUrl ? configService.get<string>('DB_PASSWORD') : undefined,
          database: !databaseUrl ? configService.get<string>('DB_NAME') : undefined,
          entities: [User, Task],
          synchronize: true, // Note: Set to false in production
          ssl: {
            rejectUnauthorized: false, // Required for Supabase in many environments
          },
        };
      },
    }),

    AuthModule,
    TasksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

