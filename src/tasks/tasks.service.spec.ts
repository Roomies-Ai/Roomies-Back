import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { Task } from '../models/task.entity';
import { Household } from '../models/household.entity';
import { TaskStatus } from '../helpers/consts';
import { TasksService } from './tasks.service';
import { StatsService } from '../stats/stats.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { RecurrenceRule } from '../helpers/recurrence.helper';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-uuid',
    title: 'Test Task',
    description: 'desc',
    status: TaskStatus.PENDING,
    points: 1,
    dueDate: new Date('2024-06-01T08:00:00'),
    googleCalendarEventId: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    household: { id: 'hh-uuid' } as Household,
    assignee: null,
    taskType: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Task;

const WEEKLY_RULE: RecurrenceRule = {
  frequency: 'WEEKLY',
  interval: 1,
  daysOfWeek: [0],
  timeOfDay: '08:00',
};

// ── Mock factories ────────────────────────────────────────────────────────────

const makeQb = () => ({
  leftJoinAndSelect: jest
    .fn<() => ReturnType<typeof makeQb>>()
    .mockReturnThis(),
  where: jest.fn<() => ReturnType<typeof makeQb>>().mockReturnThis(),
  andWhere: jest.fn<() => ReturnType<typeof makeQb>>().mockReturnThis(),
  orderBy: jest.fn<() => ReturnType<typeof makeQb>>().mockReturnThis(),
  getMany: jest.fn<() => Promise<Task[]>>().mockResolvedValue([]),
});

const mockRepo = () => ({
  create: jest
    .fn<(data: Partial<Task>) => Task>()
    .mockImplementation((d) => ({ ...d }) as Task),
  save: jest
    .fn<(entity: Task | Partial<Task>) => Promise<Task>>()
    .mockResolvedValue(makeTask()),
  find: jest.fn<() => Promise<Task[]>>().mockResolvedValue([]),
  findOne: jest.fn<() => Promise<Task | null>>().mockResolvedValue(null),
  update: jest.fn<() => Promise<object>>().mockResolvedValue({}),
  delete: jest.fn<() => Promise<object>>().mockResolvedValue({}),
  remove: jest
    .fn<(entity: Task) => Promise<Task>>()
    .mockResolvedValue(makeTask()),
  createQueryBuilder: jest
    .fn<() => ReturnType<typeof makeQb>>()
    .mockReturnValue(makeQb()),
});

const mockStatsService = () => ({
  clearCache: jest.fn<(id: string) => void>(),
});

