import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import {
  handleDateMenu,
  handleCalendarNav,
  handleCustomDatePrompt,
  handleSetDate,
} from './date.actions';
import { UserState } from '../telegram.types';

const makeCtx = (overrides: Record<string, unknown> = {}) => ({
  editMessageText: jest.fn().mockResolvedValue(undefined),
  answerCbQuery: jest.fn(),
  from: { id: 123 },
  match: ['', '0'],
  ...overrides,
});

describe('date.actions', () => {
  let userStates: Map<number, UserState>;

  beforeEach(() => {
    userStates = new Map();
  });

  describe('handleDateMenu()', () => {
    it('answers with "Task not found" when there is no pending task at the index', async () => {
      const ctx = makeCtx();

      await handleDateMenu(ctx, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Task not found.');
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });

    it('renders the calendar keyboard for the current month on success', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      const ctx = makeCtx();

      await handleDateMenu(ctx, userStates);

      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Vacuum'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
      expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    });
  });

  describe('handleCalendarNav()', () => {
    it('answers with "Task not found" when there is no pending task at the index', async () => {
      const ctx = makeCtx({ match: ['', '0', '2026', '4'] });

      await handleCalendarNav(ctx, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Task not found.');
    });

    it('renders the calendar keyboard for the requested year/month', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      const ctx = makeCtx({ match: ['', '0', '2026', '4'] });

      await handleCalendarNav(ctx, userStates);

      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Vacuum'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
      expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    });
  });

  describe('handleCustomDatePrompt()', () => {
    it('answers with "Task not found" when there is no pending task at the index', async () => {
      const ctx = makeCtx();

      await handleCustomDatePrompt(ctx, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Task not found.');
      expect(userStates.get(123)?.awaitingDateForTaskIndex).toBeUndefined();
    });

    it('sets the awaiting-date flag and prompts for free-text input', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      const ctx = makeCtx();

      await handleCustomDatePrompt(ctx, userStates);

      expect(userStates.get(123)?.awaitingDateForTaskIndex).toBe(0);
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Vacuum'),
        { parse_mode: 'Markdown' },
      );
      expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    });
  });

  describe('handleSetDate()', () => {
    it('answers with "Task not found" when there is no pending task at the index', async () => {
      const ctx = makeCtx({ match: ['', '0', '2026-05-10'] });

      await handleSetDate(ctx, userStates);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Task not found.');
    });

    it('sets the due date directly from the callback data and re-renders suggestions', async () => {
      userStates.set(123, {
        householdId: 'hh-1',
        pendingTasks: [{ title: 'Vacuum', isApproved: true }],
      });
      const ctx = makeCtx({ match: ['', '0', '2026-05-10'] });

      await handleSetDate(ctx, userStates);

      expect(userStates.get(123)?.pendingTasks?.[0].dueDate).toBe('2026-05-10');
      expect(ctx.editMessageText).toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Date set to 2026-05-10');
    });
  });
});
