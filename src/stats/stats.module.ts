import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Task, User])],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
