import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { Household } from '../models/household.entity';
import { FairnessService } from './fairness.service';
import { StatsModule } from '../stats/stats.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';


@Module({
    imports: [
        TypeOrmModule.forFeature([Task, User, Household]),
        StatsModule,
        GoogleCalendarModule,
    ],
    controllers: [TasksController],
    providers: [TasksService, FairnessService],
    exports: [TasksService],
})
export class TasksModule { }
