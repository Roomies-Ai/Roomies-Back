import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { handleStart, handleConnect, handleLink } from './command.handler';
import { UserState } from '../telegram.types';
import { UsersService } from '../../users/users.service';
import { TasksService } from '../../tasks/tasks.service';
import { User } from '../../models/user.entity';
import { Household } from '../../models/household.entity';

const makeCtx = (overrides: Record<string, unknown> = {}) => ({
  reply: jest.fn(),
  editMessageText: jest.fn(),
  answerCbQuery: jest.fn(),
  from: { id: 123 },
  message: { text: '' },
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User =>
  ({ id: 'user-1', username: 'jane', ...overrides }) as User;

const makeHousehold = (overrides: Partial<Household> = {}): Household =>
  ({ id: 'hh-1', name: 'The House', ...overrides }) as Household;

describe('command.handler', () => {
  describe('handleStart()', () => {
    it('replies with the welcome message using Markdown', async () => {
      const ctx = makeCtx();

      await handleStart(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to Roomies Bot'),
        { parse_mode: 'Markdown' },
      );
    });
  });

  describe('handleConnect()', () => {
    let findByTelegramToken: jest.Mock<UsersService['findByTelegramToken']>;
    let saveTelegramChatId: jest.Mock<UsersService['saveTelegramChatId']>;
    let usersService: UsersService;

    beforeEach(() => {
      findByTelegramToken = jest.fn();
      saveTelegramChatId = jest.fn<UsersService['saveTelegramChatId']>().mockResolvedValue(undefined);
      usersService = {
        findByTelegramToken,
        saveTelegramChatId,
      } as unknown as UsersService;
    });

    it('shows usage when no token argument is given', async () => {
      const ctx = makeCtx({ message: { text: '/connect' } });

      await handleConnect(ctx, usersService);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /connect'));
      expect(findByTelegramToken).not.toHaveBeenCalled();
    });

    it('strips a @BotName suffix and uppercases the token before lookup', async () => {
      findByTelegramToken.mockResolvedValueOnce(null);
      const ctx = makeCtx({ message: { text: '/connect abc123@RoomiesBot' } });

      await handleConnect(ctx, usersService);

      expect(findByTelegramToken).toHaveBeenCalledWith('ABC123');
    });

    it('replies with an error when the token is invalid or expired', async () => {
      findByTelegramToken.mockResolvedValueOnce(null);
      const ctx = makeCtx({ message: { text: '/connect BADTOKEN' } });

      await handleConnect(ctx, usersService);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Invalid or expired token'));
    });

    it('replies that the account is already linked without re-saving the chatId', async () => {
      findByTelegramToken.mockResolvedValueOnce(
        makeUser({ telegramChatId: '123' }),
      );
      const ctx = makeCtx({ message: { text: '/connect GOODTOKEN' }, from: { id: 123 } });

      await handleConnect(ctx, usersService);

      expect(saveTelegramChatId).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('already linked'));
    });

    it('links a new chatId and replies with a success message', async () => {
      findByTelegramToken.mockResolvedValueOnce(
        makeUser({ telegramChatId: null }),
      );
      const ctx = makeCtx({ message: { text: '/connect GOODTOKEN' }, from: { id: 999 } });

      await handleConnect(ctx, usersService);

      expect(saveTelegramChatId).toHaveBeenCalledWith('user-1', '999');
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('linked successfully'),
        { parse_mode: 'Markdown' },
      );
    });

    it('replies with a generic error when the lookup throws', async () => {
      findByTelegramToken.mockRejectedValueOnce(new Error('db down'));
      const ctx = makeCtx({ message: { text: '/connect GOODTOKEN' } });

      await handleConnect(ctx, usersService);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'));
    });
  });

  describe('handleLink()', () => {
    let findHouseholdByInviteCode: jest.Mock<TasksService['findHouseholdByInviteCode']>;
    let tasksService: TasksService;
    let userStates: Map<number, UserState>;

    beforeEach(() => {
      findHouseholdByInviteCode = jest.fn();
      tasksService = { findHouseholdByInviteCode } as unknown as TasksService;
      userStates = new Map();
    });

    it('shows usage when no invite code argument is given', async () => {
      const ctx = makeCtx({ message: { text: '/link' } });

      await handleLink(ctx, tasksService, userStates);

      expect(ctx.reply).toHaveBeenCalledWith('Usage: /link <invite_code>');
      expect(findHouseholdByInviteCode).not.toHaveBeenCalled();
    });

    it('replies with an error when the invite code is unknown', async () => {
      findHouseholdByInviteCode.mockResolvedValueOnce(null);
      const ctx = makeCtx({ message: { text: '/link BADCODE' } });

      await handleLink(ctx, tasksService, userStates);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Could not find a household'));
      expect(userStates.size).toBe(0);
    });

    it('stores the household in state and replies with its name on success', async () => {
      findHouseholdByInviteCode.mockResolvedValueOnce(
        makeHousehold({ id: 'hh-1', name: 'The House' }),
      );
      const ctx = makeCtx({ message: { text: '/link GOODCODE' }, from: { id: 555 } });

      await handleLink(ctx, tasksService, userStates);

      expect(userStates.get(555)).toEqual({ householdId: 'hh-1' });
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('The House'),
        { parse_mode: 'Markdown' },
      );
    });
  });
});
