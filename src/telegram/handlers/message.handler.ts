import { TasksService } from '../../tasks/tasks.service';
import { UserState } from '../telegram.types';
import * as keyboards from '../telegram.keyboards';

export const handleTextMessage = async (ctx: any, tasksService: TasksService, userStates: Map<number, UserState>) => {
  const message = ctx.message.text;
  if (message.startsWith('/')) return;

  const chatId = ctx.from.id;
  const state = userStates.get(chatId);

  if (!state?.householdId) {
    return ctx.reply('Please link your household first using /link <invite_code>');
  }

  // Handle Custom Date Input
  if (state.awaitingDateForTaskIndex !== undefined) {
    const index = state.awaitingDateForTaskIndex;
    const task = state.pendingTasks?.[index];
    if (!task) {
      state.awaitingDateForTaskIndex = undefined;
      return ctx.reply('Something went wrong. Please try setting the date again.');
    }

    const date = new Date(message);
    if (isNaN(date.getTime())) {
      return ctx.reply('❌ Invalid date format. Please use YYYY-MM-DD or simple terms like "tomorrow".');
    }

    const dateStr = date.toISOString().split('T')[0];
    task.dueDate = dateStr;
    state.awaitingDateForTaskIndex = undefined;
    userStates.set(chatId, state);

    await ctx.reply(`✅ Date for *${task.title}* set to ${dateStr}`, { parse_mode: 'Markdown' });
    return ctx.reply(
      keyboards.getSuggestionsText(state.pendingTasks || []),
      { parse_mode: 'Markdown', ...keyboards.getSuggestionsKeyboard(state.pendingTasks || []) }
    );
  }

  await ctx.reply('🔍 Analyzing your message...');

  try {
    const tasks = await tasksService.processTelegramMessage(state.householdId, message);
    
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return ctx.reply('❌ Could not find any tasks in your message.');
    }

    state.pendingTasks = tasks.map(t => ({ ...t, isApproved: true }));
    userStates.set(chatId, state);

    await ctx.reply(
      keyboards.getSuggestionsText(state.pendingTasks),
      { parse_mode: 'Markdown', ...keyboards.getSuggestionsKeyboard(state.pendingTasks) }
    );
  } catch (error) {
    console.error('Error processing telegram message', error);
    await ctx.reply('❌ Sorry, something went wrong while processing your message.');
  }
};
