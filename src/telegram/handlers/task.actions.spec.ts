import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import {
  handleToggleTask,
  handleApproveTasks,
  handleCancelTasks,
  handleBackToSuggestions,
} from './task.actions';
import { UserState } from '../telegram.types';
import { TasksService } from '../../tasks/tasks.service';

const makeCtx = (overrides: Record<string, unknown> = {}) => ({
  reply: jest.fn(),
  editMessageText: jest
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  answerCbQuery: jest.fn(),
  from: { id: 123 },
  match: ['toggle_0', '0'],
  ...overrides,
});

describe('task.actions', () => {
  let userStates: Map<number, UserState>;

  beforeEach(() => {
    userStates = new Map();
  });

  describe('handleToggleTask()', () => {
    it('answers with "Task not found" when there is no pending task at the index', async () => {
      const ctx = makeCtx();

      await handleToggleTask(ctx, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Task not found.');
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });

    it('toggles isApproved and re-renders the suggestions', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      const ctx = makeCtx();

      await handleToggleTask(ctx, userStates);

      expect(userStates.get(123)?.pendingTasks?.[0].isApproved).toBe(false);
      expect(ctx.editMessageText).toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    });

    it('still answers the callback query when editMessageText throws', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      const ctx = makeCtx();
      (ctx.editMessageText as jest.Mock<(...args: unknown[]) => Promise<void>>).mockRejectedValueOnce(
        new Error('message not modified'),
      );

      await handleToggleTask(ctx, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    });
  });

  describe('handleApproveTasks()', () => {
    let bulkCreateTasks: jest.Mock<TasksService['bulkCreateTasks']>;
    let tasksService: TasksService;

    beforeEach(() => {
      bulkCreateTasks = jest.fn<TasksService['bulkCreateTasks']>().mockResolvedValue([]);
      tasksService = { bulkCreateTasks } as unknown as TasksService;
    });

    it('answers when there are no approved tasks', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: false }],
      });
      const ctx = makeCtx();

      await handleApproveTasks(ctx, tasksService, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('No tasks selected to approve.');
      expect(bulkCreateTasks).not.toHaveBeenCalled();
    });

    it('saves only the approved tasks and clears pending state on success', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [
          { title: 'Vacuum', isApproved: true },
          { title: 'Dishes', isApproved: false },
        ],
      });
      const ctx = makeCtx();

      await handleApproveTasks(ctx, tasksService, userStates);

      expect(bulkCreateTasks).toHaveBeenCalledWith('hh-1', [
        { title: 'Vacuum', isApproved: true },
      ]);
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('1 tasks saved successfully'),
        { parse_mode: 'Markdown' },
      );
      expect(userStates.get(123)?.pendingTasks).toEqual([]);
    });

    it('answers with a failure message when saving throws', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      bulkCreateTasks.mockRejectedValueOnce(new Error('db down'));
      const ctx = makeCtx();

      await handleApproveTasks(ctx, tasksService, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Failed to save tasks.');
    });
  });

  describe('handleCancelTasks()', () => {
    it('clears pending tasks and shows the fallback manual-entry URL', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      const ctx = makeCtx();

      await handleCancelTasks(ctx, userStates);

      expect(userStates.get(123)?.pendingTasks).toEqual([]);
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('https://roomies.com'),
        { parse_mode: 'Markdown' },
      );
    });

    it('does not throw when there is no prior state', async () => {
      const ctx = makeCtx();

      await expect(handleCancelTasks(ctx, userStates)).resolves.not.toThrow();
      expect(ctx.editMessageText).toHaveBeenCalled();
    });
  });

  describe('handleBackToSuggestions()', () => {
    it('answers the callback with no message when there are no pending tasks', async () => {
      const ctx = makeCtx();

      await handleBackToSuggestions(ctx, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith();
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });

    it('re-renders the suggestions when pending tasks exist', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      const ctx = makeCtx();

      await handleBackToSuggestions(ctx, userStates);

      expect(ctx.editMessageText).toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    });
  });
});
