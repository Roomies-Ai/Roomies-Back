import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import type { GenerateContentResult } from '@google/generative-ai';
import { Task } from '../models/task.entity';
import { Household } from '../models/household.entity';
import { TaskStatus } from '../helpers/consts';
import { TasksService } from './tasks.service';
import { StatsService } from '../stats/stats.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { RecurrenceRule } from '../helpers/recurrence.helper';
import { promptGemini } from '../helpers/gemini';

jest.mock('../helpers/gemini');

const makeGeminiResult = (text: string): GenerateContentResult => ({
  response: {
    text: () => text,
    functionCall: () => undefined,
    functionCalls: () => undefined,
  },
});

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
  let householdRepo: ReturnType<typeof mockRepo>;
  let statsService: ReturnType<typeof mockStatsService>;
  let calendarService: ReturnType<typeof mockCalendarService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    taskRepo = mockRepo();
    householdRepo = mockRepo();
    statsService = mockStatsService();
    calendarService = mockCalendarService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        { provide: getRepositoryToken(Household), useValue: householdRepo },
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

  // ── findAll ──────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('queries without filters when neither status nor householdId is given', async () => {
      await service.findAll();

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: {},
        relations: ['household', 'assignee', 'taskType'],
      });
    });

    it('filters by status only', async () => {
      await service.findAll(TaskStatus.COMPLETED);

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: { status: TaskStatus.COMPLETED },
        relations: ['household', 'assignee', 'taskType'],
      });
    });

    it('filters by householdId only', async () => {
      await service.findAll(undefined, 'hh-uuid');

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: { household: { id: 'hh-uuid' } },
        relations: ['household', 'assignee', 'taskType'],
      });
    });

    it('filters by both status and householdId', async () => {
      await service.findAll(TaskStatus.PENDING, 'hh-uuid');

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: { status: TaskStatus.PENDING, household: { id: 'hh-uuid' } },
        relations: ['household', 'assignee', 'taskType'],
      });
    });
  });

  // ── findMyTasks ──────────────────────────────────────────────────────────────

  describe('findMyTasks()', () => {
    it('builds a query scoped to the assignee, active-or-recent status, ordered by due date', async () => {
      const qb = makeQb();
      const tasks = [makeTask()];
      qb.getMany.mockResolvedValueOnce(tasks);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      const result = await service.findMyTasks('user-1');

      expect(qb.where).toHaveBeenCalledWith('task.assignee.id = :userId', {
        userId: 'user-1',
      });
      expect(qb.andWhere).toHaveBeenCalledTimes(1);
      expect(qb.orderBy).toHaveBeenCalledWith('task.dueDate', 'ASC');
      expect(result).toBe(tasks);
    });
  });

  // ── findRecurrenceInstances ──────────────────────────────────────────────────

  describe('findRecurrenceInstances()', () => {
    it('finds instances by recurrenceParentId ordered by due date', async () => {
      const instances = [makeTask({ recurrenceParentId: 'template-1' })];
      taskRepo.find.mockResolvedValueOnce(instances);

      const result = await service.findRecurrenceInstances('template-1');

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: { recurrenceParentId: 'template-1' },
        relations: ['assignee', 'taskType'],
        order: { dueDate: 'ASC' },
      });
      expect(result).toBe(instances);
    });
  });

  // ── nudgeAssignee ────────────────────────────────────────────────────────────

  describe('nudgeAssignee()', () => {
    // NOTE: this currently only console.logs a mock notification and does not
    // call the real TelegramService — these tests document current (likely
    // incomplete) behavior rather than asserting a real nudge was sent.
    it('throws NotFoundException when the task does not exist', async () => {
      taskRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.nudgeAssignee('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the task has no assignee', async () => {
      taskRepo.findOne.mockResolvedValueOnce(makeTask({ assignee: null }));

      await expect(service.nudgeAssignee('task-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a canned success message on success', async () => {
      taskRepo.findOne.mockResolvedValueOnce(
        makeTask({ title: 'Vacuum', assignee: { username: 'jane' } as any }),
      );

      const result = await service.nudgeAssignee('task-uuid');

      expect(result).toEqual({
        message: 'Nudge sent via Telegram successfully',
        taskId: 'task-uuid',
        user: 'jane',
      });
    });
  });

  // ── generateTasks (Gemini) ───────────────────────────────────────────────────

  describe('generateTasks()', () => {
    it('strips ```json fences and parses the AI response', async () => {
      jest
        .mocked(promptGemini)
        .mockResolvedValueOnce(
          makeGeminiResult('```json\n[{"title":"Clean"}]\n```'),
        );

      const result = await service.generateTasks({ name: 'My House' });

      expect(result).toEqual([{ title: 'Clean' }]);
    });

    it('swallows Gemini errors and returns an empty array', async () => {
      jest.mocked(promptGemini).mockRejectedValueOnce(new Error('gemini down'));

      const result = await service.generateTasks({ name: 'My House' });

      expect(result).toEqual([]);
    });
  });

  // ── processTelegramMessage (Gemini) ──────────────────────────────────────────

  describe('processTelegramMessage()', () => {
    it('throws NotFoundException when the household does not exist', async () => {
      jest.spyOn(service, 'findHouseholdById').mockResolvedValueOnce(null);

      await expect(
        service.processTelegramMessage('hh-uuid', 'buy milk'),
      ).rejects.toThrow(NotFoundException);
    });

    it('parses the AI response into tasks on success', async () => {
      jest
        .spyOn(service, 'findHouseholdById')
        .mockResolvedValueOnce({ id: 'hh-uuid', name: 'My House' } as Household);
      jest
        .mocked(promptGemini)
        .mockResolvedValueOnce(makeGeminiResult('[{"title":"Buy milk"}]'));

      const result = await service.processTelegramMessage('hh-uuid', 'buy milk');

      expect(result).toEqual([{ title: 'Buy milk' }]);
    });

    it('returns an empty array (with its own try/catch) when the AI response is malformed JSON', async () => {
      jest
        .spyOn(service, 'findHouseholdById')
        .mockResolvedValueOnce({ id: 'hh-uuid', name: 'My House' } as Household);
      jest.mocked(promptGemini).mockResolvedValueOnce(makeGeminiResult('not json'));

      const result = await service.processTelegramMessage('hh-uuid', 'buy milk');

      expect(result).toEqual([]);
    });
  });

  // ── bulkCreateTasks ──────────────────────────────────────────────────────────

  describe('bulkCreateTasks()', () => {
    const member = { id: 'user-1', username: 'jane' } as any;
    const taskType = { id: 'tt-1', name: 'Cleaning' } as any;
    const household = {
      id: 'hh-uuid',
      members: [member],
      taskTypes: [taskType],
    } as Household;

    it('throws NotFoundException when the household does not exist', async () => {
      jest.spyOn(service, 'findHouseholdById').mockResolvedValueOnce(null);

      await expect(
        service.bulkCreateTasks('hh-uuid', [{ title: 'Clean' }]),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves assignee by username string and taskType by name string', async () => {
      jest.spyOn(service, 'findHouseholdById').mockResolvedValueOnce(household);
      taskRepo.save.mockImplementationOnce((async (t: unknown) => t) as any);

      const [saved] = (await service.bulkCreateTasks('hh-uuid', [
        { title: 'Clean', assignee: 'jane', taskType: 'Cleaning' },
      ])) as unknown as Task[];

      expect(saved.assignee).toBe(member);
      expect(saved.taskType).toBe(taskType);
    });

    it('resolves assignee and taskType when passed as objects', async () => {
      jest.spyOn(service, 'findHouseholdById').mockResolvedValueOnce(household);
      taskRepo.save.mockImplementationOnce((async (t: unknown) => t) as any);

      const [saved] = (await service.bulkCreateTasks('hh-uuid', [
        { title: 'Clean', assignee: member, taskType: { id: 'tt-1' } },
      ])) as unknown as Task[];

      expect(saved.assignee).toBe(member);
      expect(saved.taskType).toBe(taskType);
    });

    it('defaults status to PENDING when not provided', async () => {
      jest.spyOn(service, 'findHouseholdById').mockResolvedValueOnce(household);
      taskRepo.save.mockImplementationOnce((async (t: unknown) => t) as any);

      const [saved] = (await service.bulkCreateTasks('hh-uuid', [
        { title: 'Clean' },
      ])) as unknown as Task[];

      expect(saved.status).toBe(TaskStatus.PENDING);
    });

    it('clears the stats cache once per call, not once per task', async () => {
      jest.spyOn(service, 'findHouseholdById').mockResolvedValueOnce(household);
      taskRepo.save.mockImplementationOnce((async (t: unknown) => t) as any);

      await service.bulkCreateTasks('hh-uuid', [
        { title: 'Clean' },
        { title: 'Cook' },
      ]);

      expect(statsService.clearCache).toHaveBeenCalledTimes(1);
      expect(statsService.clearCache).toHaveBeenCalledWith('hh-uuid');
    });

    it('fires a calendar event per saved task that has both assignee and dueDate', async () => {
      jest.spyOn(service, 'findHouseholdById').mockResolvedValueOnce(household);
      const dueDate = new Date();
      taskRepo.save.mockImplementationOnce((async (tasks: unknown) => tasks) as any);

      await service.bulkCreateTasks('hh-uuid', [
        { title: 'Clean', assignee: 'jane', dueDate },
        { title: 'No due date', assignee: 'jane' },
      ]);

      expect(calendarService.createCalendarEvent).toHaveBeenCalledTimes(1);
    });
  });

  // ── handleOverdueTasks (cron) ────────────────────────────────────────────────

  describe('handleOverdueTasks()', () => {
    it('does nothing when there are no overdue tasks', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.handleOverdueTasks();

      expect(taskRepo.update).not.toHaveBeenCalled();
      expect(statsService.clearCache).not.toHaveBeenCalled();
    });

    it('bulk-updates overdue tasks and clears the cache once per distinct household', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([
        makeTask({ id: 'task-1', household: { id: 'hh-1' } as Household }),
        makeTask({ id: 'task-2', household: { id: 'hh-1' } as Household }),
      ]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.handleOverdueTasks();

      expect(taskRepo.update).toHaveBeenCalledWith(
        ['task-1', 'task-2'],
        { status: TaskStatus.OVERDUE },
      );
      expect(statsService.clearCache).toHaveBeenCalledTimes(1);
      expect(statsService.clearCache).toHaveBeenCalledWith('hh-1');
    });

    it('clears the cache once per distinct household when tasks span multiple households', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([
        makeTask({ id: 'task-1', household: { id: 'hh-1' } as Household }),
        makeTask({ id: 'task-2', household: { id: 'hh-2' } as Household }),
      ]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.handleOverdueTasks();

      expect(statsService.clearCache).toHaveBeenCalledTimes(2);
      expect(statsService.clearCache).toHaveBeenCalledWith('hh-1');
      expect(statsService.clearCache).toHaveBeenCalledWith('hh-2');
    });
  });

  // ── generateRecurringInstances error isolation ──────────────────────────────

  describe('generateRecurringInstances() error isolation', () => {
    it('continues processing remaining templates when one fails', async () => {
      const templateA = makeTask({ id: 'template-a', recurrenceRule: WEEKLY_RULE });
      const templateB = makeTask({ id: 'template-b', recurrenceRule: WEEKLY_RULE });
      taskRepo.find.mockResolvedValueOnce([templateA, templateB]);

      const scheduleSpy = jest
        .spyOn(service as any, 'scheduleUpcomingInstances')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined);

      await expect(service.generateRecurringInstances()).resolves.toBeUndefined();

      expect(scheduleSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ── findHouseholdByInviteCode / findHouseholdById ───────────────────────────

  describe('findHouseholdByInviteCode()', () => {
    it('passes through to the repository with optional relations', async () => {
      const household = { id: 'hh-uuid' } as Household;
      householdRepo.findOne.mockResolvedValueOnce(household);

      const result = await service.findHouseholdByInviteCode('ABCD1234', [
        'members',
      ]);

      expect(householdRepo.findOne).toHaveBeenCalledWith({
        where: { inviteCode: 'ABCD1234' },
        relations: ['members'],
      });
      expect(result).toBe(household);
    });
  });

  describe('findHouseholdById()', () => {
    it('returns null immediately for a non-UUID id without querying the repository', async () => {
      const result = await service.findHouseholdById('not-a-uuid');

      expect(result).toBeNull();
      expect(householdRepo.findOne).not.toHaveBeenCalled();
    });

    it('queries the repository for a valid UUID', async () => {
      const household = { id: 'hh-uuid' } as Household;
      householdRepo.findOne.mockResolvedValueOnce(household);

      const result = await service.findHouseholdById(
        '11111111-1111-1111-1111-111111111111',
        ['taskTypes'],
      );

      expect(householdRepo.findOne).toHaveBeenCalledWith({
        where: { id: '11111111-1111-1111-1111-111111111111' },
        relations: ['taskTypes'],
      });
      expect(result).toBe(household);
    });
  });
});
