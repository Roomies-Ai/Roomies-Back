import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { aggregateTaskStats, mapEffectiveStatus } from './stats.utils';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async getFairnessStats(userId: string, householdId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId }, relations: ['households'] });
    if (!user || !user.households || !user.households.some(h => h.id === householdId)) {
      throw new NotFoundException('User is not a member of the specified Household');
    }
    return this.getHouseholdStats(householdId);
  }

  async getHouseholdStats(householdId: string) {
    const tasks = await this.tasksRepository.find({
      where: { household: { id: householdId } },
      relations: ['assignee', 'taskType'],
    });

    const stats = aggregateTaskStats(tasks);
    const tasksWithEffectiveStatus = mapEffectiveStatus(tasks);

    return { ...stats, tasks: tasksWithEffectiveStatus };
  }

  async getPulseStats(userId: string, householdId: string) {
    const stats = await this.getFairnessStats(userId, householdId);

    const leaderboard = Object.keys(stats.byMember)
      .map((memberId) => ({
        assigneeId: memberId,
        points: stats.byMember[memberId].points,
      }))
      .sort((a, b) => b.points - a.points);

    const distribution = {};
    Object.keys(stats.byMember).forEach((mId) => {
      distribution[mId] = stats.byMember[mId].totalTasks;
    });

    return {
      leaderboard,
      distribution,
    };
  }
}
