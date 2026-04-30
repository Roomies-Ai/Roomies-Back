import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { Household } from '../models/household.entity';
import { TaskStatus } from '../helpers/consts';
import { promptGemini } from '../helpers/gemini';
import { generateFairnessPrompt } from '../helpers/prompts';

@Injectable()
export class FairnessService {
  constructor(
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Household)
    private householdRepository: Repository<Household>,
  ) {}

  /**
   * Suggests the fairest assignees for a given task.
   * Higher score means a better, fairer match.
   */
  async getFairnessSuggestions(taskId: string): Promise<any[]> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['household', 'household.members', 'household.members.preferredTaskTypes', 'taskType']
    });

    if (!task) {
      throw new NotFoundException(`Task #${taskId} not found`);
    }

    const members = task.household.members;
    if (!members || members.length === 0) {
      return [];
    }

    const taskTypeId = task.taskType?.id;
    const memberStats: any[] = [];

    for (const member of members) {
      const completedTasks = await this.taskRepository.find({
        where: { assignee: { id: member.id }, status: TaskStatus.COMPLETED },
        relations: ['taskType']
      });

      const totalPoints = completedTasks.reduce((sum, t) => sum + (t.points || 0), 0);
      const timesDoneThisType = taskTypeId 
        ? completedTasks.filter(t => t.taskType?.id === taskTypeId).length
        : 0;
      const prefersThisType = taskTypeId && member.preferredTaskTypes
        ? member.preferredTaskTypes.some(pt => pt.id === taskTypeId)
        : false;

      memberStats.push({ member, totalPoints, timesDoneThisType, prefersThisType });
    }

    const prompt = generateFairnessPrompt(task, memberStats);

    const result = await promptGemini(prompt);
    return JSON.parse(result.response.text());
  }
}
