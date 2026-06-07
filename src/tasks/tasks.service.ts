import { Injectable, NotFoundException, Optional, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository, Brackets, IsNull, Not, LessThan, MoreThanOrEqual } from 'typeorm';
import { promptGemini } from '../helpers/gemini';
import {
  generateTasksPrompt,
  generateParseTelegramMessagePrompt,
} from '../helpers/prompts';
import { Task } from '../models/task.entity';
import { Household } from '../models/household.entity';
import { TaskStatus } from '../helpers/consts';
import { User } from '../models/user.entity';
import { TaskType } from '../models/task-type.entity';
import { StatsService } from '../stats/stats.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { getNextOccurrenceDate, buildInstanceFromTemplate } from '../helpers/recurrence.helper';
import { CreateTaskDto } from './dto/create-task.schema';
import { UpdateTaskDto } from './dto/update-task.schema';

const RECURRENCE_LOOKAHEAD_DAYS = 7;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    @InjectRepository(Household)
    private householdRepository: Repository<Household>,
    private statsService: StatsService,
    @Optional() private googleCalendarService: GoogleCalendarService,
  ) {}

  async create(createData: CreateTaskDto | Partial<Task>): Promise<Task> {
    const task = this.taskRepository.create(createData as Partial<Task>);
    const saved = await this.taskRepository.save(task);
    if (saved.household?.id) {
      this.statsService.clearCache(saved.household.id);
    } else if ((createData as any).household?.id) {
      this.statsService.clearCache((createData as any).household.id);
    }
    if (saved.assignee?.id && saved.dueDate) {
      this.googleCalendarService?.createCalendarEvent(saved).catch(() => {});
    }
    if (saved.recurrenceRule) {
      await this.scheduleUpcomingInstances(saved).catch((e) =>
        this.logger.error('Failed to pre-generate recurring instances', e),
      );
    }
    return saved;
  }

  async findAll(status?: TaskStatus, householdId?: string): Promise<Task[]> {
    const whereCondition: any = {};
    if (status) whereCondition.status = status;
    if (householdId) whereCondition.household = { id: householdId };

    return this.taskRepository.find({
      where: whereCondition,
      relations: ['household', 'assignee', 'taskType'],
    });
  }

  async findMyTasks(userId: string): Promise<Task[]> {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    return this.taskRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.household', 'household')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .leftJoinAndSelect('task.taskType', 'taskType')
      .where('task.assignee.id = :userId', { userId })
      .andWhere(
        new Brackets((qb) => {
          qb.where('task.status != :completed', {
            completed: TaskStatus.COMPLETED,
          }).orWhere('task.updatedAt > :twoWeeksAgo', { twoWeeksAgo });
        }),
      )
      .orderBy('task.dueDate', 'ASC')
      .getMany();
  }

  async findOne(id: string): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id },
      relations: ['household', 'assignee', 'taskType'],
    });
    if (!task) throw new NotFoundException(`Task #${id} not found`);
    return task;
  }

  async findRecurrenceInstances(templateId: string): Promise<Task[]> {
    return this.taskRepository.find({
      where: { recurrenceParentId: templateId },
      relations: ['assignee', 'taskType'],
      order: { dueDate: 'ASC' },
    });
  }

  async update(id: string, updateData: UpdateTaskDto | any): Promise<Task> {
    const task = await this.findOne(id);

    const { clearRecurrence, recurrenceRule: newRule, ...rest } = updateData as UpdateTaskDto & any;

    // Resolve relations if IDs are passed as strings
    if (rest.assignee && typeof rest.assignee === 'string') {
      const household = await this.householdRepository.findOne({
        where: { id: task.household.id },
        relations: ['members'],
      });
      rest.assignee =
        household?.members?.find(
          (m) =>
            m.id === rest.assignee || m.username === rest.assignee,
        ) || null;
    }

    if (rest.taskType && typeof rest.taskType === 'string') {
      const household = await this.householdRepository.findOne({
        where: { id: task.household.id },
        relations: ['taskTypes'],
      });
      rest.taskType =
        household?.taskTypes?.find(
          (tt) =>
            tt.id === rest.taskType || tt.name === rest.taskType,
        ) || null;
    } else if (rest.taskType === null) {
      rest.taskType = null;
    }

    // Auto-set status based on due date if assignee is being set and status is pending
    if (rest.assignee && task.status === TaskStatus.PENDING) {
      const now = new Date();
      if (task.dueDate && task.dueDate < now) {
        task.status = TaskStatus.OVERDUE;
      } else {
        task.status = TaskStatus.IN_PROGRESS;
      }
    }

    if (clearRecurrence) {
      rest.recurrenceRule = null;
    } else if (newRule !== undefined) {
      const ruleChanged = JSON.stringify(task.recurrenceRule) !== JSON.stringify(newRule);
      if (ruleChanged && task.recurrenceRule) {
        // Drop future pending instances and regenerate
        await this.taskRepository.delete({
          recurrenceParentId: task.id,
          status: TaskStatus.PENDING,
          dueDate: MoreThanOrEqual(new Date()),
        });
      }
      rest.recurrenceRule = newRule;
    }

    Object.assign(task, rest);
    const saved = await this.taskRepository.save(task);
    if (saved.household?.id) {
      this.statsService.clearCache(saved.household.id);
    }
    const assigneeChanged = 'assignee' in rest;
    const dueDateChanged = 'dueDate' in rest;
    const contentChanged = 'title' in rest || 'description' in rest;
    if (saved.assignee?.id && saved.dueDate && (assigneeChanged || dueDateChanged || contentChanged)) {
      this.googleCalendarService?.updateCalendarEvent(saved).catch(() => {});
    }

    if (saved.recurrenceRule && (newRule !== undefined || assigneeChanged)) {
      await this.scheduleUpcomingInstances(saved).catch((e) =>
        this.logger.error('Failed to regenerate recurring instances after update', e),
      );
    }

    return saved;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    const task = await this.findOne(id);
    task.status = status;
    const saved = await this.taskRepository.save(task);

    if (status === TaskStatus.COMPLETED && task.recurrenceParentId) {
      await this.generateNextInstanceAfterCompletion(task).catch((e) =>
        this.logger.error('Failed to generate next recurring instance on completion', e),
      );
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const task = await this.findOne(id);
    const householdId = task.household?.id;
    if (task.googleCalendarEventId && task.assignee?.id) {
      await this.googleCalendarService?.deleteCalendarEvent(task).catch(() => {});
    }
    await this.taskRepository.remove(task);
    if (householdId) {
      this.statsService.clearCache(householdId);
    }
  }

  async nudgeAssignee(id: string): Promise<any> {
    const task = await this.findOne(id);
    if (!task.assignee) {
      throw new NotFoundException(`No assignee found for Task #${id}`);
    }
    console.log(
      `[TELEGRAM API MOCK] Sending nudge to user ${task.assignee.username} for task "${task.title}"`,
    );
    return {
      message: 'Nudge sent via Telegram successfully',
      taskId: id,
      user: task.assignee.username,
    };
  }

  async generateTasks(household: any) {
    try {
      const prompt = generateTasksPrompt(household);
      const result = await promptGemini(prompt);
      const text = result.response.text();

      const cleanJson = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error('Failed to generate AI tasks:', error);
      return [];
    }
  }

  async processTelegramMessage(householdId: string, message: string) {
    const household = await this.findHouseholdById(householdId, ['taskTypes']);

    if (!household) throw new NotFoundException('Household not found');

    const prompt = generateParseTelegramMessagePrompt(message, household);
    const result = await promptGemini(prompt);

    try {
      return JSON.parse(result.response.text());
    } catch (e) {
      console.error('Failed to parse AI response:', result.response.text());
      return [];
    }
  }

  async bulkCreateTasks(householdId: string, tasks: any[]) {
    const household = await this.findHouseholdById(householdId, [
      'members',
      'taskTypes',
    ]);
    if (!household) throw new NotFoundException('Household not found');

    const taskEntities = tasks.map((t) => {
      let assignee: User | null = null;
      if (t.assignee && typeof t.assignee === 'string') {
        assignee =
          household.members?.find((m) => m.username === t.assignee) || null;
      } else if (t.assignee && typeof t.assignee === 'object') {
        assignee = t.assignee;
      }

      let taskType: TaskType | null = null;
      if (t.taskType) {
        if (typeof t.taskType === 'string') {
          taskType =
            household.taskTypes?.find(
              (tt) => tt.name === t.taskType || tt.id === t.taskType,
            ) || null;
        } else if (typeof t.taskType === 'object' && t.taskType.id) {
          taskType =
            household.taskTypes?.find((tt) => tt.id === t.taskType.id) || null;
        }
      }

      const task = new Task();
      Object.assign(task, t);
      task.household = household;
      task.assignee = assignee as User;
      task.taskType = taskType as TaskType;
      task.status = t.status || TaskStatus.PENDING;
      return task;
    });

    const saved = await this.taskRepository.save(taskEntities);
    this.statsService.clearCache(householdId);
    for (const task of saved) {
      if (task.assignee?.id && task.dueDate) {
        this.googleCalendarService?.createCalendarEvent(task).catch(() => {});
      }
    }
    return saved;
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleOverdueTasks() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const overdueTasks = await this.taskRepository.createQueryBuilder('task')
      .leftJoinAndSelect('task.household', 'household')
      .where('task.status IN (:...statuses)', { statuses: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] })
      .andWhere('task.dueDate < :now', { now })
      .getMany();

    if (overdueTasks.length > 0) {
      const taskIds = overdueTasks.map(t => t.id);
      await this.taskRepository.update(taskIds, { status: TaskStatus.OVERDUE });

      const householdIds = new Set(overdueTasks.map(t => t.household?.id).filter(id => id));
      householdIds.forEach(id => this.statsService.clearCache(id as string));

      this.logger.log(`Updated ${overdueTasks.length} tasks to OVERDUE status.`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateRecurringInstances() {
    const templates = await this.taskRepository.find({
      where: { recurrenceParentId: IsNull(), recurrenceRule: Not(IsNull()) },
      relations: ['assignee', 'taskType', 'household'],
    });

    for (const template of templates) {
      await this.scheduleUpcomingInstances(template).catch((e) =>
        this.logger.error(`Failed to generate instances for template ${template.id}`, e),
      );
    }

    this.logger.log(`Processed ${templates.length} recurring task templates.`);
  }

  async findHouseholdByInviteCode(
    inviteCode: string,
    relations: string[] = [],
  ): Promise<Household | null> {
    return this.householdRepository.findOne({
      where: { inviteCode },
      relations,
    });
  }

  async findHouseholdById(
    id: string,
    relations: string[] = [],
  ): Promise<Household | null> {
    const isUuid =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        id,
      );
    if (!isUuid) return null;

    return this.householdRepository.findOne({
      where: { id },
      relations,
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async scheduleUpcomingInstances(template: Task): Promise<void> {
    if (!template.recurrenceRule) return;

    const horizon = new Date();
    horizon.setDate(horizon.getDate() + RECURRENCE_LOOKAHEAD_DAYS);

    // Find the latest existing instance so we don't create duplicates
    const latest = await this.taskRepository.findOne({
      where: { recurrenceParentId: template.id },
      order: { dueDate: 'DESC' },
    });

    let from = latest?.dueDate ?? (template.dueDate ?? new Date());

    while (true) {
      const next = getNextOccurrenceDate(template.recurrenceRule, new Date(from));
      if (!next || next > horizon) break;

      const exists = await this.taskRepository.findOne({
        where: { recurrenceParentId: template.id, dueDate: next },
      });
      if (!exists) {
        const instance = this.taskRepository.create(
          buildInstanceFromTemplate(template, next) as Partial<Task>,
        );
        const saved = await this.taskRepository.save(instance);
        if (saved.assignee?.id && saved.dueDate) {
          this.googleCalendarService?.createCalendarEvent(saved).catch(() => {});
        }
      }
      from = next;
    }
  }

  private async generateNextInstanceAfterCompletion(completedInstance: Task): Promise<void> {
    const template = await this.taskRepository.findOne({
      where: { id: completedInstance.recurrenceParentId! },
      relations: ['assignee', 'taskType', 'household'],
    });
    if (!template?.recurrenceRule) return;

    const from = completedInstance.dueDate ?? new Date();
    const next = getNextOccurrenceDate(template.recurrenceRule, new Date(from));
    if (!next) return;

    const exists = await this.taskRepository.findOne({
      where: { recurrenceParentId: template.id, dueDate: next },
    });
    if (exists) return;

    const instance = this.taskRepository.create(
      buildInstanceFromTemplate(template, next) as Partial<Task>,
    );
    const saved = await this.taskRepository.save(instance);
    if (saved.assignee?.id && saved.dueDate) {
      this.googleCalendarService?.createCalendarEvent(saved).catch(() => {});
    }
  }
}
