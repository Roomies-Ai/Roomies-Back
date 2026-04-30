import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { TaskStatus } from '../helpers/consts';
import { User } from './user.entity';
import { Household } from './household.entity';
import { TaskType } from './task-type.entity';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column('text')
  description: string;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.PENDING,
  })
  status: TaskStatus;

  @ManyToOne(() => TaskType, taskType => taskType.tasks, { nullable: true, onDelete: 'SET NULL' })
  taskType: TaskType;

  @Column({ type: 'timestamp', nullable: true })
  dueDate: Date;

  @Column({ type: 'int', default: 1 })
  points: number;

  @ManyToOne(() => Household, household => household.tasks, { onDelete: 'CASCADE' })
  household: Household;

  @ManyToOne(() => User, user => user.assignedTasks, { nullable: true, onDelete: 'SET NULL' })
  assignee: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
