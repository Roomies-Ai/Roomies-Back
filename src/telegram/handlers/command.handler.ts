import { TasksService } from '../../tasks/tasks.service';
import { UsersService } from '../../users/users.service';
import { UserState } from '../telegram.types';

export const handleStart = async (ctx: any, usersService: UsersService) => {
  const payload: string = ctx.startPayload || '';

  if (payload.startsWith('link_')) {
    const token = payload.slice(5);
    const user = await usersService.findByTelegramToken(token);

    if (!user) {
      return ctx.reply(
        '❌ Invalid or expired link token.\n\nPlease generate a new one from the Roomies app profile page.',
      );
    }

    const chatId = String(ctx.from.id);

    if (user.telegramChatId === chatId) {
      return ctx.reply(
        '✅ Your Telegram is already linked to this Roomies account!',
      );
    }

    await usersService.saveTelegramChatId(user.id, chatId);

    return ctx.reply(
      `✅ *Telegram linked successfully!*\n\nWelcome, ${user.username}! You will now receive Roomies task notifications here. 🏠`,
      { parse_mode: 'Markdown' },
    );
  }

  return ctx.reply(
    'Welcome to Roomies Bot! 🏠\n\n' +
      'Please link your household first by sending:\n' +
      '`/link YOUR_INVITE_CODE`',
    { parse_mode: 'Markdown' },
  );
};

export const handleConnect = async (ctx: any, usersService: UsersService) => {
  try {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) {
      return ctx.reply(
        'Usage: /connect YOUR_TOKEN\n\nFind your token in the Roomies app under Profile → Telegram.',
      );
    }

    // Strip @BotName suffix some Telegram clients append (e.g. /connect TOKEN@RoomiesUserNameBot)
    const raw = parts[1].split('@')[0];
    const token = raw.toUpperCase();

    const user = await usersService.findByTelegramToken(token);

    if (!user) {
      return ctx.reply(
        '❌ Invalid or expired token.\n\nPlease generate a new one from the Roomies app profile page.',
      );
    }

    const chatId = String(ctx.from.id);

    if (user.telegramChatId === chatId) {
      return ctx.reply(
        '✅ Your Telegram is already linked to this Roomies account!',
      );
    }

    await usersService.saveTelegramChatId(user.id, chatId);

    return ctx.reply(
      `✅ *Telegram linked successfully!*\n\nWelcome, ${user.username}! You will now receive Roomies task notifications here. 🏠`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    console.error('handleConnect error:', err);
    return ctx.reply('❌ Something went wrong. Please try again.');
  }
};

export const handleLink = async (
  ctx: any,
  tasksService: TasksService,
  userStates: Map<number, UserState>,
) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) {
    return ctx.reply('Usage: /link <invite_code>');
  }

  const inviteCode = parts[1];
  const household = await tasksService.findHouseholdByInviteCode(inviteCode);

  if (!household) {
    return ctx.reply(
      `❌ Could not find a household with Invite Code: ${inviteCode}`,
    );
  }

  userStates.set(ctx.from.id, { householdId: household.id });
  await ctx.reply(
    `✅ Linked to Household: *${household.name}*\n\n` +
      `Now simply *write what you need* (e.g., "The kitchen is a mess and we need to buy milk") and I will extract the tasks for you! 🪄`,
    { parse_mode: 'Markdown' },
  );
};
