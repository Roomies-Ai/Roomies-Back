import { TasksService } from '../../tasks/tasks.service';
import { UserState } from '../telegram.types';

export const handleStart = async (ctx: any) => {
  await ctx.reply(
    'Welcome to Roomies Bot! 🏠\n\n' +
    'Please link your household first by sending:\n' +
    '`/link YOUR_INVITE_CODE`',
    { parse_mode: 'Markdown' }
  );
};

export const handleLink = async (ctx: any, tasksService: TasksService, userStates: Map<number, UserState>) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) {
    return ctx.reply('Usage: /link <invite_code>');
  }
  
  const inviteCode = parts[1];
  const household = await tasksService.findHouseholdByInviteCode(inviteCode);
  
  if (!household) {
    return ctx.reply(`❌ Could not find a household with Invite Code: ${inviteCode}`);
  }

  userStates.set(ctx.from.id, { householdId: household.id });
  await ctx.reply(
    `✅ Linked to Household: *${household.name}*\n\n` +
    `Now simply *write what you need* (e.g., "The kitchen is a mess and we need to buy milk") and I will extract the tasks for you! 🪄`,
    { parse_mode: 'Markdown' }
  );
};
