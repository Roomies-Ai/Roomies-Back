export enum RecurrenceFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
  daysOfWeek?: number[]; // 0=Sun … 6=Sat, used with WEEKLY
  timeOfDay?: string; // "HH:MM" (24h), applied to generated due dates
  endDate?: string; // ISO date string — no instances generated after this
};

/**
 * Returns the next occurrence date after `from`, or null if the rule has expired.
 */
export function getNextOccurrenceDate(
  rule: RecurrenceRule,
  from: Date,
): Date | null {
  const interval = rule.interval ?? 1;
  let next: Date;

  if (rule.endDate) {
    const end = new Date(rule.endDate);
    end.setHours(23, 59, 59, 999);
    if (from >= end) return null;
  }

  switch (rule.frequency) {
    case RecurrenceFrequency.DAILY: {
      next = new Date(from);
      next.setDate(next.getDate() + interval);
      break;
    }

    case RecurrenceFrequency.WEEKLY: {
      const days = rule.daysOfWeek?.length
        ? [...rule.daysOfWeek].sort((a, b) => a - b)
        : [from.getDay()];
      next = new Date(from);
      next.setDate(next.getDate() + 1); // start searching from the day after `from`

      let found = false;
      for (let i = 0; i < 7 * interval; i++) {
        if (days.includes(next.getDay())) {
          // For interval > 1, only accept hits on the Nth week cycle
          if (
            interval === 1 ||
            _weeksFromEpoch(next, days[0]) % interval === 0
          ) {
            found = true;
            break;
          }
        }
        next.setDate(next.getDate() + 1);
      }
      if (!found) return null;
      break;
    }

    case RecurrenceFrequency.MONTHLY: {
      next = new Date(from);
      next.setMonth(next.getMonth() + interval);
      break;
    }

    default:
      return null;
  }

  applyTimeOfDay(next, rule.timeOfDay);

  if (rule.endDate) {
    const end = new Date(rule.endDate);
    end.setHours(23, 59, 59, 999);
    if (next > end) return null;
  }

  return next;
}

export interface TaskInstanceData {
  title: string;
  description: string;
  points: number;
  dueDate: Date;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string;
  googleCalendarEventId: null;
  assignee: unknown;
  taskType: unknown;
  household: unknown;
}

export interface RecurrenceTemplate {
  id: string;
  title: string;
  description: string;
  points: number;
  assignee: unknown;
  taskType: unknown;
  household: unknown;
  recurrenceRule: RecurrenceRule | null;
}

/**
 * Builds a new task instance from a recurring template.
 * The caller is responsible for persisting the result.
 */
export function buildInstanceFromTemplate(
  parent: RecurrenceTemplate,
  nextDue: Date,
): TaskInstanceData {
  return {
    title: parent.title,
    description: parent.description,
    points: parent.points,
    assignee: parent.assignee,
    taskType: parent.taskType,
    household: parent.household,
    recurrenceRule: parent.recurrenceRule,
    recurrenceParentId: parent.id,
    dueDate: nextDue,
    googleCalendarEventId: null,
  };
}

function applyTimeOfDay(date: Date, timeOfDay?: string): void {
  if (!timeOfDay) return;
  const [hStr, mStr] = timeOfDay.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return;
  date.setHours(h, m, 0, 0);
}

function _weeksFromEpoch(date: Date, anchorDay: number): number {
  const epochStart = new Date(0);
  const daysFromEpoch = Math.floor(
    (date.getTime() - epochStart.getTime()) / 86_400_000,
  );
  const adjustedDay = (date.getDay() - anchorDay + 7) % 7;
  return Math.floor((daysFromEpoch - adjustedDay) / 7);
}
