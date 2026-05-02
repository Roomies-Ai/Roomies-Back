import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TasksModule, UsersModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
