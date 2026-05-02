import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToMany,
  ManyToOne,
} from 'typeorm';
import { User } from './user.entity';
import { Task } from './task.entity';
import { Pet } from './pet.entity';
import { HouseType } from './house-type.entity';
import { TaskType } from './task-type.entity';

@Entity('households')
export class Household {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @ManyToOne(() => HouseType, (houseType) => houseType.households, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  houseType!: HouseType | null;

  @Column({ unique: true, nullable: true })
  inviteCode!: string | null;

  @OneToMany(() => Pet, (pet) => pet.household, { cascade: true })
  pets!: Pet[];

  @ManyToMany(() => User, (user) => user.households)
  members!: User[];

  @OneToMany(() => Task, (task) => task.household)
  tasks!: Task[];

  @OneToMany(() => TaskType, (taskType) => taskType.household, {
    cascade: true,
  })
  taskTypes!: TaskType[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
