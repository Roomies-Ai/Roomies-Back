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

export function aggregateTaskStats(tasks: Task[]): AggregatedStats {
  const stats: AggregatedStats = {
    totalPoints: 0,
    totalTasks: 0,
    statusCounts: {},
    byTaskType: {},
    byMember: {},
  };

  const now = new Date();

  tasks.forEach((task) => {
    const points = task.points ?? 1;
    let status = task.status as string;
    const taskTypeName = task.taskType?.name || 'General';
    const assigneeId = task.assignee?.id || 'Unassigned';

    // Dynamic Overdue Logic
    if (status !== TaskStatus.COMPLETED && task.dueDate && new Date(task.dueDate) < now) {
      status = 'overdue';
    }

    // Update global stats
    stats.totalTasks++;
    stats.statusCounts[status] = (stats.statusCounts[status] || 0) + 1;
    if (status === TaskStatus.COMPLETED) {
      stats.totalPoints += points;
    }

    // Update byTaskType stats
    if (!stats.byTaskType[taskTypeName]) {
      stats.byTaskType[taskTypeName] = { points: 0, totalTasks: 0, statusCounts: {} };
    }
    const typeStat = stats.byTaskType[taskTypeName];
    typeStat.totalTasks++;
    typeStat.statusCounts[status] = (typeStat.statusCounts[status] || 0) + 1;
    if (status === TaskStatus.COMPLETED) {
      typeStat.points += points;
    }

    // Update byMember stats
    if (!stats.byMember[assigneeId]) {
      stats.byMember[assigneeId] = { points: 0, totalTasks: 0, statusCounts: {} };
    }
    const memberStat = stats.byMember[assigneeId];
    memberStat.totalTasks++;
    memberStat.statusCounts[status] = (memberStat.statusCounts[status] || 0) + 1;
    if (status === TaskStatus.COMPLETED) {
      memberStat.points += points;
    }
  });

  return stats;
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
