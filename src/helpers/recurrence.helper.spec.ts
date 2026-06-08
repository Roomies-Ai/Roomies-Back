import { describe, it, expect } from '@jest/globals';
import {
  getNextOccurrenceDate,
  buildInstanceFromTemplate,
  RecurrenceRule,
} from './recurrence.helper';

const date = (iso: string) => new Date(iso);

describe('getNextOccurrenceDate', () => {
  describe('DAILY', () => {
    it('returns the next day by default', () => {
      const rule: RecurrenceRule = { frequency: 'DAILY', interval: 1 };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T10:00:00Z'));
      expect(next).not.toBeNull();
      expect(next!.getDate()).toBe(2);
      expect(next!.getMonth()).toBe(0); // January
    });

    it('respects interval > 1', () => {
      const rule: RecurrenceRule = { frequency: 'DAILY', interval: 3 };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T00:00:00'));
      expect(next!.getDate()).toBe(4);
    });

    it('applies timeOfDay to the result', () => {
      const rule: RecurrenceRule = {
        frequency: 'DAILY',
        interval: 1,
        timeOfDay: '08:30',
      };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T00:00:00'));
      expect(next!.getHours()).toBe(8);
      expect(next!.getMinutes()).toBe(30);
    });

    it('returns null when endDate has passed', () => {
      const rule: RecurrenceRule = {
        frequency: 'DAILY',
        interval: 1,
        endDate: '2026-01-01',
      };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T12:00:00'));
      expect(next).toBeNull();
    });

    it('returns null when next occurrence exceeds endDate', () => {
      const rule: RecurrenceRule = {
        frequency: 'DAILY',
        interval: 5,
        endDate: '2026-01-04',
      };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T00:00:00'));
      expect(next).toBeNull();
    });
  });

  describe('WEEKLY', () => {
    it('finds the next Sunday when daysOfWeek=[0]', () => {
      // 2026-01-01 is a Monday (day 1), so next Sunday is 2026-01-07
      const rule: RecurrenceRule = {
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [0],
      };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T00:00:00'));
      expect(next).not.toBeNull();
      expect(next!.getDay()).toBe(0); // Sunday
    });

    it('finds the closest matching day when multiple daysOfWeek provided', () => {
      // 2026-01-01 is Thursday. Next occurrence of Wed(3) or Fri(5) → Fri 2026-01-02
      const rule: RecurrenceRule = {
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [3, 5],
      };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T00:00:00'));
      expect(next!.getDay()).toBe(5); // Friday
    });

    it('wraps across week boundary', () => {
      // 2026-01-03 is Saturday (day 6). Next Mon (day 1) → 2026-01-05
      const rule: RecurrenceRule = {
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [1],
      };
      const next = getNextOccurrenceDate(rule, date('2026-01-03T00:00:00'));
      expect(next!.getDay()).toBe(1);
      expect(next!.getDate()).toBe(5);
    });

    it('returns null when next occurrence is past endDate', () => {
      const rule: RecurrenceRule = {
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [3], // Wednesday
        endDate: '2026-01-05', // Wednesday 2026-01-07 is after this
      };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T00:00:00'));
      expect(next).toBeNull();
    });
  });

  describe('MONTHLY', () => {
    it('returns the same day next month', () => {
      const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 1 };
      const next = getNextOccurrenceDate(rule, date('2026-01-15T00:00:00'));
      expect(next!.getMonth()).toBe(1); // February
      expect(next!.getDate()).toBe(15);
    });

    it('respects interval > 1', () => {
      const rule: RecurrenceRule = { frequency: 'MONTHLY', interval: 3 };
      const next = getNextOccurrenceDate(rule, date('2026-01-01T00:00:00'));
      expect(next!.getMonth()).toBe(3); // April
    });

    it('returns null when past endDate', () => {
      const rule: RecurrenceRule = {
        frequency: 'MONTHLY',
        interval: 1,
        endDate: '2026-01-31',
      };
      const next = getNextOccurrenceDate(rule, date('2026-01-15T00:00:00'));
      expect(next).toBeNull();
    });
  });
});

describe('buildInstanceFromTemplate', () => {
  const template = {
    id: 'parent-id',
    title: 'Vacuum',
    description: 'Weekly vacuum',
    points: 3,
    assignee: { id: 'user-1' },
    taskType: { id: 'type-1' },
    household: { id: 'hh-1' },
    recurrenceRule: {
      frequency: 'WEEKLY' as const,
      interval: 1,
      daysOfWeek: [0],
    },
    googleCalendarEventId: 'old-event',
  };

  it('copies core fields from the template', () => {
    const nextDue = new Date('2026-01-07T08:00:00');
    const instance = buildInstanceFromTemplate(template, nextDue);
    expect(instance.title).toBe('Vacuum');
    expect(instance.description).toBe('Weekly vacuum');
    expect(instance.points).toBe(3);
    expect(instance.assignee).toBe(template.assignee);
    expect(instance.taskType).toBe(template.taskType);
    expect(instance.household).toBe(template.household);
  });

  it('sets recurrenceParentId to the template id', () => {
    const instance = buildInstanceFromTemplate(template, new Date());
    expect(instance.recurrenceParentId).toBe('parent-id');
  });

  it('nulls out googleCalendarEventId', () => {
    const instance = buildInstanceFromTemplate(template, new Date());
    expect(instance.googleCalendarEventId).toBeNull();
  });

  it('sets the dueDate to nextDue', () => {
    const nextDue = new Date('2026-01-07T08:00:00');
    const instance = buildInstanceFromTemplate(template, nextDue);
    expect(instance.dueDate).toBe(nextDue);
  });

  it('carries the recurrenceRule from template', () => {
    const instance = buildInstanceFromTemplate(template, new Date());
    expect(instance.recurrenceRule).toEqual(template.recurrenceRule);
  });
});
