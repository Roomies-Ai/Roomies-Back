import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { mapEffectiveStatus } from './stats.utils';
import { TaskStatus } from '../helpers/consts';

@Injectable()
export class StatsService {
  private statsCache = new Map<string, { data: any, timestamp: number }>();
  private membershipCache = new Map<string, { isMember: boolean, timestamp: number }>();
  
  private readonly STATS_TTL = 3600000; // 1 hour
  private readonly MEMBERSHIP_TTL = 300000; // 5 minutes

  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  /**
   * Clears the stats cache for a specific household.
   * Called by TasksService when data changes.
   */
  clearCache(householdId: string) {
    this.statsCache.delete(householdId);
  }

  async getFairnessStats(userId: string, householdId: string) {
    // 1. Check Membership (with 5-minute cache)
    const memCacheKey = `${userId}:${householdId}`;
    const cachedMember = this.membershipCache.get(memCacheKey);
    let isMember = cachedMember?.isMember;

    if (!cachedMember || Date.now() - cachedMember.timestamp > this.MEMBERSHIP_TTL) {
      isMember = await this.usersRepository
        .createQueryBuilder('user')
        .innerJoin('user.households', 'household')
        .where('user.id = :userId', { userId })
        .andWhere('household.id = :householdId', { householdId })
        .getExists();
      
      this.membershipCache.set(memCacheKey, { isMember, timestamp: Date.now() });
    }

    if (!isMember) {
      throw new NotFoundException('User is not a member of the specified Household');
    }

    // 2. Check Stats Cache (with 1-hour TTL, cleared on update)
    const cachedStats = this.statsCache.get(householdId);
    if (cachedStats && Date.now() - cachedStats.timestamp < this.STATS_TTL) {
      return cachedStats.data;
    }
    
    const stats = await this.getHouseholdStats(householdId);
    
    // Update Cache
    this.statsCache.set(householdId, { data: stats, timestamp: Date.now() });
    
    return stats;
  }

  async getHouseholdStats(householdId: string) {
    const now = new Date();
    const completedStatus = TaskStatus.COMPLETED;

    const effectiveStatusSql = `CASE WHEN status != '${completedStatus}' AND task.dueDate < :now THEN 'overdue' ELSE status END`;

    // 1. Single Granular Aggregation Query
    const rawDataPromise = this.tasksRepository.createQueryBuilder('task')
      .leftJoin('task.assignee', 'assignee')
      .leftJoin('task.taskType', 'taskType')
      .where('task.householdId = :householdId', { householdId })
      .select([
        'assignee.id as "memberId"',
        'taskType.name as "typeName"',
        `${effectiveStatusSql} as status`,
        'COUNT(*) as count',
        `SUM(CASE WHEN status = '${completedStatus}' THEN points ELSE 0 END) as points`
      ])
      .setParameter('now', now)
      .groupBy('"memberId"')
      .addGroupBy('"typeName"')
      .addGroupBy(effectiveStatusSql)
      .getRawMany();

    // 2. Filtered Task List (Limited to active tasks and recently completed ones)
    const recentLimit = new Date();
    recentLimit.setDate(recentLimit.getDate() - 14);

    const tasksRawPromise = this.tasksRepository.createQueryBuilder('task')
      .leftJoin('task.assignee', 'assignee')
      .leftJoin('task.taskType', 'taskType')
      .where('task.householdId = :householdId', { householdId })
      .andWhere(new Brackets(qb => {
        qb.where('task.status != :completed', { completed: completedStatus })
          .orWhere('task.updatedAt > :recentLimit', { recentLimit });
      }))
      .select([
        'task.id as id',
        'task.title as title',
        'task.status as status',
        'task.dueDate as "dueDate"',
        'task.points as points',
        'assignee.id as "assigneeId"',
        'assignee.username as "assigneeUsername"',
        'taskType.id as "taskTypeId"',
        'taskType.name as "taskTypeName"'
      ])
      .orderBy('task.dueDate', 'ASC') // Most urgent first
      .limit(300)
      .getRawMany();

    const [rawData, tasksRaw] = await Promise.all([
      rawDataPromise,
      tasksRawPromise
    ]);

    // Manual mapping is much faster than TypeORM's internal hydrator for large result sets
    const tasks = tasksRaw.map(row => ({
      id: row.id,
      title: row.title,
      status: row.status,
      dueDate: row.dueDate,
      points: row.points,
      assignee: row.assigneeId ? { id: row.assigneeId, username: row.assigneeUsername } : null,
      taskType: row.taskTypeId ? { id: row.taskTypeId, name: row.taskTypeName } : null
    }));

    const stats = this.formatGranularStats(rawData);
    const tasksWithEffectiveStatus = mapEffectiveStatus(tasks as any);

    return { ...stats, tasks: tasksWithEffectiveStatus };
  }

  private formatGranularStats(rawData: any[]) {
    const stats: any = {
      totalPoints: 0,
      totalTasks: 0,
      statusCounts: {},
      byMember: {},
      byTaskType: {}
    };

    rawData.forEach(row => {
      const count = parseInt(row.count);
      const points = parseInt(row.points || 0);
      const memberId = row.memberId || 'Unassigned';
      const typeName = row.typeName || 'General';
      const status = row.status;

      // Global
      stats.totalTasks += count;
      stats.totalPoints += points;
      stats.statusCounts[status] = (stats.statusCounts[status] || 0) + count;

      // By Member
      if (!stats.byMember[memberId]) {
        stats.byMember[memberId] = { points: 0, totalTasks: 0, statusCounts: {} };
      }
      stats.byMember[memberId].totalTasks += count;
      stats.byMember[memberId].points += points;
      stats.byMember[memberId].statusCounts[status] = (stats.byMember[memberId].statusCounts[status] || 0) + count;

      // By Task Type
      if (!stats.byTaskType[typeName]) {
        stats.byTaskType[typeName] = { points: 0, totalTasks: 0, statusCounts: {} };
      }
      stats.byTaskType[typeName].totalTasks += count;
      stats.byTaskType[typeName].points += points;
      stats.byTaskType[typeName].statusCounts[status] = (stats.byTaskType[typeName].statusCounts[status] || 0) + count;
    });

    return stats;
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
