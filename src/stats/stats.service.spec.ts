import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from '@jest/globals';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { TaskStatus } from '../helpers/consts';
import { StatsService } from './stats.service';

const makeUserQb = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getExists: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
});

const makeTaskQb = () => ({
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  setParameter: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getRawMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
});

const mockTaskRepo = () => ({
  createQueryBuilder: jest
    .fn<() => ReturnType<typeof makeTaskQb>>()
    .mockImplementation(() => makeTaskQb()),
});

const mockUserRepo = () => ({
  createQueryBuilder: jest
    .fn<() => ReturnType<typeof makeUserQb>>()
    .mockImplementation(() => makeUserQb()),
});

/** Wires up the two sequential createQueryBuilder('task') calls made inside
 * getHouseholdStats: the first builds the grouped aggregation, the second the
 * flat task list. Both chains are constructed synchronously before either
 * getRawMany() promise resolves, so call order is deterministic. */
const wireHouseholdStatsQueries = (
  taskRepo: ReturnType<typeof mockTaskRepo>,
  rawData: unknown[],
  tasksRaw: unknown[],
) => {
  const rawDataQb = makeTaskQb();
  rawDataQb.getRawMany.mockResolvedValueOnce(rawData);
  const tasksRawQb = makeTaskQb();
  tasksRawQb.getRawMany.mockResolvedValueOnce(tasksRaw);
  taskRepo.createQueryBuilder
    .mockImplementationOnce(() => rawDataQb)
    .mockImplementationOnce(() => tasksRawQb);
  return { rawDataQb, tasksRawQb };
};

describe('StatsService', () => {
  let service: StatsService;
  let taskRepo: ReturnType<typeof mockTaskRepo>;
  let userRepo: ReturnType<typeof mockUserRepo>;

  beforeEach(async () => {
    taskRepo = mockTaskRepo();
    userRepo = mockUserRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(StatsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── clearCache() ─────────────────────────────────────────────────────────

  describe('clearCache()', () => {
    it('forces getFairnessStats to recompute stats on the next call', async () => {
      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');
      expect(taskRepo.createQueryBuilder).toHaveBeenCalledTimes(2);

      service.clearCache('hh-1');

      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');
      expect(taskRepo.createQueryBuilder).toHaveBeenCalledTimes(4); // 2 more invocations after cache clear
    });
  });

  // ── getFairnessStats() ───────────────────────────────────────────────────

  describe('getFairnessStats()', () => {
    it('throws NotFoundException when the user is not a household member', async () => {
      const qb = makeUserQb();
      qb.getExists.mockResolvedValueOnce(false);
      userRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await expect(service.getFairnessStats('user-1', 'hh-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('checks membership via a query builder scoped to the user and household', async () => {
      const qb = makeUserQb();
      userRepo.createQueryBuilder.mockReturnValueOnce(qb);
      wireHouseholdStatsQueries(taskRepo, [], []);

      await service.getFairnessStats('user-1', 'hh-1');

      expect(qb.innerJoin).toHaveBeenCalledWith('user.households', 'household');
      expect(qb.where).toHaveBeenCalledWith('user.id = :userId', {
        userId: 'user-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('household.id = :householdId', {
        householdId: 'hh-1',
      });
    });

    it('reuses the cached membership check within the 5-minute TTL', async () => {
      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');
      service.clearCache('hh-1'); // force stats recompute without touching membership cache

      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');

      expect(userRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('re-checks membership after the 5-minute TTL expires', async () => {
      jest.useFakeTimers();
      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');

      jest.advanceTimersByTime(5 * 60 * 1000 + 1);
      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');

      expect(userRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('reuses cached stats within the 1-hour TTL', async () => {
      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');

      await service.getFairnessStats('user-1', 'hh-1');

      // Only the first call's pair of createQueryBuilder invocations should exist.
      expect(taskRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('recomputes stats after the 1-hour TTL expires', async () => {
      jest.useFakeTimers();
      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');

      jest.advanceTimersByTime(60 * 60 * 1000 + 1);
      wireHouseholdStatsQueries(taskRepo, [], []);
      await service.getFairnessStats('user-1', 'hh-1');

      expect(taskRepo.createQueryBuilder).toHaveBeenCalledTimes(4);
    });
  });

  // ── getHouseholdStats() ──────────────────────────────────────────────────

  describe('getHouseholdStats()', () => {
    it('aggregates counts/points across members, task types, unassigned, and untyped rows', async () => {
      wireHouseholdStatsQueries(
        taskRepo,
        [
          {
            memberId: 'member-1',
            typeName: 'Cleaning',
            status: TaskStatus.COMPLETED,
            count: '2',
            points: '5',
          },
          {
            memberId: 'member-1',
            typeName: 'Cleaning',
            status: TaskStatus.PENDING,
            count: '1',
            points: '0',
          },
          {
            memberId: null,
            typeName: null,
            status: TaskStatus.PENDING,
            count: '3',
            points: '0',
          },
        ],
        [],
      );

      const result = await service.getHouseholdStats('hh-1');

      expect(result.totalTasks).toBe(6);
      expect(result.totalPoints).toBe(5);
      expect(result.statusCounts[TaskStatus.COMPLETED]).toBe(2);
      expect(result.statusCounts[TaskStatus.PENDING]).toBe(4);
      expect(result.byMember['member-1']).toEqual({
        points: 5,
        totalTasks: 3,
        statusCounts: { [TaskStatus.COMPLETED]: 2, [TaskStatus.PENDING]: 1 },
      });
      expect(result.byMember['Unassigned']).toEqual({
        points: 0,
        totalTasks: 3,
        statusCounts: { [TaskStatus.PENDING]: 3 },
      });
      expect(result.byTaskType['Cleaning'].totalTasks).toBe(3);
      expect(result.byTaskType['General'].totalTasks).toBe(3);
    });

    it('maps effective overdue status onto the flat task list', async () => {
      const past = new Date(Date.now() - 86_400_000).toISOString();
      wireHouseholdStatsQueries(
        taskRepo,
        [],
        [
          {
            id: 'task-1',
            title: 'Overdue task',
            status: TaskStatus.PENDING,
            dueDate: past,
            points: 3,
            assigneeId: null,
            assigneeUsername: null,
            taskTypeId: null,
            taskTypeName: null,
          },
        ],
      );

      const result = await service.getHouseholdStats('hh-1');

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        id: 'task-1',
        status: 'overdue',
      });
    });
  });

  // ── getPulseStats() ──────────────────────────────────────────────────────

  describe('getPulseStats()', () => {
    it('derives a sorted leaderboard and a task-count distribution from fairness stats', async () => {
      jest.spyOn(service, 'getFairnessStats').mockResolvedValueOnce({
        totalPoints: 15,
        totalTasks: 5,
        statusCounts: {},
        byMember: {
          'member-1': { points: 10, totalTasks: 3, statusCounts: {} },
          'member-2': { points: 5, totalTasks: 2, statusCounts: {} },
        },
        byTaskType: {},
        tasks: [],
      });

      const result = await service.getPulseStats('user-1', 'hh-1');

      expect(result.leaderboard).toEqual([
        { assigneeId: 'member-1', points: 10 },
        { assigneeId: 'member-2', points: 5 },
      ]);
      expect(result.distribution).toEqual({ 'member-1': 3, 'member-2': 2 });
    });
  });
});
