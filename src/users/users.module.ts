import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from '../models/user.entity';
import { TaskType } from '../models/task-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, TaskType])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
