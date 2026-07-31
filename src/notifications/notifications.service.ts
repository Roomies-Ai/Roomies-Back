import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Task } from '../models/task.entity';
import { TaskStatus } from '../helpers/consts';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    private readonly telegramService: TelegramService,
  ) {}

  async getMyNotifications(userId: string): Promise<Task[]> {
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(2, 59, 59, 999);
    return this.taskRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.taskType', 'taskType')
      .leftJoinAndSelect('task.household', 'household')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .leftJoin('household.members', 'member')
      .where('member.id = :userId', { userId })
      .andWhere('(task.assigneeId = :userId OR task.assigneeId IS NULL)')
      .andWhere('task.dueDate <= :end', { end })
      .andWhere('task.status != :completed', {
        completed: TaskStatus.COMPLETED,
      })
      .orderBy('task.dueDate', 'ASC')
      .getMany();
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendDailyTelegramReminders(): Promise<void> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(2, 59, 59, 999);

    const tasks = await this.taskRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .leftJoinAndSelect('task.household', 'household')
      .leftJoinAndSelect('household.members', 'member')
      .where('task.dueDate <= :end', { end })
      .andWhere('task.status != :completed', {
        completed: TaskStatus.COMPLETED,
      })
      .getMany();

    const byUser = new Map<
      string,
      { chatId: string; username: string; tasks: Task[] }
    >();

    for (const task of tasks) {
      if (task.assignee) {
        if (task.assignee.telegramChatId) {
          if (!byUser.has(task.assignee.id)) {
            byUser.set(task.assignee.id, {
              chatId: task.assignee.telegramChatId,
              username: task.assignee.username,
              tasks: [],
            });
          }
          byUser.get(task.assignee.id)!.tasks.push(task);
        }
      } else {
        if (task.household && task.household.members) {
          for (const member of task.household.members) {
            if (member.telegramChatId) {
              if (!byUser.has(member.id)) {
                byUser.set(member.id, {
                  chatId: member.telegramChatId,
                  username: member.username,
                  tasks: [],
                });
              }
              byUser.get(member.id)!.tasks.push(task);
            }
          }
        }
      }
    }

    let sent = 0;
    for (const { chatId, username, tasks: userTasks } of byUser.values()) {
      const overdueTasks = userTasks.filter(t => t.dueDate && new Date(t.dueDate).getTime() < start.getTime());
      const dueTodayTasks = userTasks.filter(t => !t.dueDate || new Date(t.dueDate).getTime() >= start.getTime());
      
      let message = `👋 Good morning, ${username}!\n\nYou have ${userTasks.length} task${userTasks.length > 1 ? 's' : ''} needing attention:\n\n`;

      if (overdueTasks.length > 0) {
        message += `🚨 *OVERDUE TASKS*\n`;
        message += overdueTasks.map((t, i) => {
          const assignText = !t.assignee ? ' (Unassigned)' : '';
          return `${i + 1}. 🔴 *${t.title}*${t.household?.name ? ` (${t.household.name})` : ''}${assignText}`;
        }).join('\n') + '\n\n';
      }

      if (dueTodayTasks.length > 0) {
        message += `📅 *DUE TODAY*\n`;
        message += dueTodayTasks.map((t, i) => {
          const assignText = !t.assignee ? ' (Unassigned)' : '';
          return `${i + 1}. 🟢 *${t.title}*${t.household?.name ? ` (${t.household.name})` : ''}${assignText}`;
        }).join('\n') + '\n\n';
      }
      
      message += `Have a productive day! 🏠`;

      await this.telegramService.sendMessage(chatId, message);
      sent++;
    }

    this.logger.log(`Sent daily reminders to ${sent} users`);
  }
}
