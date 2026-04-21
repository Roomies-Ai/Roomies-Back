import { Injectable } from '@nestjs/common'
import { promptGemini } from 'src/helpers/gemini';
import { generateTasksPrompt } from 'src/helpers/prompts';
import taskModel from 'src/models/tasksModel';

@Injectable()
export class TasksService {
    async generateTasks() {
        try {
            const prompt = generateTasksPrompt;
            const result = await promptGemini(prompt);
            const tasks = result.response.text();
            // await taskModel.insertMany(tasks);
            return tasks;
        } catch (error) {
            console.log(error);
            throw error;
        }
    }
}
