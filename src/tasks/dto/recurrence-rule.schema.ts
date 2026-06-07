import { z } from 'zod';

export const RecurrenceRuleSchema = z.object({
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  interval: z.number().int().min(1).default(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
  endDate: z.string().optional(),
});

export type RecurrenceRuleDto = z.infer<typeof RecurrenceRuleSchema>;
