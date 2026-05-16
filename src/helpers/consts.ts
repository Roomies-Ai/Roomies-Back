export enum TaskStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in-progress',
    COMPLETED = 'completed',
    OVERDUE = 'overdue',
}

export const DEFAULT_TASK_TYPES = [
    'General',
    'Cooking',
    'Cleaning',
    'Groceries',
    'Maintenance',
    'Trash/Recycling',
    'Laundry',
];
