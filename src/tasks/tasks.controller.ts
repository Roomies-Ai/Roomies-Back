import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { FairnessService } from './fairness.service';
import { Task } from '../models/task.entity';
import { TaskStatus } from '../helpers/consts';

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly fairnessService: FairnessService,
  ) {}

  @Post()
  create(@Body() createData: Partial<Task>) {
    return this.tasksService.create(createData);
  }

  @Get()
  findAll(
    @Query('householdId') householdId: string,
    @Query('status') status?: TaskStatus,
  ) {
    return this.tasksService.findAll(status, householdId);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: TaskStatus) {
    return this.tasksService.updateStatus(id, status);
  }

  @Post(':id/nudge')
  nudgeAssignee(@Param('id') id: string) {
    return this.tasksService.nudgeAssignee(id);
  }

  @Post('ai-parse')
  async generateTasks(@Body('household') household: any) {
    return await this.tasksService.generateTasks(household);
  }

  @Post('telegram/parse')
  async parseTelegram(@Body('householdId') householdId: string, @Body('message') message: string) {
    return this.tasksService.processTelegramMessage(householdId, message);
  }

  @Post('telegram/approve')
  async approveTelegram(@Body('householdId') householdId: string, @Body('tasks') tasks: any[]) {
    return this.tasksService.bulkCreateTasks(householdId, tasks);
  }

  @Get(':id/fairness-suggestions')
  getFairnessSuggestions(@Param('id') id: string) {
    return this.fairnessService.getFairnessSuggestions(id);
  }
}
