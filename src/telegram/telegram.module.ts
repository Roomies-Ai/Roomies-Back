import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [TasksModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
