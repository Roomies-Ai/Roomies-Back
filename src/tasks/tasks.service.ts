import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promptGemini } from 'src/helpers/gemini';
import { generateTasksPrompt } from 'src/helpers/prompts';
import { Task } from 'src/models/task.entity';


@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
  ) {}

  async generateTasks() {
    try {
      const prompt = generateTasksPrompt;
      const result = await promptGemini(prompt);
      const tasks = result.response.text();
      // To save tasks, you would parse the Gemini response and use:
      // const taskEntities = this.taskRepository.create(parsedTasks);
      // await this.taskRepository.save(taskEntities);
      return tasks;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
}

