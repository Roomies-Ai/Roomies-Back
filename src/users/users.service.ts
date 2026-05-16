import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../models/user.entity';
import { TaskType } from '../models/task-type.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(TaskType)
    private taskTypeRepository: Repository<TaskType>,
  ) {}

  async getAvailableTaskTypes(userId: string): Promise<any[]> {
    const taskTypes = await this.taskTypeRepository.createQueryBuilder('taskType')
      .innerJoinAndSelect('taskType.household', 'household')
      .innerJoin('household.members', 'member')
      .where('member.id = :userId', { userId })
      .getMany();

    return taskTypes.map(tt => ({
      id: tt.id,
      name: tt.name,
      householdName: tt.household?.name
    }));
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.createQueryBuilder('user')
      .leftJoinAndSelect('user.households', 'household')
      .leftJoinAndSelect('household.taskTypes', 'taskType')
      .leftJoinAndSelect('user.assignedTasks', 'assignedTask')
      .leftJoinAndSelect('user.preferredTaskTypes', 'preferredTaskType')
      .where('user.id = :id', { id })
      .getOne();

    if (!user) throw new NotFoundException(`User #${id} not found`);
    return user;
  }

  async updatePreferredTasks(userId: string, taskTypeIds: string[]): Promise<User> {
    const user = await this.findOne(userId);
    user.preferredTaskTypes = taskTypeIds.map(id => ({ id } as any));
    await this.usersRepository.save(user);
    return this.findOne(userId);
  }

  async update(id: string, updateData: Partial<User>): Promise<User> {
    await this.usersRepository.update(id, updateData);
    return this.findOne(id);
  }

  async updatePassword(id: string, oldPass: string, newPass: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const isMatch = await bcrypt.compare(oldPass, user.password);
    if (!isMatch) throw new Error('Incorrect current password');

    const hashedPassword = await bcrypt.hash(newPass, 10);
    await this.usersRepository.update(id, { password: hashedPassword });
  }
}