const mockCalendarService = () => ({
  createCalendarEvent: jest
    .fn<(task: Task) => Promise<void>>()
    .mockResolvedValue(undefined),
  updateCalendarEvent: jest
    .fn<(task: Task) => Promise<void>>()
    .mockResolvedValue(undefined),
  deleteCalendarEvent: jest
    .fn<(task: Task) => Promise<void>>()
    .mockResolvedValue(undefined),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TasksService', () => {
  let service: TasksService;
  let taskRepo: ReturnType<typeof mockRepo>;
  let statsService: ReturnType<typeof mockStatsService>;
  let calendarService: ReturnType<typeof mockCalendarService>;

  beforeEach(async () => {
    taskRepo = mockRepo();
    statsService = mockStatsService();
    calendarService = mockCalendarService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        { provide: getRepositoryToken(Household), useValue: mockRepo() },
        { provide: StatsService, useValue: statsService },
        { provide: GoogleCalendarService, useValue: calendarService },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('saves a basic task and clears stats cache', async () => {
      const data = {
        title: 'Clean',
        description: 'desc',
        household: { id: 'hh-uuid' },
      };
      taskRepo.save.mockResolvedValueOnce(makeTask(data as Partial<Task>));

      await service.create(data as Partial<Task>);

      expect(taskRepo.save).toHaveBeenCalled();
      expect(statsService.clearCache).toHaveBeenCalledWith('hh-uuid');
    });

    it('creates calendar event when assignee + dueDate exist', async () => {
      const task = makeTask({
        assignee: { id: 'user-1' } as any,
        dueDate: new Date(),
      });
      taskRepo.save.mockResolvedValueOnce(task);

      await service.create({} as Partial<Task>);

      expect(calendarService.createCalendarEvent).toHaveBeenCalledWith(task);
    });

    it('calls scheduleUpcomingInstances when recurrenceRule is set', async () => {
      const task = makeTask({ recurrenceRule: WEEKLY_RULE });
      taskRepo.save.mockResolvedValueOnce(task);

      await service.create({
        title: 'Weekly clean',
        recurrenceRule: WEEKLY_RULE,
      } as Partial<Task>);

      // scheduleUpcomingInstances calls findOne to get latest existing instance
      expect(taskRepo.findOne).toHaveBeenCalled();
    });

    it('does NOT call scheduleUpcomingInstances for non-recurring tasks', async () => {
      const task = makeTask();
      taskRepo.save.mockResolvedValueOnce(task);

      await service.create({ title: 'One-off' } as Partial<Task>);

      expect(taskRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── updateStatus ────────────────────────────────────────────────────────────

  describe('updateStatus()', () => {
    it('marks task COMPLETED and saves', async () => {
      const task = makeTask({ id: 'task-1' });
      taskRepo.findOne.mockResolvedValueOnce(task);
      taskRepo.save.mockResolvedValueOnce({
        ...task,
        status: TaskStatus.COMPLETED,
      });

      const result = await service.updateStatus('task-1', TaskStatus.COMPLETED);

      expect(result.status).toBe(TaskStatus.COMPLETED);
    });

    it('generates next instance when completing a recurring instance', async () => {
      const instance = makeTask({
        id: 'inst-1',
        recurrenceParentId: 'parent-id',
        dueDate: new Date('2024-06-01T08:00:00'),
        status: TaskStatus.IN_PROGRESS,
      });
      const template = makeTask({
        id: 'parent-id',
        recurrenceRule: WEEKLY_RULE,
        dueDate: new Date('2024-05-25T08:00:00'),
      });

      taskRepo.findOne
        .mockResolvedValueOnce(instance) // findOne in updateStatus
        .mockResolvedValueOnce(template) // template lookup in generateNextInstanceAfterCompletion
        .mockResolvedValueOnce(null); // duplicate check → no existing instance

      taskRepo.save.mockResolvedValue({
        ...instance,
        status: TaskStatus.COMPLETED,
      });

      await service.updateStatus('inst-1', TaskStatus.COMPLETED);

      // save called twice: once for status update, once for new instance
      expect(taskRepo.save).toHaveBeenCalledTimes(2);
    });

    it('does NOT generate next instance for non-recurring tasks', async () => {
      const task = makeTask({ id: 'task-1', recurrenceParentId: null });
      taskRepo.findOne.mockResolvedValueOnce(task);
      taskRepo.save.mockResolvedValueOnce({
        ...task,
        status: TaskStatus.COMPLETED,
      });

      await service.updateStatus('task-1', TaskStatus.COMPLETED);

      expect(taskRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ── generateRecurringInstances (cron) ──────────────────────────────────────

  describe('generateRecurringInstances()', () => {
    it('skips templates that already have a pending instance within the lookahead window', async () => {
      const template = makeTask({
        id: 'template-1',
        recurrenceRule: WEEKLY_RULE,
        recurrenceParentId: null,
        dueDate: new Date('2024-05-25T08:00:00'),
      });

      taskRepo.find.mockResolvedValueOnce([template]);

      const existingInstance = makeTask({
        recurrenceParentId: 'template-1',
        dueDate: new Date(Date.now() + 2 * 86_400_000),
      });
      taskRepo.findOne
        .mockResolvedValueOnce(existingInstance) // latest instance lookup
        .mockResolvedValueOnce(existingInstance); // duplicate check

      await service.generateRecurringInstances();

      expect(taskRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── update with clearRecurrence ─────────────────────────────────────────────

  describe('update() with clearRecurrence', () => {
    it('nulls out recurrenceRule when clearRecurrence=true', async () => {
      const task = makeTask({ recurrenceRule: WEEKLY_RULE });
      taskRepo.findOne.mockResolvedValueOnce(task);
      taskRepo.save.mockResolvedValueOnce({ ...task, recurrenceRule: null });

      await service.update('task-uuid', { clearRecurrence: true });

      const savedArg = taskRepo.save.mock.calls[0][0] as Task;
      expect(savedArg.recurrenceRule).toBeNull();
    });
  });

  // ── findOne / remove ────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('throws NotFoundException when task does not exist', async () => {
      taskRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove()', () => {
    it('deletes the calendar event before removing the task', async () => {
      const task = makeTask({
        googleCalendarEventId: 'evt-1',
        assignee: { id: 'user-1' } as any,
      });
      taskRepo.findOne.mockResolvedValueOnce(task);

      await service.remove('task-uuid');

      expect(calendarService.deleteCalendarEvent).toHaveBeenCalledWith(task);
      expect(taskRepo.remove).toHaveBeenCalledWith(task);
    });
  });
});
