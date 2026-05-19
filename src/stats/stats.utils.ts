import { Task } from '../models/task.entity';
import { TaskStatus } from '../helpers/consts';

export interface StatusCounts {
  [status: string]: number;
}

export interface StatGroup {
  points: number;
  totalTasks: number;
  statusCounts: StatusCounts;
}

export interface AggregatedStats {
  totalPoints: number;
  totalTasks: number;
  statusCounts: StatusCounts;
  byTaskType: { [typeName: string]: StatGroup };
  byMember: { [memberId: string]: StatGroup };
}

export function mapEffectiveStatus(tasks: Task[]): any[] {
  const now = new Date();
  return tasks.map(t => {
    let status = t.status as string;
    if (status !== TaskStatus.COMPLETED && t.dueDate && new Date(t.dueDate) < now) {
      status = 'overdue';
    }
    return { ...t, status };
  });
}
