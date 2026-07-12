import { TasksService } from '../../tasks/tasks.service';
import { UserState } from '../telegram.types';
import * as keyboards from '../telegram.keyboards';
import { env } from '../../config/env';

export const handleToggleTask = async (ctx: any, userStates: Map<number, UserState>) => {
  const index = parseInt(ctx.match[1]);
  const chatId = ctx.from.id;
  const state = userStates.get(chatId);

  if (!state?.pendingTasks?.[index]) return ctx.answerCbQuery('Task not found.');

  state.pendingTasks[index].isApproved = !state.pendingTasks[index].isApproved;
  userStates.set(chatId, state);

  try {
    await ctx.editMessageText(
      keyboards.getSuggestionsText(state.pendingTasks),
      { 
        parse_mode: 'Markdown',
        ...keyboards.getSuggestionsKeyboard(state.pendingTasks)
      }
    );
    await ctx.answerCbQuery();
  } catch (e) {
    await ctx.answerCbQuery();
  }
};

export const handleApproveTasks = async (ctx: any, tasksService: TasksService, userStates: Map<number, UserState>) => {
  const chatId = ctx.from.id;
  const state = userStates.get(chatId);
  const approvedTasks = state?.pendingTasks?.filter(t => t.isApproved) || [];

  if (approvedTasks.length === 0) {
    return ctx.answerCbQuery('No tasks selected to approve.');
  }

  try {
    if(state){
      await tasksService.bulkCreateTasks(state.householdId, approvedTasks);
      await ctx.editMessageText(`✅ *${approvedTasks.length} tasks saved successfully!*`, { parse_mode: 'Markdown' });
      state.pendingTasks = [];
      userStates.set(chatId, state);
    }
  } catch (error) {
    console.error('Error saving tasks', error);
    await ctx.answerCbQuery('Failed to save tasks.');
  }
};

export const handleCancelTasks = async (ctx: any, userStates: Map<number, UserState>) => {
  const chatId = ctx.from.id;
  const state = userStates.get(chatId);
  if (state) state.pendingTasks = [];
  const manualUrl = env.get('WEBSITE_MANUAL_URL', { infer: true }) || 'https://roomies.com';
  await ctx.editMessageText(
    `❌ *Action cancelled.*\n\nYou can always add tasks manually on our website:\n${manualUrl}`,
    { parse_mode: 'Markdown' }
  );
};

export const handleBackToSuggestions = async (ctx: any, userStates: Map<number, UserState>) => {
  const chatId = ctx.from.id;
  const state = userStates.get(chatId);
  if (!state?.pendingTasks) return ctx.answerCbQuery();

  await ctx.editMessageText(
    keyboards.getSuggestionsText(state.pendingTasks),
    { 
      parse_mode: 'Markdown',
      ...keyboards.getSuggestionsKeyboard(state.pendingTasks)
    }
  );
  await ctx.answerCbQuery();
};
