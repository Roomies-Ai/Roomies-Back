import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, ManyToMany, JoinTable } from 'typeorm';
import { Household } from './household.entity';
import { Task } from './task.entity';
import { TaskType } from './task-type.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  username: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  profilePicture: string;
  
  @Column({ nullable: true })
  phoneNumber: string;

  @Column({ unique: true, nullable: true })
  telegramToken: string;

  @Column({ nullable: true })
  telegramChatId: string;

  @Column('text', { array: true, default: '{}' })
  refreshTokens: string[];

  @ManyToMany(() => Household, household => household.members)
  @JoinTable()
  households: Household[];

  @OneToMany(() => Task, task => task.assignee)
  assignedTasks: Task[];

  @ManyToMany(() => TaskType, taskType => taskType.preferringUsers)
  @JoinTable()
  preferredTaskTypes: TaskType[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
