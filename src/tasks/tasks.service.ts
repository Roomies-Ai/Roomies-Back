import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promptGemini } from '../helpers/gemini';
import { generateTasksPrompt, generateParseTelegramMessagePrompt } from '../helpers/prompts';
import { Task } from '../models/task.entity';
import { Household } from '../models/household.entity';
import { TaskStatus } from '../helpers/consts';

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
    const task = await this.taskRepository.findOne({ where: { id }, relations: ['household', 'assignee'] });
    if (!task) throw new NotFoundException(`Task #${id} not found`);
    return task;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    // Here we can trigger "Fairness" points in the future if status === COMPLETED
    await this.taskRepository.update(id, { status });
    return this.findOne(id);
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
    const household = await this.householdRepository.findOne({
      where: { id: householdId },
      relations: ['houseType'],
    });

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
  async bulkCreateTasks(householdId: string, tasks: Partial<Task>[]) {
    const household = await this.householdRepository.findOneBy({ id: householdId });
    if (!household) throw new NotFoundException('Household not found');

    const taskEntities = tasks.map(t => this.taskRepository.create({
      ...t,
      household,
    }));

    return this.taskRepository.save(taskEntities);
  }
}
