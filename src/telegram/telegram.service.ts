import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { TasksService } from '../tasks/tasks.service';
import { UserState } from './telegram.types';
import { TelegramHandlers } from './telegram.handlers';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: Telegraf;
  private readonly logger = new Logger(TelegramService.name);
  private userStates = new Map<number, UserState>();
  private handlers: TelegramHandlers;

  constructor(private readonly tasksService: TasksService) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      this.logger.error('BOT_TOKEN not found in environment');
      return;
    }
    this.bot = new Telegraf(token);
    this.handlers = new TelegramHandlers(this.tasksService, this.userStates);
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
    // Commands
    this.bot.start((ctx) => this.handlers.handleStart(ctx));
    this.bot.command('link', (ctx) => this.handlers.handleLink(ctx));

    // Messages
    this.bot.on('text', (ctx) => this.handlers.handleTextMessage(ctx));

    // Actions
    this.bot.action(/^toggle_(\d+)$/, (ctx) => this.handlers.handleToggleTask(ctx));
    this.bot.action(/^date_menu_(\d+)$/, (ctx) => this.handlers.handleDateMenu(ctx));
    this.bot.action(/^calendar_nav_(\d+)_(\d+)_(\d+)$/, (ctx) => this.handlers.handleCalendarNav(ctx));
    this.bot.action('ignore', (ctx) => ctx.answerCbQuery());
    this.bot.action(/^custom_date_prompt_(\d+)$/, (ctx) => this.handlers.handleCustomDatePrompt(ctx));
    this.bot.action(/^set_date_(\d+)_(.+)$/, (ctx) => this.handlers.handleSetDate(ctx));
    this.bot.action('back_to_suggestions', (ctx) => this.handlers.handleBackToSuggestions(ctx));
    this.bot.action('approve_tasks', (ctx) => this.handlers.handleApproveTasks(ctx));
    this.bot.action('cancel_tasks', (ctx) => this.handlers.handleCancelTasks(ctx));
  }
}
