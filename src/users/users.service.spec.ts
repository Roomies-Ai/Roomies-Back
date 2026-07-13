import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { User } from '../models/user.entity';
import { TaskType } from '../models/task-type.entity';
import { UsersService } from './users.service';

const compareMock =
  jest.fn<(password: string, hash: string) => Promise<boolean>>();
const hashMock =
  jest.fn<(password: string, rounds: number) => Promise<string>>();
jest.mock('bcryptjs', () => ({
  compare: (password: string, hash: string) => compareMock(password, hash),
  hash: (password: string, rounds: number) => hashMock(password, rounds),
}));

const makeQb = () => ({
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  getOne: jest.fn<() => Promise<unknown | null>>().mockResolvedValue(null),
});

const userId = crypto.randomUUID();
const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: userId,
    username: 'jane',
    email: 'jane@example.com',
    password: 'hashed-pw',
    telegramToken: null,
    telegramChatId: null,
    preferredTaskTypes: [],
    ...overrides,
  }) as User;

const mockUserRepo = () => ({
  createQueryBuilder: jest
    .fn<() => ReturnType<typeof makeQb>>()
    .mockImplementation(() => makeQb()),
  findOneBy: jest.fn<(where: object) => Promise<User | null>>(),
  save: jest
    .fn<(user: User) => Promise<User>>()
    .mockImplementation((u) => Promise.resolve(u)),
  update: jest
    .fn<(id: string, data: object) => Promise<object>>()
    .mockResolvedValue({}),
  findOne: jest.fn<(options: object) => Promise<User | null>>(),
});

