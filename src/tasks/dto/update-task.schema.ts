import { z } from 'zod';
import { CreateTaskSchema } from './create-task.schema';
import { createZodDto } from './create-zod-dto';

export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  clearRecurrence: z.boolean().optional(),
});

export class UpdateTaskDto extends createZodDto(UpdateTaskSchema) {}
