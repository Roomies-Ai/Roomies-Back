import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { Household } from '../models/household.entity';
import { FairnessService } from './fairness.service';


@Module({
    imports: [TypeOrmModule.forFeature([Task, User, Household])],
    controllers: [TasksController],
    providers: [TasksService, FairnessService],
})
export class TasksModule { }