const mockTaskTypeRepo = () => ({
  createQueryBuilder: jest
    .fn<() => ReturnType<typeof makeQb>>()
    .mockImplementation(() => makeQb()),
});

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let taskTypeRepo: ReturnType<typeof mockTaskTypeRepo>;

  beforeEach(async () => {
    jest.clearAllMocks();
    userRepo = mockUserRepo();
    taskTypeRepo = mockTaskTypeRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(TaskType), useValue: taskTypeRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  // ── getAvailableTaskTypes() ──────────────────────────────────────────────

  describe('getAvailableTaskTypes()', () => {
    it('maps task types to id/name/householdName', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([
        { id: 'tt-1', name: 'Cleaning', household: { name: 'The House' } },
        { id: 'tt-2', name: 'Cooking', household: null },
      ]);
      taskTypeRepo.createQueryBuilder.mockReturnValueOnce(qb);

      const result = await service.getAvailableTaskTypes(userId);

      expect(qb.where).toHaveBeenCalledWith('member.id = :userId', {
        userId,
      });
      expect(result).toEqual([
        { id: 'tt-1', name: 'Cleaning', householdName: 'The House' },
        { id: 'tt-2', name: 'Cooking', householdName: undefined },
      ]);
    });
  });

  // ── findOne() ────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('returns the user with joined relations', async () => {
      const qb = makeQb();
      const user = makeUser();
      qb.getOne.mockResolvedValueOnce(user);
      userRepo.createQueryBuilder.mockReturnValueOnce(qb);

      const result = await service.findOne(userId);

      expect(qb.where).toHaveBeenCalledWith('user.id = :id', { id: userId });
      expect(result).toBe(user);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      const qb = makeQb();
      qb.getOne.mockResolvedValueOnce(null);
      userRepo.createQueryBuilder.mockReturnValueOnce(qb);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updatePreferredTasks() ───────────────────────────────────────────────

  describe('updatePreferredTasks()', () => {
    it('maps taskTypeIds to stub entities, saves, and re-fetches the user', async () => {
      const qb = makeQb();
      qb.getOne.mockResolvedValue(makeUser());
      userRepo.createQueryBuilder.mockReturnValue(qb);

      await service.updatePreferredTasks(userId, ['tt-1', 'tt-2']);

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredTaskTypes: [{ id: 'tt-1' }, { id: 'tt-2' }],
        }),
      );
    });
  });

  // ── findUserById() ───────────────────────────────────────────────────────

  describe('findUserById()', () => {
    it('returns the user when found', async () => {
      const user = makeUser();
      userRepo.findOneBy.mockResolvedValueOnce(user);

      const result = await service.findUserById(userId);

      expect(result).toBe(user);
    });

    it('returns null when not found', async () => {
      userRepo.findOneBy.mockResolvedValueOnce(null);

      const result = await service.findUserById('missing');

      expect(result).toBeNull();
    });
  });

  // ── generateTelegramToken() ──────────────────────────────────────────────

  describe('generateTelegramToken()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      userRepo.findOneBy.mockResolvedValueOnce(null);

      await expect(service.generateTelegramToken('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('generates and saves a token on success', async () => {
      userRepo.findOneBy
        .mockResolvedValueOnce(makeUser()) // load user
        .mockResolvedValueOnce(null); // no collision

      const result = await service.generateTelegramToken(userId);

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramToken: expect.stringMatching(/^[0-9A-F]{8}$/),
        }),
      );
      expect(result).toBeDefined();
    });

    it('retries when the generated token collides with an existing one', async () => {
      userRepo.findOneBy
        .mockResolvedValueOnce(makeUser()) // load user
        .mockResolvedValueOnce(makeUser({ telegramToken: 'COLLIDE1' })) // first attempt collides
        .mockResolvedValueOnce(null); // second attempt is free

      await service.generateTelegramToken(userId);

      expect(userRepo.findOneBy).toHaveBeenCalledTimes(3);
    });
  });

  // ── saveTelegramChatId() / unlinkTelegramChatId() ───────────────────────

  describe('saveTelegramChatId()', () => {
    it('updates the telegramChatId field', async () => {
      await service.saveTelegramChatId(userId, 'chat-1');

      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        telegramChatId: 'chat-1',
      });
    });
  });

  describe('unlinkTelegramChatId()', () => {
    it('clears the chatId and rotates the telegram token', async () => {
      userRepo.findOneBy
        .mockResolvedValueOnce(makeUser())
        .mockResolvedValueOnce(null);

      await service.unlinkTelegramChatId(userId);

      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        telegramChatId: null,
      });
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ telegramToken: expect.any(String) }),
      );
    });
  });

  // ── update() ─────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates the record and returns the re-fetched user', async () => {
      const qb = makeQb();
      const updated = makeUser({ username: 'new-name' });
      qb.getOne.mockResolvedValueOnce(updated);
      userRepo.createQueryBuilder.mockReturnValueOnce(qb);

      const result = await service.update(userId, { username: 'new-name' });

      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        username: 'new-name',
      });
      expect(result).toBe(updated);
    });
  });

  // ── Google Calendar token helpers ────────────────────────────────────────

  describe('saveGoogleCalendarTokens()', () => {
    it('persists all three token fields and enables sync', async () => {
      const expiresAt = new Date();

      await service.saveGoogleCalendarTokens(userId, {
        googleAccessToken: 'acc',
        googleRefreshToken: 'ref',
        googleTokenExpiresAt: expiresAt,
      });

      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        googleAccessToken: 'acc',
        googleRefreshToken: 'ref',
        googleTokenExpiresAt: expiresAt,
        calendarSyncEnabled: true,
      });
    });
  });

  describe('clearGoogleCalendarTokens()', () => {
    it('nulls all three token fields and disables sync', async () => {
      await service.clearGoogleCalendarTokens(userId);

      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiresAt: null,
        calendarSyncEnabled: false,
      });
    });
  });

  describe('setCalendarSyncEnabled()', () => {
    it('toggles the flag to true', async () => {
      await service.setCalendarSyncEnabled(userId, true);
      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        calendarSyncEnabled: true,
      });
    });

    it('toggles the flag to false', async () => {
      await service.setCalendarSyncEnabled(userId, false);
      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        calendarSyncEnabled: false,
      });
    });
  });

  // ── updatePassword() ─────────────────────────────────────────────────────

  describe('updatePassword()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updatePassword('missing', 'old', 'new'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws a plain Error (not a Nest exception) when the old password is wrong', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser());
      compareMock.mockResolvedValueOnce(false);

      // The controller relies on this NOT being a NestJS HttpException subtype,
      // since it catches generically and wraps it as UnauthorizedException itself.
      await expect(
        service.updatePassword(userId, 'wrong', 'new'),
      ).rejects.toMatchObject({
        message: 'Incorrect current password',
        constructor: Error,
      });
    });

    it('hashes and saves the new password on success', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser());
      compareMock.mockResolvedValueOnce(true);
      hashMock.mockResolvedValueOnce('new-hashed-pw');

      await service.updatePassword(userId, 'old', 'new');

      expect(hashMock).toHaveBeenCalledWith('new', 10);
      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        password: 'new-hashed-pw',
      });
    });
  });
});
