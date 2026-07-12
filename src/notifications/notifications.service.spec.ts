import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { Household } from '../models/household.entity';
import { TaskStatus } from '../helpers/consts';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from './notifications.service';

const makeQb = () => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
});

const mockTaskRepo = () => ({
  createQueryBuilder: jest
    .fn<() => ReturnType<typeof makeQb>>()
    .mockImplementation(() => makeQb()),
});

const makeUser = (overrides: Partial<User> = {}): User =>
  ({ id: 'user-1', username: 'jane', telegramChatId: 'chat-1', ...overrides }) as User;

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-1',
    title: 'Take out trash',
    assignee: makeUser(),
    household: { id: 'hh-1', name: 'The House' } as Household,
    ...overrides,
  }) as Task;

describe('NotificationsService', () => {
  let service: NotificationsService;
  let taskRepo: ReturnType<typeof mockTaskRepo>;
  let telegramService: { sendMessage: jest.Mock<(chatId: string, text: string) => Promise<void>> };

  beforeEach(async () => {
    taskRepo = mockTaskRepo();
    telegramService = {
      sendMessage: jest.fn<(chatId: string, text: string) => Promise<void>>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        { provide: TelegramService, useValue: telegramService },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  // ── getMyNotifications() ─────────────────────────────────────────────────

  describe('getMyNotifications()', () => {
    it('builds a query scoped to today, the user, and non-completed status', async () => {
      const qb = makeQb();
      const tasks = [makeTask()];
      qb.getMany.mockResolvedValueOnce(tasks);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      const result = await service.getMyNotifications('user-1');

      expect(qb.where).toHaveBeenCalledWith('task.assignee = :userId', {
        userId: 'user-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'task.status != :completed',
        { completed: TaskStatus.COMPLETED },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('task.dueDate', 'ASC');
      expect(result).toBe(tasks);
    });
  });

  // ── sendDailyTelegramReminders() ─────────────────────────────────────────

  describe('sendDailyTelegramReminders()', () => {
    it('sends no messages when there are no tasks due today', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.sendDailyTelegramReminders();

      expect(telegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('skips tasks whose assignee has no telegramChatId (defense in depth)', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([
        makeTask({ assignee: makeUser({ telegramChatId: null }) }),
      ]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.sendDailyTelegramReminders();

      expect(telegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('filters the query to tasks whose assignee has a telegramChatId', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.sendDailyTelegramReminders();

      expect(qb.andWhere).toHaveBeenCalledWith(
        'assignee.telegramChatId IS NOT NULL',
      );
    });

    it('groups multiple tasks for the same user into a single message using singular wording for one task', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([makeTask({ id: 'task-1', title: 'Vacuum' })]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.sendDailyTelegramReminders();

      expect(telegramService.sendMessage).toHaveBeenCalledTimes(1);
      const [chatId, message] = telegramService.sendMessage.mock.calls[0];
      expect(chatId).toBe('chat-1');
      expect(message).toContain('You have 1 task due today');
      expect(message).toContain('Vacuum');
    });

    it('uses plural wording and lists every task when a user has more than one', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([
        makeTask({ id: 'task-1', title: 'Vacuum' }),
        makeTask({ id: 'task-2', title: 'Dishes' }),
      ]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.sendDailyTelegramReminders();

      expect(telegramService.sendMessage).toHaveBeenCalledTimes(1);
      const [, message] = telegramService.sendMessage.mock.calls[0];
      expect(message).toContain('You have 2 tasks due today');
      expect(message).toContain('Vacuum');
      expect(message).toContain('Dishes');
    });

    it('includes the household name suffix only when present', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([
        makeTask({ household: { id: 'hh-1', name: 'The House' } as Household }),
      ]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.sendDailyTelegramReminders();

      const [, message] = telegramService.sendMessage.mock.calls[0];
      expect(message).toContain('(The House)');
    });

    it('omits the household suffix when the household has no name', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([
        makeTask({ household: { id: 'hh-1', name: '' } as Household }),
      ]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.sendDailyTelegramReminders();

      const [, message] = telegramService.sendMessage.mock.calls[0];
      expect(message).not.toContain('()');
    });

    it('sends one message per distinct user and logs the total sent count', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([
        makeTask({ id: 'task-1', assignee: makeUser({ id: 'user-1', telegramChatId: 'chat-1' }) }),
        makeTask({ id: 'task-2', assignee: makeUser({ id: 'user-2', telegramChatId: 'chat-2' }) }),
      ]);
      taskRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await service.sendDailyTelegramReminders();

      expect(telegramService.sendMessage).toHaveBeenCalledTimes(2);
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.any(String),
      );
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        'chat-2',
        expect.any(String),
      );
    });
  });
});
