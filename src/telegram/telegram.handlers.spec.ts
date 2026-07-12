import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { TelegramHandlers } from './telegram.handlers';
import * as commandHandlers from './handlers/command.handler';
import * as messageHandlers from './handlers/message.handler';
import * as taskActions from './handlers/task.actions';
import * as dateActions from './handlers/date.actions';
import { UserState } from './telegram.types';

describe('TelegramHandlers (adapter)', () => {
  let handlers: TelegramHandlers;
  let tasksService: object;
  let usersService: object;
  let userStates: Map<number, UserState>;
  let ctx: object;

  beforeEach(() => {
    jest.restoreAllMocks();
    tasksService = {};
    usersService = {};
    userStates = new Map();
    handlers = new TelegramHandlers(tasksService as any, usersService as any, userStates);
    ctx = { from: { id: 1 }, match: [] };
  });

  it('handleStart() delegates to commandHandlers.handleStart', async () => {
    const spy = jest.spyOn(commandHandlers, 'handleStart').mockResolvedValue(undefined);

    await handlers.handleStart(ctx);

    expect(spy).toHaveBeenCalledWith(ctx);
  });

  it('handleConnect() delegates to commandHandlers.handleConnect with usersService', async () => {
    const spy = jest.spyOn(commandHandlers, 'handleConnect').mockResolvedValue(undefined);

    await handlers.handleConnect(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, usersService);
  });

  it('handleLink() delegates to commandHandlers.handleLink with tasksService and userStates', async () => {
    const spy = jest.spyOn(commandHandlers, 'handleLink').mockResolvedValue(undefined);

    await handlers.handleLink(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, tasksService, userStates);
  });

  it('handleTextMessage() delegates to messageHandlers.handleTextMessage', async () => {
    const spy = jest
      .spyOn(messageHandlers, 'handleTextMessage')
      .mockResolvedValue(undefined);

    await handlers.handleTextMessage(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, tasksService, userStates);
  });

  it('handleToggleTask() delegates to taskActions.handleToggleTask', async () => {
    const spy = jest.spyOn(taskActions, 'handleToggleTask').mockResolvedValue(undefined);

    await handlers.handleToggleTask(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, userStates);
  });

  it('handleApproveTasks() delegates to taskActions.handleApproveTasks', async () => {
    const spy = jest
      .spyOn(taskActions, 'handleApproveTasks')
      .mockResolvedValue(undefined);

    await handlers.handleApproveTasks(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, tasksService, userStates);
  });

  it('handleCancelTasks() delegates to taskActions.handleCancelTasks', async () => {
    const spy = jest.spyOn(taskActions, 'handleCancelTasks').mockResolvedValue(undefined);

    await handlers.handleCancelTasks(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, userStates);
  });

  it('handleBackToSuggestions() delegates to taskActions.handleBackToSuggestions', async () => {
    const spy = jest
      .spyOn(taskActions, 'handleBackToSuggestions')
      .mockResolvedValue(undefined);

    await handlers.handleBackToSuggestions(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, userStates);
  });

  it('handleDateMenu() delegates to dateActions.handleDateMenu', async () => {
    const spy = jest.spyOn(dateActions, 'handleDateMenu').mockResolvedValue(undefined);

    await handlers.handleDateMenu(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, userStates);
  });

  it('handleCalendarNav() delegates to dateActions.handleCalendarNav', async () => {
    const spy = jest.spyOn(dateActions, 'handleCalendarNav').mockResolvedValue(undefined);

    await handlers.handleCalendarNav(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, userStates);
  });

  it('handleCustomDatePrompt() delegates to dateActions.handleCustomDatePrompt', async () => {
    const spy = jest
      .spyOn(dateActions, 'handleCustomDatePrompt')
      .mockResolvedValue(undefined);

    await handlers.handleCustomDatePrompt(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, userStates);
  });

  it('handleSetDate() delegates to dateActions.handleSetDate', async () => {
    const spy = jest.spyOn(dateActions, 'handleSetDate').mockResolvedValue(undefined);

    await handlers.handleSetDate(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, userStates);
  });
});
