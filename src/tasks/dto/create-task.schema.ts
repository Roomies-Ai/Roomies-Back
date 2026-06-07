import { z } from 'zod';
import { RecurrenceRuleSchema } from './recurrence-rule.schema';
import { createZodDto } from './create-zod-dto';

export const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  points: z.number().int().min(1).optional(),
  assignee: z.unknown().optional(),
  taskType: z.unknown().optional(),
  household: z.unknown().optional(),
  status: z.string().optional(),
  recurrenceRule: RecurrenceRuleSchema.optional(),
});

export class CreateTaskDto extends createZodDto(CreateTaskSchema) {}
