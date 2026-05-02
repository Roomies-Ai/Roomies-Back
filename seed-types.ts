import { DataSource } from 'typeorm';
import { HouseType } from './src/models/house-type.entity';
import * as dotenv from 'dotenv';
import { Household } from './src/models/household.entity';
import { User } from './src/models/user.entity';
import { Task } from './src/models/task.entity';
import { Pet } from './src/models/pet.entity';
import { TaskType } from './src/models/task-type.entity';

dotenv.config();

const AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [HouseType, Household, User, Task, Pet, TaskType],
    synchronize: false,
});

async function seed() {
    await AppDataSource.initialize();
    const repo = AppDataSource.getRepository(HouseType);

    const types = ['Apartment', 'Villa', 'Studio', 'Bungalow', 'Cottage', 'Townhouse', 'Chalet', 'Loft', 'Mansion', 'Duplex', 'Triplex', 'Quadplex', 'Other'];

    for (const name of types) {
        const exists = await repo.findOneBy({ name });
        if (!exists) {
            await repo.save(repo.create({ name }));
            console.log(`Seeded: ${name}`);
        }
    }

    await AppDataSource.destroy();
}

seed().catch(console.error);
