import { Test, TestingModule } from '@nestjs/testing';
import { TelegramService } from '../src/telegram/telegram.service';
import { TasksService } from '../src/tasks/tasks.service';
import { UsersService } from '../src/users/users.service';
import { Telegraf } from 'telegraf';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const mockBotInstance = {
  start: jest.fn<(...args: unknown[]) => void>(),
  command: jest.fn<(...args: unknown[]) => void>(),
  on: jest.fn<(...args: unknown[]) => void>(),
  action: jest.fn<(...args: unknown[]) => void>(),
  launch: jest
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  telegram: {
    sendMessage: jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
  },
};

jest.mock('telegraf', () => ({
  Telegraf: jest.fn<() => unknown>().mockImplementation(() => mockBotInstance),
  Markup: {
    inlineKeyboard: jest.fn<() => unknown>().mockReturnValue({}),
    button: {
      callback: jest.fn<() => unknown>().mockReturnValue({}),
    },
  },
}));

describe('TelegramService', () => {
  let service: TelegramService;

  const mockTasksService = {
    findHouseholdByInviteCode:
      jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    processTelegramMessage: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    bulkCreateTasks: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };

  const mockUsersService = {
    findByTelegramToken: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    saveTelegramChatId: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    findUserById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };

  const buildModule = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramService,
        { provide: TasksService, useValue: mockTasksService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();
    return module.get<TelegramService>(TelegramService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.BOT_TOKEN = 'test-bot-token';
    service = await buildModule();
  });

  afterEach(() => {
    delete process.env.BOT_TOKEN;
  });

  // --- helpers to extract registered handlers ---
  const getStartHandler = () =>
    mockBotInstance.start.mock.calls[0][0] as (...args: unknown[]) => unknown;
  const getLinkHandler = () =>
    mockBotInstance.command.mock.calls[0][1] as (...args: unknown[]) => unknown;
  const getTextHandler = () =>
    mockBotInstance.on.mock.calls[0][1] as (...args: unknown[]) => unknown;
  const getApproveHandler = () =>
    mockBotInstance.action.mock.calls[0][1] as (...args: unknown[]) => unknown;
  const getCancelHandler = () =>
    mockBotInstance.action.mock.calls[1][1] as (...args: unknown[]) => unknown;

  const makeCtx = (overrides: Record<string, unknown> = {}) => ({
    from: { id: 42 },
    message: { text: '' },
    reply: jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    replyWithMarkdown: jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    answerCbQuery: jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    editMessageText: jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    ...overrides,
  });

  // ── Constructor / onModuleInit ────────────────────────────────────────────

  describe('constructor', () => {
    it('creates the Telegraf bot when BOT_TOKEN is set', () => {
      expect(Telegraf).toHaveBeenCalledWith('test-bot-token');
    });

    it('does not create bot when BOT_TOKEN is missing', async () => {
      delete process.env.BOT_TOKEN;
      jest.clearAllMocks();
      const svc = await buildModule();
      expect(Telegraf).not.toHaveBeenCalled();
      // onModuleInit should be a no-op (returns void synchronously)
      expect(svc.onModuleInit()).toBeUndefined();
    });
  });

  describe('onModuleInit', () => {
    it('registers all handlers and launches the bot', async () => {
      service.onModuleInit();
      expect(mockBotInstance.start).toHaveBeenCalled();
      expect(mockBotInstance.command).toHaveBeenCalledWith(
        'link',
        expect.any(Function),
      );
      expect(mockBotInstance.on).toHaveBeenCalledWith(
        'text',
        expect.any(Function),
      );
      expect(mockBotInstance.action).toHaveBeenCalledWith(
        'approve_tasks',
        expect.any(Function),
      );
      expect(mockBotInstance.action).toHaveBeenCalledWith(
        'cancel_tasks',
        expect.any(Function),
      );
      expect(mockBotInstance.launch).toHaveBeenCalled();
    });
  });

  // ── /start handler ────────────────────────────────────────────────────────

  describe('/start command', () => {
    beforeEach(() => service.onModuleInit());

    it('shows welcome back message for already-linked user', async () => {
      mockUsersService.findByTelegramToken.mockResolvedValue({
        id: 'u-1',
        telegramChatId: null,
      });
      mockUsersService.saveTelegramChatId.mockResolvedValue(undefined);
      await getTextHandler()(
        makeCtx({ from: { id: 42 }, message: { text: 'ABCD1234' } }),
      );

      const ctx = makeCtx({ from: { id: 42 } });
      await getStartHandler()(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Welcome back'),
      );
    });

    it('shows standard welcome when user is not yet linked', async () => {
      const ctx = makeCtx({ from: { id: 999 } });
      await getStartHandler()(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Roomies token'),
      );
    });
  });

  // ── /link command ─────────────────────────────────────────────────────────

  describe('/link command', () => {
    beforeEach(() => service.onModuleInit());

    it('replies with usage hint when no invite code is provided', async () => {
      const ctx = makeCtx({ message: { text: '/link' } });
      await getLinkHandler()(ctx);
      expect(ctx.reply).toHaveBeenCalledWith('Usage: /link <invite_code>');
    });

    it('replies with error when household is not found', async () => {
      mockTasksService.findHouseholdByInviteCode.mockResolvedValue(null);
      const ctx = makeCtx({ message: { text: '/link BADCODE' } });
      await getLinkHandler()(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Could not find a household'),
      );
    });

    it('links the household and confirms to the user', async () => {
      mockTasksService.findHouseholdByInviteCode.mockResolvedValue({
        id: 'hh-1',
        name: 'My Flat',
      });
      const ctx = makeCtx({ message: { text: '/link INVITE123' } });
      await getLinkHandler()(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('My Flat'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
    });
  });

  // ── text handler ──────────────────────────────────────────────────────────

  describe('text handler', () => {
    beforeEach(() => service.onModuleInit());

    it('ignores messages that start with /', async () => {
      const ctx = makeCtx({ message: { text: '/unknown' } });
      await getTextHandler()(ctx);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    describe('token registration', () => {
      const VALID_TOKEN = 'ABCD1234'; // matches /^[0-9A-F]{8}$/

      it('replies with error for an invalid token', async () => {
        mockUsersService.findByTelegramToken.mockResolvedValue(null);
        const ctx = makeCtx({ message: { text: VALID_TOKEN } });
        await getTextHandler()(ctx);
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('Invalid token'),
        );
      });

      it('informs user when Telegram account is already linked', async () => {
        mockUsersService.findByTelegramToken.mockResolvedValue({
          id: 'u-1',
          telegramChatId: '42',
        });
        const ctx = makeCtx({
          from: { id: 42 },
          message: { text: VALID_TOKEN },
        });
        await getTextHandler()(ctx);
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('already linked'),
        );
      });

      it('links the account and prompts to connect household on success', async () => {
        mockUsersService.findByTelegramToken.mockResolvedValue({
          id: 'u-1',
          telegramChatId: null,
        });
        mockUsersService.saveTelegramChatId.mockResolvedValue(undefined);
        const ctx = makeCtx({
          from: { id: 42 },
          message: { text: VALID_TOKEN },
        });
        await getTextHandler()(ctx);
        expect(mockUsersService.saveTelegramChatId).toHaveBeenCalledWith(
          'u-1',
          '42',
        );
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('linked'),
          expect.objectContaining({ parse_mode: 'Markdown' }),
        );
      });
    });

    it('asks user to link household when no householdId is in state', async () => {
      const ctx = makeCtx({ message: { text: 'do the laundry' } });
      await getTextHandler()(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('link your household first'),
      );
    });

    describe('task processing (household linked)', () => {
      const chatId = 7;

      beforeEach(async () => {
        // Link a household for this chat — state persists, only service mocks are reset
        mockTasksService.findHouseholdByInviteCode.mockResolvedValue({
          id: 'hh-99',
          name: 'Flat',
        });
        const linkCtx = makeCtx({
          from: { id: chatId },
          message: { text: '/link CODE' },
        });
        await getLinkHandler()(linkCtx);
        mockTasksService.findHouseholdByInviteCode.mockReset();
      });

      it('shows suggested tasks when processing succeeds', async () => {
        mockTasksService.processTelegramMessage.mockResolvedValue([
          { title: 'Clean kitchen', description: 'Wipe counters', points: 5 },
        ]);
        const ctx = makeCtx({
          from: { id: chatId },
          message: { text: 'clean the kitchen' },
        });
        await getTextHandler()(ctx);
        expect(ctx.reply).toHaveBeenCalledWith('🔍 Analyzing your message...');
        expect(ctx.replyWithMarkdown).toHaveBeenCalledWith(
          expect.stringContaining('Clean kitchen'),
          expect.anything(),
        );
      });

      it('replies with error when no tasks are extracted', async () => {
        mockTasksService.processTelegramMessage.mockResolvedValue([]);
        const ctx = makeCtx({
          from: { id: chatId },
          message: { text: 'nothing useful' },
        });
        await getTextHandler()(ctx);
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('Could not find any tasks'),
        );
      });

      it('replies with error when processing throws', async () => {
        mockTasksService.processTelegramMessage.mockRejectedValue(
          new Error('AI error'),
        );
        const ctx = makeCtx({
          from: { id: chatId },
          message: { text: 'something' },
        });
        await getTextHandler()(ctx);
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('something went wrong'),
        );
      });
    });
  });

  // ── approve_tasks action ──────────────────────────────────────────────────

  describe('approve_tasks action', () => {
    const chatId = 55;

    beforeEach(async () => {
      service.onModuleInit();
      // Link household and populate pending tasks; reset only service mocks afterwards
      mockTasksService.findHouseholdByInviteCode.mockResolvedValue({
        id: 'hh-7',
        name: 'Home',
      });
      await getLinkHandler()(
        makeCtx({ from: { id: chatId }, message: { text: '/link X' } }),
      );

      mockTasksService.processTelegramMessage.mockResolvedValue([
        { title: 'Vacuum', description: 'Living room', points: 3 },
      ]);
      await getTextHandler()(
        makeCtx({ from: { id: chatId }, message: { text: 'vacuum' } }),
      );

      mockTasksService.findHouseholdByInviteCode.mockReset();
      mockTasksService.processTelegramMessage.mockReset();
      mockTasksService.bulkCreateTasks.mockReset();
    });

    it('answers with "No tasks" when there are no pending tasks for the user', async () => {
      const ctx = makeCtx({ from: { id: 999 } }); // unknown chatId → no state
      await getApproveHandler()(ctx);
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('No tasks to approve.');
    });

    it('saves tasks and edits message on approval', async () => {
      mockTasksService.bulkCreateTasks.mockResolvedValue([]);
      const ctx = makeCtx({ from: { id: chatId } });
      await getApproveHandler()(ctx);
      expect(mockTasksService.bulkCreateTasks).toHaveBeenCalledWith(
        'hh-7',
        expect.any(Array),
      );
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Tasks saved'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
    });

    it('answers with error when bulkCreateTasks throws', async () => {
      mockTasksService.bulkCreateTasks.mockRejectedValue(new Error('DB error'));
      const ctx = makeCtx({ from: { id: chatId } });
      await getApproveHandler()(ctx);
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Failed to save tasks.');
    });
  });

  // ── cancel_tasks action ───────────────────────────────────────────────────

  describe('cancel_tasks action', () => {
    beforeEach(() => service.onModuleInit());

    it('clears pending tasks and shows cancellation message', async () => {
      const ctx = makeCtx({ from: { id: 42 } });
      await getCancelHandler()(ctx);
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('cancelled'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
    });

    it('uses WEBSITE_MANUAL_URL env var when set', async () => {
      process.env.WEBSITE_MANUAL_URL = 'https://my-roomies.app';
      const ctx = makeCtx({ from: { id: 42 } });
      await getCancelHandler()(ctx);
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('https://my-roomies.app'),
        expect.anything(),
      );
      delete process.env.WEBSITE_MANUAL_URL;
    });
  });

  // ── sendMessageToUser ─────────────────────────────────────────────────────

  describe('sendMessageToUser', () => {
    it('does not send when user has no telegramChatId', async () => {
      mockUsersService.findUserById.mockResolvedValue({
        id: 'u-1',
        telegramChatId: null,
      });
      await service.sendMessageToUser('u-1', 'Hello');
      expect(mockBotInstance.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('sends the message to the correct chat', async () => {
      mockUsersService.findUserById.mockResolvedValue({
        id: 'u-1',
        telegramChatId: '777',
      });
      await service.sendMessageToUser('u-1', 'Hello there');
      expect(mockBotInstance.telegram.sendMessage).toHaveBeenCalledWith(
        '777',
        'Hello there',
      );
    });

    it('does not send when user is not found', async () => {
      mockUsersService.findUserById.mockResolvedValue(null);
      await service.sendMessageToUser('missing', 'Hi');
      expect(mockBotInstance.telegram.sendMessage).not.toHaveBeenCalled();
    });
  });
});
