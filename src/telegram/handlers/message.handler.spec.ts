import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { handleTextMessage } from './message.handler';
import { UserState } from '../telegram.types';
import { TasksService } from '../../tasks/tasks.service';

const makeCtx = (overrides: Record<string, unknown> = {}) => ({
  reply: jest.fn(),
  from: { id: 123 },
  message: { text: '' },
  ...overrides,
});

describe('message.handler', () => {
  let processTelegramMessage: jest.Mock<TasksService['processTelegramMessage']>;
  let tasksService: TasksService;
  let userStates: Map<number, UserState>;

  beforeEach(() => {
    processTelegramMessage = jest.fn();
    tasksService = { processTelegramMessage } as unknown as TasksService;
    userStates = new Map();
  });

  describe('handleTextMessage()', () => {
    it('ignores messages that start with a slash', async () => {
      const ctx = makeCtx({ message: { text: '/start' } });

      await handleTextMessage(ctx, tasksService, userStates);

      expect(ctx.reply).not.toHaveBeenCalled();
      expect(processTelegramMessage).not.toHaveBeenCalled();
    });

    it('asks the user to link a household first when no state exists', async () => {
      const ctx = makeCtx({ message: { text: 'buy milk' } });

      await handleTextMessage(ctx, tasksService, userStates);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('link your household first'),
      );
      expect(processTelegramMessage).not.toHaveBeenCalled();
    });

    describe('custom date input flow', () => {
      it('resets the awaiting flag and replies with an error when the pending task is missing', async () => {
        userStates.set(123, {
          householdId: 'hh-1',
          awaitingDateForTaskIndex: 0,
          pendingTasks: [],
        });
        const ctx = makeCtx({ message: { text: '2026-05-10' } });

        await handleTextMessage(ctx, tasksService, userStates);

        expect(userStates.get(123)?.awaitingDateForTaskIndex).toBeUndefined();
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('Something went wrong'),
        );
      });

      it('replies with a format error for an unparseable date', async () => {
        userStates.set(123, {
          householdId: 'hh-1',
          awaitingDateForTaskIndex: 0,
          pendingTasks: [{ title: 'Vacuum', isApproved: true }],
        });
        const ctx = makeCtx({ message: { text: 'not-a-date' } });

        await handleTextMessage(ctx, tasksService, userStates);

        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('Invalid date format'),
        );
      });

      it('sets the due date, clears the awaiting flag, and re-shows the suggestions', async () => {
        userStates.set(123, {
          householdId: 'hh-1',
          awaitingDateForTaskIndex: 0,
          pendingTasks: [{ title: 'Vacuum', isApproved: true }],
        });
        const ctx = makeCtx({ message: { text: '2026-05-10' } });

        await handleTextMessage(ctx, tasksService, userStates);

        const state = userStates.get(123);
        expect(state?.awaitingDateForTaskIndex).toBeUndefined();
        expect(state?.pendingTasks?.[0].dueDate).toBe('2026-05-10');
        expect(ctx.reply).toHaveBeenCalledTimes(2);
        expect(ctx.reply).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('Vacuum'),
          { parse_mode: 'Markdown' },
        );
      });
    });

    describe('normal AI-parse flow', () => {
      it('replies when no tasks could be extracted from the message', async () => {
        userStates.set(123, { householdId: 'hh-1' });
        processTelegramMessage.mockResolvedValueOnce([]);
        const ctx = makeCtx({ message: { text: 'buy milk' } });

        await handleTextMessage(ctx, tasksService, userStates);

        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('Could not find any tasks'),
        );
      });

      it('stores approved pending tasks and shows suggestions on success', async () => {
        userStates.set(123, { householdId: 'hh-1' });
        processTelegramMessage.mockResolvedValueOnce([
          { title: 'Buy milk' },
          { title: 'Clean kitchen' },
        ]);
        const ctx = makeCtx({ message: { text: 'buy milk, clean kitchen' } });

        await handleTextMessage(ctx, tasksService, userStates);

        const state = userStates.get(123);
        expect(state?.pendingTasks).toEqual([
          { title: 'Buy milk', isApproved: true },
          { title: 'Clean kitchen', isApproved: true },
        ]);
        expect(ctx.reply).toHaveBeenCalledWith('🔍 Analyzing your message...');
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('Buy milk'),
          expect.objectContaining({ parse_mode: 'Markdown' }),
        );
      });

      it('replies with a generic error when AI parsing throws', async () => {
        userStates.set(123, { householdId: 'hh-1' });
        processTelegramMessage.mockRejectedValueOnce(new Error('gemini down'));
        const ctx = makeCtx({ message: { text: 'buy milk' } });

        await handleTextMessage(ctx, tasksService, userStates);

        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('something went wrong'),
        );
      });
    });
  });
});
