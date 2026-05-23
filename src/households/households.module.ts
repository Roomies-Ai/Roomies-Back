import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HouseholdsService } from './households.service';
import { HouseholdsController } from './households.controller';
import { Household } from '../models/household.entity';
import { User } from '../models/user.entity';
import { Pet } from '../models/pet.entity';
import { TaskType } from '../models/task-type.entity';
import { Task } from '../models/task.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Household, User, Pet, TaskType, Task])],
  controllers: [HouseholdsController],
  providers: [HouseholdsService],
  exports: [HouseholdsService]
})
export class HouseholdsModule {}
