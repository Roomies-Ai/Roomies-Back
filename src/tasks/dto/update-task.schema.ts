import { z } from 'zod';
import { CreateTaskSchema } from './create-task.schema';

export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  clearRecurrence: z.boolean().optional(),
});

export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;
