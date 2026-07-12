import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';

const mockBotFactory = () => ({
  catch: jest.fn(),
  start: jest.fn(),
  command: jest.fn(),
  on: jest.fn(),
  action: jest.fn(),
  launch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  telegram: {
    sendMessage: jest
      .fn<(chatId: string, text: string) => Promise<void>>()
      .mockResolvedValue(undefined),
  },
});

let lastBotInstance: ReturnType<typeof mockBotFactory> | undefined;

jest.mock('telegraf', () => ({
  Telegraf: jest.fn().mockImplementation(() => {
    lastBotInstance = mockBotFactory();
    return lastBotInstance;
  }),
}));

const makeConfigService = (token: string | undefined) =>
  ({ get: jest.fn().mockReturnValue(token) }) as unknown as ConfigService;

describe('TelegramService', () => {
  beforeEach(() => {
    lastBotInstance = undefined;
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('logs an error and leaves the bot unset when BOT_TOKEN is missing', () => {
      const service = new TelegramService(
        {} as TasksService,
        {} as UsersService,
        makeConfigService(undefined),
      );

      expect((service as unknown as { bot: unknown }).bot).toBeUndefined();
    });

    it('creates a Telegraf bot when BOT_TOKEN is present', () => {
      const service = new TelegramService(
        {} as TasksService,
        {} as UsersService,
        makeConfigService('tok'),
      );

      expect((service as unknown as { bot: unknown }).bot).toBe(lastBotInstance);
    });
  });

  describe('sendMessage()', () => {
    it('is a no-op when the bot was never initialized', async () => {
      const service = new TelegramService(
        {} as TasksService,
        {} as UsersService,
        makeConfigService(undefined),
      );

      await expect(service.sendMessage('chat-1', 'hi')).resolves.toBeUndefined();
    });

    it('sends the message via the bot on success', async () => {
      const service = new TelegramService(
        {} as TasksService,
        {} as UsersService,
        makeConfigService('tok'),
      );

      await service.sendMessage('chat-1', 'hi');

      expect(lastBotInstance?.telegram.sendMessage).toHaveBeenCalledWith('chat-1', 'hi');
    });

    it('swallows errors from the underlying bot without rethrowing', async () => {
      const service = new TelegramService(
        {} as TasksService,
        {} as UsersService,
        makeConfigService('tok'),
      );
      (lastBotInstance?.telegram.sendMessage as jest.Mock).mockRejectedValueOnce(
        new Error('network down'),
      );

      await expect(service.sendMessage('chat-1', 'hi')).resolves.toBeUndefined();
    });
  });

  describe('onModuleInit()', () => {
    it('does nothing when the bot was never initialized', () => {
      const service = new TelegramService(
        {} as TasksService,
        {} as UsersService,
        makeConfigService(undefined),
      );

      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('registers the expected commands, text handler, and actions, then launches', () => {
      const service = new TelegramService(
        {} as TasksService,
        {} as UsersService,
        makeConfigService('tok'),
      );

      service.onModuleInit();

      const bot = lastBotInstance!;
      expect(bot.catch).toHaveBeenCalled();
      expect(bot.start).toHaveBeenCalledWith(expect.any(Function));
      expect(bot.command).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(bot.command).toHaveBeenCalledWith('link', expect.any(Function));
      expect(bot.on).toHaveBeenCalledWith('text', expect.any(Function));
      // toggle_, date_menu_, calendar_nav_, 'ignore', custom_date_prompt_,
      // set_date_, back_to_suggestions, approve_tasks, cancel_tasks
      expect(bot.action).toHaveBeenCalledTimes(9);
      expect(bot.launch).toHaveBeenCalled();
    });
  });
});
