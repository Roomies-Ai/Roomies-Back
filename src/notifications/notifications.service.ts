import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Cron } from '@nestjs/schedule';
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
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    return this.taskRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.taskType', 'taskType')
      .leftJoinAndSelect('task.household', 'household')
      .where('task.assignee = :userId', { userId })
      .andWhere('task.dueDate >= :start', { start })
      .andWhere('task.dueDate <= :end', { end })
      .andWhere('task.status != :completed', { completed: TaskStatus.COMPLETED })
      .orderBy('task.dueDate', 'ASC')
      .getMany();
  }

  @Cron('0 8 * * *')
  async sendDailyTelegramReminders(): Promise<void> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const tasks = await this.taskRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .leftJoinAndSelect('task.household', 'household')
      .where('task.dueDate >= :start', { start })
      .andWhere('task.dueDate <= :end', { end })
      .andWhere('task.status != :completed', { completed: TaskStatus.COMPLETED })
      .andWhere('assignee.telegramChatId IS NOT NULL')
      .getMany();

    const byUser = new Map<string, { chatId: string; username: string; tasks: Task[] }>();
    for (const task of tasks) {
      const assignee = task.assignee;
      if (!assignee?.telegramChatId) continue;
      if (!byUser.has(assignee.id)) {
        byUser.set(assignee.id, { chatId: assignee.telegramChatId, username: assignee.username, tasks: [] });
      }
      byUser.get(assignee.id)!.tasks.push(task);
    }

    let sent = 0;
    for (const { chatId, username, tasks: userTasks } of byUser.values()) {
      const taskList = userTasks.map((t, i) => `${i + 1}. *${t.title}*${t.household?.name ? ` (${t.household.name})` : ''}`).join('\n');
      const message = `👋 Good morning, ${username}!\n\nYou have ${userTasks.length} task${userTasks.length > 1 ? 's' : ''} due today:\n\n${taskList}\n\nHave a productive day! 🏠`;
      await this.telegramService.sendMessage(chatId, message);
      sent++;
    }

    this.logger.log(`Sent daily reminders to ${sent} users`);
  }
}
