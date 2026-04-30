import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { TaskStatus } from '../helpers/consts';

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
    // Fetch all tasks for the household
    const tasks = await this.tasksRepository.find({
      where: { household: { id: householdId } },
      relations: ['assignee', 'taskType'],
    });

    const stats = {
      totalPoints: 0,
      totalTasks: 0,
      statusCounts: {},
      byTaskType: {},
      byMember: {},
    };

    tasks.forEach((task) => {
      const points = task.points ?? 1;
      const status = task.status;
      const taskTypeName = task.taskType?.name || 'General';
      const assigneeId = task.assignee?.id || 'Unassigned';

      // Update global stats
      stats.totalTasks++;
      stats.statusCounts[status] = (stats.statusCounts[status] || 0) + 1;
      if (status === TaskStatus.COMPLETED) {
        stats.totalPoints += points;
      }

      // Update byTaskType stats
      if (!stats.byTaskType[taskTypeName]) {
        stats.byTaskType[taskTypeName] = { points: 0, totalTasks: 0, statusCounts: {} };
      }
      const typeStat = stats.byTaskType[taskTypeName];
      typeStat.totalTasks++;
      typeStat.statusCounts[status] = (typeStat.statusCounts[status] || 0) + 1;
      if (status === TaskStatus.COMPLETED) {
        typeStat.points += points;
      }

      // Update byMember stats
      if (!stats.byMember[assigneeId]) {
        stats.byMember[assigneeId] = { points: 0, totalTasks: 0, statusCounts: {} };
      }
      const memberStat = stats.byMember[assigneeId];
      memberStat.totalTasks++;
      memberStat.statusCounts[status] = (memberStat.statusCounts[status] || 0) + 1;
      if (status === TaskStatus.COMPLETED) {
        memberStat.points += points;
      }
    });

    return stats;
  }

  async getPulseStats(userId: string, householdId: string) {
    // Pulse: Returns leaderboard and chore distribution data
    const stats = await this.getFairnessStats(userId, householdId);

    // Sort users by fairness points for leaderboard
    const leaderboard = Object.keys(stats.byMember)
      .map((memberId) => ({
        assigneeId: memberId,
        points: stats.byMember[memberId].points,
      }))
      .sort((a, b) => b.points - a.points); // Descending

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
