import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { handleStart, handleConnect, handleLink } from './command.handler';
import { UserState } from '../telegram.types';

const makeCtx = (overrides: Record<string, unknown> = {}) => ({
  reply: jest.fn(),
  editMessageText: jest.fn(),
  answerCbQuery: jest.fn(),
  from: { id: 123 },
  message: { text: '' },
  ...overrides,
});

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
    let usersService: {
      findByTelegramToken: jest.Mock;
      saveTelegramChatId: jest.Mock;
    };

    beforeEach(() => {
      usersService = {
        findByTelegramToken: jest.fn(),
        saveTelegramChatId: jest.fn().mockResolvedValue(undefined),
      };
    });

    it('shows usage when no token argument is given', async () => {
      const ctx = makeCtx({ message: { text: '/connect' } });

      await handleConnect(ctx, usersService as any);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /connect'));
      expect(usersService.findByTelegramToken).not.toHaveBeenCalled();
    });

    it('strips a @BotName suffix and uppercases the token before lookup', async () => {
      usersService.findByTelegramToken.mockResolvedValueOnce(null);
      const ctx = makeCtx({ message: { text: '/connect abc123@RoomiesBot' } });

      await handleConnect(ctx, usersService as any);

      expect(usersService.findByTelegramToken).toHaveBeenCalledWith('ABC123');
    });

    it('replies with an error when the token is invalid or expired', async () => {
      usersService.findByTelegramToken.mockResolvedValueOnce(null);
      const ctx = makeCtx({ message: { text: '/connect BADTOKEN' } });

      await handleConnect(ctx, usersService as any);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Invalid or expired token'));
    });

    it('replies that the account is already linked without re-saving the chatId', async () => {
      usersService.findByTelegramToken.mockResolvedValueOnce({
        id: 'user-1',
        username: 'jane',
        telegramChatId: '123',
      });
      const ctx = makeCtx({ message: { text: '/connect GOODTOKEN' }, from: { id: 123 } });

      await handleConnect(ctx, usersService as any);

      expect(usersService.saveTelegramChatId).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('already linked'));
    });

    it('links a new chatId and replies with a success message', async () => {
      usersService.findByTelegramToken.mockResolvedValueOnce({
        id: 'user-1',
        username: 'jane',
        telegramChatId: null,
      });
      const ctx = makeCtx({ message: { text: '/connect GOODTOKEN' }, from: { id: 999 } });

      await handleConnect(ctx, usersService as any);

      expect(usersService.saveTelegramChatId).toHaveBeenCalledWith('user-1', '999');
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('linked successfully'),
        { parse_mode: 'Markdown' },
      );
    });

    it('replies with a generic error when the lookup throws', async () => {
      usersService.findByTelegramToken.mockRejectedValueOnce(new Error('db down'));
      const ctx = makeCtx({ message: { text: '/connect GOODTOKEN' } });

      await handleConnect(ctx, usersService as any);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'));
    });
  });

  describe('handleLink()', () => {
    let tasksService: { findHouseholdByInviteCode: jest.Mock };
    let userStates: Map<number, UserState>;

    beforeEach(() => {
      tasksService = { findHouseholdByInviteCode: jest.fn() };
      userStates = new Map();
    });

    it('shows usage when no invite code argument is given', async () => {
      const ctx = makeCtx({ message: { text: '/link' } });

      await handleLink(ctx, tasksService as any, userStates);

      expect(ctx.reply).toHaveBeenCalledWith('Usage: /link <invite_code>');
      expect(tasksService.findHouseholdByInviteCode).not.toHaveBeenCalled();
    });

    it('replies with an error when the invite code is unknown', async () => {
      tasksService.findHouseholdByInviteCode.mockResolvedValueOnce(null);
      const ctx = makeCtx({ message: { text: '/link BADCODE' } });

      await handleLink(ctx, tasksService as any, userStates);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Could not find a household'));
      expect(userStates.size).toBe(0);
    });

    it('stores the household in state and replies with its name on success', async () => {
      tasksService.findHouseholdByInviteCode.mockResolvedValueOnce({
        id: 'hh-1',
        name: 'The House',
      });
      const ctx = makeCtx({ message: { text: '/link GOODCODE' }, from: { id: 555 } });

      await handleLink(ctx, tasksService as any, userStates);

      expect(userStates.get(555)).toEqual({ householdId: 'hh-1' });
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('The House'),
        { parse_mode: 'Markdown' },
      );
    });
  });
});
