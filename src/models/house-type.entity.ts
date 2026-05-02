import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Household } from './household.entity';

@Entity('house_types')
export class HouseType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string | null; // e.g., 'Apartment', 'Villa'

  @OneToMany(() => Household, (household) => household.houseType)
  households!: Household[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
