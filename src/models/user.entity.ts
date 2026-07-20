import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Household } from './household.entity';
import { Task } from './task.entity';
import { TaskType } from './task-type.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  username!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column({ nullable: true, type: 'varchar' })
  profilePicture!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  phoneNumber!: string | null;

  @Column({ unique: true, nullable: true, type: 'varchar' })
  telegramToken!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  telegramChatId!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  googleAccessToken!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  googleRefreshToken!: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  googleTokenExpiresAt!: Date | null;

  @Column({ default: false })
  calendarSyncEnabled!: boolean;

  @Column('text', { array: true, default: '{}' })
  vibes!: string[];

  @Column('jsonb', { default: {} })
  preferences!: Record<string, any>;

  @Column('text', { array: true, default: '{}' })
  refreshTokens!: string[];

  @ManyToMany(() => Household, (household) => household.members)
  @JoinTable()
  households!: Household[];

  @OneToMany(() => Task, (task) => task.assignee)
  assignedTasks!: Task[];

  @ManyToMany(() => TaskType, (taskType) => taskType.preferringUsers)
  @JoinTable()
  preferredTaskTypes!: TaskType[];

  @CreateDateColumn()
  createdAt!: Date;
}
