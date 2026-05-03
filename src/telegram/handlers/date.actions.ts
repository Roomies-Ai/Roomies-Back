import { UserState } from '../telegram.types';
import * as keyboards from '../telegram.keyboards';

export const handleDateMenu = async (ctx: any, userStates: Map<number, UserState>) => {
  const index = parseInt(ctx.match[1]);
  const chatId = ctx.from.id;
  const state = userStates.get(chatId);

  if (!state?.pendingTasks?.[index]) return ctx.answerCbQuery('Task not found.');

  const now = new Date();
  await ctx.editMessageText(
    `📅 *Select Due Date for:* ${state.pendingTasks[index].title}`,
    { 
      parse_mode: 'Markdown',
      ...keyboards.getCalendarKeyboard(index, now.getFullYear(), now.getMonth())
    }
  );
  await ctx.answerCbQuery();
};

export const handleCalendarNav = async (ctx: any, userStates: Map<number, UserState>) => {
  const index = parseInt(ctx.match[1]);
  const year = parseInt(ctx.match[2]);
  const month = parseInt(ctx.match[3]);
  const chatId = ctx.from.id;
  const state = userStates.get(chatId);

  if (!state?.pendingTasks?.[index]) return ctx.answerCbQuery('Task not found.');

  await ctx.editMessageText(
    `📅 *Select Due Date for:* ${state.pendingTasks[index].title}`,
    { 
      parse_mode: 'Markdown',
      ...keyboards.getCalendarKeyboard(index, year, month)
    }
  );
  await ctx.answerCbQuery();
};

export const handleCustomDatePrompt = async (ctx: any, userStates: Map<number, UserState>) => {
  const index = parseInt(ctx.match[1]);
  const chatId = ctx.from.id;
  const state = userStates.get(chatId);

  if (!state?.pendingTasks?.[index]) return ctx.answerCbQuery('Task not found.');

  state.awaitingDateForTaskIndex = index;
  userStates.set(chatId, state);

  await ctx.editMessageText(
    `📝 *Please type the date for:* ${state.pendingTasks[index].title}\n\nExamples: \`2026-05-10\`, \`tomorrow\`, \`next Monday\``,
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCbQuery();
};

export const handleSetDate = async (ctx: any, userStates: Map<number, UserState>) => {
  const index = parseInt(ctx.match[1]);
  const dateValue = ctx.match[2];
  const chatId = ctx.from.id;
  const state = userStates.get(chatId);

  if (!state?.pendingTasks?.[index]) return ctx.answerCbQuery('Task not found.');

  state.pendingTasks[index].dueDate = dateValue;
  userStates.set(chatId, state);

  await ctx.editMessageText(
    keyboards.getSuggestionsText(state.pendingTasks),
    { 
      parse_mode: 'Markdown',
      ...keyboards.getSuggestionsKeyboard(state.pendingTasks)
    }
  );
  await ctx.answerCbQuery(`Date set to ${dateValue}`);
};
