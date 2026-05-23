import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { UserState } from './telegram.types';
import * as commandHandlers from './handlers/command.handler';
import * as messageHandlers from './handlers/message.handler';
import * as taskActions from './handlers/task.actions';
import * as dateActions from './handlers/date.actions';

export class TelegramHandlers {
  constructor(
    private readonly tasksService: TasksService,
    private readonly usersService: UsersService,
    private readonly userStates: Map<number, UserState>
  ) {}

  // Command Handlers
  async handleStart(ctx: any) {
    return commandHandlers.handleStart(ctx, this.usersService);
  }

  async handleConnect(ctx: any) {
    return commandHandlers.handleConnect(ctx, this.usersService);
  }

  async handleLink(ctx: any) {
    return commandHandlers.handleLink(ctx, this.tasksService, this.userStates);
  }

  // Message Handlers
  async handleTextMessage(ctx: any) {
    return messageHandlers.handleTextMessage(ctx, this.tasksService, this.userStates);
  }

  // Task Action Handlers
  async handleToggleTask(ctx: any) {
    return taskActions.handleToggleTask(ctx, this.userStates);
  }

  async handleApproveTasks(ctx: any) {
    return taskActions.handleApproveTasks(ctx, this.tasksService, this.userStates);
  }

  async handleCancelTasks(ctx: any) {
    return taskActions.handleCancelTasks(ctx, this.userStates);
  }

  async handleBackToSuggestions(ctx: any) {
    return taskActions.handleBackToSuggestions(ctx, this.userStates);
  }

  // Date Action Handlers
  async handleDateMenu(ctx: any) {
    return dateActions.handleDateMenu(ctx, this.userStates);
  }

  async handleCalendarNav(ctx: any) {
    return dateActions.handleCalendarNav(ctx, this.userStates);
  }

  async handleCustomDatePrompt(ctx: any) {
    return dateActions.handleCustomDatePrompt(ctx, this.userStates);
  }

  async handleSetDate(ctx: any) {
    return dateActions.handleSetDate(ctx, this.userStates);
  }
}
