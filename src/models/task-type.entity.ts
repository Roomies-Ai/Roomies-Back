import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  ManyToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Household } from './household.entity';
import { Task } from './task.entity';
import { User } from './user.entity';

@Entity('task_types')
export class TaskType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @ManyToOne(() => Household, (household) => household.taskTypes, {
    onDelete: 'CASCADE',
  })
  household!: Household;

  @OneToMany(() => Task, (task) => task.taskType)
  tasks!: Task[];

  @ManyToMany(() => User, (user) => user.preferredTaskTypes)
  preferringUsers!: User[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
