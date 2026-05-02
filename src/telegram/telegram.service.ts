import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf, Context, Markup } from 'telegraf';
import { TasksService } from '../tasks/tasks.service';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: Telegraf;
  private readonly logger = new Logger(TelegramService.name);
  
  // In-memory store for pending tasks and linked households
  // In production, use Redis or a Database
  private userStates = new Map<number, { householdId: string; pendingTasks?: any[] }>();

  constructor(private readonly tasksService: TasksService) {
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
    this.bot.launch().then(() => {
      this.logger.log('Telegram Bot launched successfully');
    }).catch(err => {
      this.logger.error('Failed to launch Telegram Bot', err);
    });
  }

  private setupHandlers() {
    // Welcome message
    this.bot.start((ctx) => {
      ctx.reply(
        'Welcome to Roomies Bot! 🏠\n\n' +
        'Please link your household first by sending:\n' +
        '`/link YOUR_HOUSEHOLD_ID`',
        { parse_mode: 'Markdown' }
      );
    });

    // Link household
    this.bot.command('link', (ctx) => {
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) {
        return ctx.reply('Usage: /link <household_id>');
      }
      const householdId = parts[1];
      this.userStates.set(ctx.from.id, { householdId });
      ctx.reply(`✅ Linked to Household: ${householdId}`);
    });

    // Handle free text
    this.bot.on('text', async (ctx) => {
      const chatId = ctx.from.id;
      const state = this.userStates.get(chatId);

      if (!state?.householdId) {
        return ctx.reply('Please link your household first using /link <household_id>');
      }

      const message = ctx.message.text;
      if (message.startsWith('/')) return; // Ignore other commands

      await ctx.reply('🔍 Analyzing your message...');

      try {
        const tasks = await this.tasksService.processTelegramMessage(state.householdId, message);
        
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
          ])
        );
      } catch (error) {
        this.logger.error('Error processing telegram message', error);
        ctx.reply('❌ Sorry, something went wrong while processing your message.');
      }
    });

    // Handle Approval
    this.bot.action('approve_tasks', async (ctx) => {
      const chatId = ctx.from.id;
      const state = this.userStates.get(chatId);

      if (!state?.pendingTasks || state.pendingTasks.length === 0) {
        return ctx.answerCbQuery('No tasks to approve.');
      }

      try {
        await this.tasksService.bulkCreateTasks(state.householdId, state.pendingTasks);
        await ctx.editMessageText('✅ *Tasks saved successfully!*', { parse_mode: 'Markdown' });
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
        { parse_mode: 'Markdown' }
      );
    });
  }
}
