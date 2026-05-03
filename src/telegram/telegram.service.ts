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
        '`/link YOUR_INVITE_CODE`',
        { parse_mode: 'Markdown' }
      );
    });

    // Link household
    this.bot.command('link', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) {
        return ctx.reply('Usage: /link <invite_code>');
      }
      
      const inviteCode = parts[1];
      const household = await this.tasksService.findHouseholdByInviteCode(inviteCode);
      
      if (!household) {
        return ctx.reply(`❌ Could not find a household with Invite Code: ${inviteCode}`);
      }

      this.userStates.set(ctx.from.id, { householdId: household.id }); // Store the actual UUID for processing
      ctx.reply(`✅ Linked to Household: *${household.name}*`, { parse_mode: 'Markdown' });
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

        // Initialize all tasks as approved
        state.pendingTasks = tasks.map(t => ({ ...t, isApproved: true }));
        this.userStates.set(chatId, state);

        await ctx.replyWithMarkdown(
          this.getSuggestionsText(state.pendingTasks),
          this.getSuggestionsKeyboard(state.pendingTasks)
        );
      } catch (error) {
        this.logger.error('Error processing telegram message', error);
        ctx.reply('❌ Sorry, something went wrong while processing your message.');
      }
    });

    // Handle Individual Toggle
    this.bot.action(/^toggle_(\d+)$/, async (ctx) => {
      const index = parseInt(ctx.match[1]);
      const chatId = ctx.from.id;
      const state = this.userStates.get(chatId);

      if (!state?.pendingTasks?.[index]) return ctx.answerCbQuery('Task not found.');

      state.pendingTasks[index].isApproved = !state.pendingTasks[index].isApproved;
      this.userStates.set(chatId, state);

      try {
        await ctx.editMessageText(
          this.getSuggestionsText(state.pendingTasks),
          { 
            parse_mode: 'Markdown',
            ...this.getSuggestionsKeyboard(state.pendingTasks)
          }
        );
        ctx.answerCbQuery();
      } catch (e) {
        // Message might be same, ignore
        ctx.answerCbQuery();
      }
    });

    // Handle Approval
    this.bot.action('approve_tasks', async (ctx) => {
      const chatId = ctx.from.id;
      const state = this.userStates.get(chatId);
      const approvedTasks = state?.pendingTasks?.filter(t => t.isApproved) || [];

      if (approvedTasks.length === 0) {
        return ctx.answerCbQuery('No tasks selected to approve.');
      }

      try {
        if(state){
          await this.tasksService.bulkCreateTasks(state.householdId, approvedTasks);
          await ctx.editMessageText(`✅ *${approvedTasks.length} tasks saved successfully!*`, { parse_mode: 'Markdown' });
          state.pendingTasks = [];
          this.userStates.set(chatId, state);
        }
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

  private getSuggestionsText(tasks: any[]): string {
    let response = '📋 *AI Suggestions*\n\n';
    tasks.forEach((t, i) => {
      const status = t.isApproved ? '✅' : '⬜';
      response += `${status} ${i + 1}. *${t.title}*\n_${t.description}_\n\n`;
    });
    return response;
  }

  private getSuggestionsKeyboard(tasks: any[]) {
    const buttons = tasks.map((t, i) => [
      Markup.button.callback(
        `${t.isApproved ? '✅' : '⬜'} Task ${i + 1}: ${t.title.substring(0, 15)}...`, 
        `toggle_${i}`
      )
    ]);

    const approvedCount = tasks.filter(t => t.isApproved).length;

    return Markup.inlineKeyboard([
      ...buttons,
      [
        Markup.button.callback(`💾 Confirm (${approvedCount})`, 'approve_tasks'),
        Markup.button.callback('❌ Cancel', 'cancel_tasks')
      ]
    ]);
  }
}
