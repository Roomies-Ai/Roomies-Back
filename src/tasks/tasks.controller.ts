import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Request,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { FairnessService } from './fairness.service';
import { TaskStatus } from '../helpers/consts';
import { ZodValidationPipe } from './dto/zod-validation.pipe';
import { CreateTaskSchema, CreateTaskDto } from './dto/create-task.schema';
import { UpdateTaskSchema, UpdateTaskDto } from './dto/update-task.schema';

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly fairnessService: FairnessService,
  ) {}

  @Get('me')
  findMyTasks(@Request() req: any) {
    const userId = req.user?.id || req.user?.userId;
    return this.tasksService.findMyTasks(userId);
  }

  @Post()
  create(@Body(new ZodValidationPipe(CreateTaskSchema)) dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  @Get()
  findAll(
    @Query('householdId') householdId: string,
    @Query('status') status?: TaskStatus,
  ) {
    return this.tasksService.findAll(status, householdId);
  }

  @Get(':id/recurrence')
  getRecurrenceInstances(@Param('id') id: string) {
    return this.tasksService.findRecurrenceInstances(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tasksService.remove(id);
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
  async parseTelegram(
    @Body('householdId') householdId: string,
    @Body('message') message: string,
  ) {
    return this.tasksService.processTelegramMessage(householdId, message);
  }

  @Post('telegram/approve')
  async approveTelegram(
    @Body('householdId') householdId: string,
    @Body('tasks') tasks: any[],
  ) {
    return this.tasksService.bulkCreateTasks(householdId, tasks);
  }

  @Get(':id/fairness-suggestions')
  getFairnessSuggestions(@Param('id') id: string) {
    return this.fairnessService.getFairnessSuggestions(id);
  }
}
