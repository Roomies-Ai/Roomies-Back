import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promptGemini } from '../helpers/gemini';
import { generateTasksPrompt, generateParseTelegramMessagePrompt } from '../helpers/prompts';
import { Task } from '../models/task.entity';
import { Household } from '../models/household.entity';
import { TaskStatus } from '../helpers/consts';
import { User } from 'src/models/user.entity';
import { TaskType } from 'src/models/task-type.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    @InjectRepository(Household)
    private householdRepository: Repository<Household>,
  ) {}

  async create(createData: Partial<Task>): Promise<Task> {
    const task = this.taskRepository.create(createData);
    return this.taskRepository.save(task);
  }

  async findAll(status?: TaskStatus, householdId?: string): Promise<Task[]> {
    const whereCondition: any = {};
    if (status) whereCondition.status = status;
    if (householdId) whereCondition.household = { id: householdId };

    return this.taskRepository.find({ where: whereCondition, relations: ['household', 'assignee'] });
  }

  async findOne(id: string): Promise<Task> {
    const task = await this.taskRepository.findOne({ 
      where: { id }, 
      relations: ['household', 'assignee', 'taskType'] 
    });
    if (!task) throw new NotFoundException(`Task #${id} not found`);
    return task;
  }

  async update(id: string, updateData: any): Promise<Task> {
    const task = await this.findOne(id);
    
    // Resolve relations if IDs are passed as strings
    if (updateData.assignee && typeof updateData.assignee === 'string') {
      const household = await this.householdRepository.findOne({ 
        where: { id: task.household.id }, 
        relations: ['members'] 
      });
      updateData.assignee = household?.members?.find(m => m.id === updateData.assignee || m.username === updateData.assignee) || null;
    }

    if (updateData.taskType && typeof updateData.taskType === 'string') {
      const household = await this.householdRepository.findOne({ 
        where: { id: task.household.id }, 
        relations: ['taskTypes'] 
      });
      updateData.taskType = household?.taskTypes?.find(tt => tt.id === updateData.taskType || tt.name === updateData.taskType) || null;
    } else if (updateData.taskType === null) {
      updateData.taskType = null;
    }

    Object.assign(task, updateData);
    return this.taskRepository.save(task);
  }

  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.update(id, { status });
  }

  async remove(id: string): Promise<void> {
    const task = await this.findOne(id);
    await this.taskRepository.remove(task);
  }

  async nudgeAssignee(id: string): Promise<any> {
    const task = await this.findOne(id);
    if (!task.assignee) {
      throw new NotFoundException(`No assignee found for Task #${id}`);
    }
    // Stub for Telegram API call
    console.log(`[TELEGRAM API MOCK] Sending nudge to user ${task.assignee.username} for task "${task.title}"`);
    return { message: 'Nudge sent via Telegram successfully', taskId: id, user: task.assignee.username };
  }

  async generateTasks(household: any) {
    try {
      const prompt = generateTasksPrompt(household);
      const result = await promptGemini(prompt);
      const text = result.response.text();
      
      // Clean up potential markdown blocks if Gemini returns them
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error('Failed to generate AI tasks:', error);
      return [];
    }
  }

  /**
   * Process a free-text message from Telegram to extract suggested tasks.
   */
  async processTelegramMessage(householdId: string, message: string) {
    const household = await this.findHouseholdById(householdId, ['houseType', 'taskTypes']);

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

  /**
   * Saves a list of tasks for a household.
   */
  async bulkCreateTasks(householdId: string, tasks: any[]) {
    const household = await this.findHouseholdById(householdId, ['members', 'taskTypes']);
    if (!household) throw new NotFoundException('Household not found');

    const taskEntities = tasks.map(t => {
      // Resolve assignee if provided as username
      let assignee: User | null = null;
      if (t.assignee && typeof t.assignee === 'string') {
        assignee = household.members?.find(m => m.username === t.assignee) || null;
      } else if (t.assignee && typeof t.assignee === 'object') {
        assignee = t.assignee;
      }

      // Resolve taskType if provided as name or ID
      let taskType: TaskType | null = null;
      if (t.taskType) {
        if (typeof t.taskType === 'string') {
          taskType = household.taskTypes?.find(tt => tt.name === t.taskType || tt.id === t.taskType) || null;
        } else if (typeof t.taskType === 'object' && t.taskType.id) {
          taskType = household.taskTypes?.find(tt => tt.id === t.taskType.id) || null;
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

    return this.taskRepository.save(taskEntities);
  }

  /**
   * Finds a household by its human-friendly Invite Code.
   */
  async findHouseholdByInviteCode(inviteCode: string, relations: string[] = []): Promise<Household | null> {
    return this.householdRepository.findOne({
      where: { inviteCode },
      relations,
    });
  }

  /**
   * Finds a household by its UUID.
   */
  async findHouseholdById(id: string, relations: string[] = []): Promise<Household | null> {
    // Only search by UUID if it's a valid UUID format to avoid DB errors
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
    if (!isUuid) return null;

    return this.householdRepository.findOne({
      where: { id },
      relations,
    });
  }
}
