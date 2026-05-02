import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf, Context, Markup } from 'telegraf';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: Telegraf;
  private readonly logger = new Logger(TelegramService.name);
  private readonly TOKEN_REGEX = /^[0-9A-F]{8}$/;

  // In-memory store for pending tasks and linked households
  // In production, use Redis or a Database
  private userStates = new Map<
    number,
    { householdId?: string; pendingTasks?: any[]; userId?: string }
  >();

  constructor(
    private readonly tasksService: TasksService,
    private readonly usersService: UsersService,
  ) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      this.logger.error('BOT_TOKEN not found in environment');
      return;
    }
    this.bot = new Telegraf(token);
  }

  onModuleInit() {
    if (!this.bot) return;
    this.setupHandlers();
    this.bot
      .launch()
      .then(() => {
        this.logger.log('Telegram Bot launched successfully');
      })
      .catch((err) => {
        this.logger.error('Failed to launch Telegram Bot', err);
      });
  }

  private setupHandlers() {
    // Welcome message
    this.bot.start((ctx) => {
      const state = this.userStates.get(ctx.from.id);
      if (state?.userId) {
        ctx.reply('Welcome back! Send a message to add tasks to your household.');
      } else {
        ctx.reply(
          'Welcome to Roomies Bot! 🏠\n\n' +
            'To get started, send your personal Roomies token.\n' +
            'Find it in the app under Profile → Telegram.',
        );
      }
    });

    // Link household
    this.bot.command('link', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) {
        return ctx.reply('Usage: /link <invite_code>');
      }

      const inviteCode = parts[1];
      const household =
        await this.tasksService.findHouseholdByInviteCode(inviteCode);

      if (!household) {
        return ctx.reply(
          `❌ Could not find a household with Invite Code: ${inviteCode}`,
        );
      }

      const state = this.userStates.get(ctx.from.id) || {};
      this.userStates.set(ctx.from.id, { ...state, householdId: household.id });
      ctx.reply(`✅ Linked to Household: *${household.name}*`, {
        parse_mode: 'Markdown',
      });
    });

    // Handle free text
    this.bot.on('text', async (ctx) => {
      const chatId = ctx.from.id;
      const state = this.userStates.get(chatId);
      const message = ctx.message.text;

      if (message.startsWith('/')) return; // Ignore other commands

      // Token registration — intercept before household guard
      if (this.TOKEN_REGEX.test(message)) {
        const user = await this.usersService.findByTelegramToken(message);
        if (!user) {
          return ctx.reply('❌ Invalid token. Please check the Roomies app.');
        }
        const chatIdStr = String(ctx.from.id);
        if (user.telegramChatId === chatIdStr) {
          return ctx.reply(
            'You are already linked! Send /link <inviteCode> to connect your household.',
          );
        }
        await this.usersService.saveTelegramChatId(user.id, chatIdStr);
        this.userStates.set(chatId, { ...state, userId: user.id });
        return ctx.reply(
          '✅ Your Telegram account is now linked!\n\nNext, connect your household:\n`/link YOUR_INVITE_CODE`',
          { parse_mode: 'Markdown' },
        );
      }

      if (!state?.householdId) {
        return ctx.reply(
          'Please link your household first using /link <invite_code>',
        );
      }

      await ctx.reply('🔍 Analyzing your message...');

      try {
        const tasks = await this.tasksService.processTelegramMessage(
          state.householdId,
          message,
        );

        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
          return ctx.reply('❌ Could not find any tasks in your message.');
        }

        state.pendingTasks = tasks;
        this.userStates.set(chatId, state);

        let response = '📋 *Suggested Tasks:*\n\n';
        tasks.forEach((t, i) => {
          response += `${i + 1}. *${t.title}* (${t.points} pts)\n_${t.description}_\n\n`;
        });

        await ctx.replyWithMarkdown(
          response,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve & Save', 'approve_tasks')],
            [Markup.button.callback('❌ Cancel', 'cancel_tasks')],
          ]),
        );
      } catch (error) {
        this.logger.error('Error processing telegram message', error);
        ctx.reply(
          '❌ Sorry, something went wrong while processing your message.',
        );
      }
    });

    // Handle Approval
    this.bot.action('approve_tasks', async (ctx) => {
      const chatId = ctx.from.id;
      const state = this.userStates.get(chatId);

      if (!state?.pendingTasks || state.pendingTasks.length === 0) {
        return ctx.answerCbQuery('No tasks to approve.');
      }

      if (!state.householdId) {
        return ctx.answerCbQuery('No household linked. Use /link first.');
      }

      try {
        await this.tasksService.bulkCreateTasks(
          state.householdId,
          state.pendingTasks,
        );
        await ctx.editMessageText('✅ *Tasks saved successfully!*', {
          parse_mode: 'Markdown',
        });
        state.pendingTasks = [];
        this.userStates.set(chatId, state);
      } catch (error) {
        this.logger.error('Error saving tasks', error);
        ctx.answerCbQuery('Failed to save tasks.');
      }
    });

    // Handle Cancellation
    this.bot.action('cancel_tasks', async (ctx) => {
      const chatId = ctx.from.id;
      const state = this.userStates.get(chatId);

      if (state) state.pendingTasks = [];

      const manualUrl = process.env.WEBSITE_MANUAL_URL || 'https://roomies.com';
      await ctx.editMessageText(
        `❌ *Action cancelled.*\n\nYou can always add tasks manually on our website:\n${manualUrl}`,
        { parse_mode: 'Markdown' },
      );
    });
  }

  async sendMessageToUser(userId: string, message: string): Promise<void> {
    const user = await this.usersService.findUserById(userId);
    if (!user?.telegramChatId) {
      this.logger.warn(`User ${userId} has no Telegram chatId registered`);
      return;
    }
    await this.bot.telegram.sendMessage(user.telegramChatId, message);
  }
}
