import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Household } from '../models/household.entity';
import { User } from '../models/user.entity';
import { Pet } from '../models/pet.entity';
import { HouseType } from '../models/house-type.entity';
import { TaskType } from '../models/task-type.entity';
import { Task } from '../models/task.entity';
import { DEFAULT_TASK_TYPES, TaskStatus } from '../helpers/consts';
import { promptGemini } from '../helpers/gemini';
import { generateTasksPrompt } from '../helpers/prompts';
import { randomBytes } from 'crypto';

@Injectable()
export class HouseholdsService {
  constructor(
    @InjectRepository(Household)
    private householdsRepository: Repository<Household>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Pet)
    private petsRepository: Repository<Pet>,
    @InjectRepository(TaskType)
    private taskTypesRepository: Repository<TaskType>,
    @InjectRepository(HouseType)
    private houseTypesRepository: Repository<HouseType>,
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
  ) {}

  async create(createData: any, userId?: string): Promise<Household> {
    const { houseTypeId, pets: petsData, ...data } = createData;
    const household = this.householdsRepository.create(data as Partial<Household>);
    
    // Link House Type if provided
    if (houseTypeId) {
      const houseType = await this.houseTypesRepository.findOneBy({ id: houseTypeId });
      if (houseType) {
        household.houseType = houseType;
      }
    }

    // Link creator if userId is provided
    if (userId) {
      const creator = await this.usersRepository.findOneBy({ id: userId });
      if (creator) {
        household.members = [creator];
      }
    }

    const savedHousehold = await this.householdsRepository.save(household);

    // Generate unique invite code using the dedicated method
    await this.generateInviteCode(savedHousehold.id);

    // Seed default task types
    const taskTypes = DEFAULT_TASK_TYPES.map(name =>
      this.taskTypesRepository.create({ name, household: savedHousehold })
    );
    await this.taskTypesRepository.save(taskTypes);

    // Save pets if provided
    if (petsData && Array.isArray(petsData) && petsData.length > 0) {
      const pets = petsData.map((p: { name: string; kind: string }) =>
        this.petsRepository.create({ name: p.name, kind: p.kind, household: savedHousehold })
      );
      await this.petsRepository.save(pets);
    }

    return this.findOne(savedHousehold.id);
  }

  async findOne(id: string): Promise<Household> {
    const household = await this.householdsRepository.findOne({
      where: { id },
      relations: ['members', 'tasks', 'tasks.assignee', 'tasks.taskType', 'pets', 'houseType', 'taskTypes'],
    });
    if (!household) throw new NotFoundException(`Household #${id} not found`);
    return household;
  }

  async findByUserId(userId: string, full = false): Promise<any[]> {
    if (full) {
      const households = await this.householdsRepository.find({
        where: { members: { id: userId } },
        select: ['id']
      });
      if (households.length === 0) return [];
      
      const ids = households.map(h => h.id);
      return this.householdsRepository.createQueryBuilder('household')
        .where('household.id IN (:...ids)', { ids })
        .leftJoinAndSelect('household.members', 'members')
        .leftJoinAndSelect('household.tasks', 'tasks')
        .leftJoinAndSelect('tasks.assignee', 'assignee')
        .leftJoinAndSelect('tasks.taskType', 'taskType')
        .leftJoinAndSelect('household.pets', 'pets')
        .leftJoinAndSelect('household.houseType', 'houseType')
        .leftJoinAndSelect('household.taskTypes', 'taskTypes')
        .getMany();
    }

    // Basic view: Get ID, Name and Task Count efficiently
    return this.householdsRepository.createQueryBuilder('household')
      .innerJoin('household.members', 'members', 'members.id = :userId', { userId })
      .select(['household.id', 'household.name'])
      .loadRelationCountAndMap('household.taskCount', 'household.tasks')
      .getMany();
  }

  /**
   * Onboarding: saves questionnaire data to household fields and triggers
   * AI task generation based on the household's full profile.
   */
  async submitOnboarding(id: string, questionnaireData: any): Promise<any> {
    const household = await this.findOne(id);

    // Apply any top-level questionnaire fields (e.g. houseType, name) onto the household
    Object.assign(household, questionnaireData);
    const updatedHousehold = await this.householdsRepository.save(household);

    // Re-fetch with full relations so the AI prompt has complete context
    const fullHousehold = await this.findOne(updatedHousehold.id);

    // Generate tasks via AI based on the updated household profile
    const prompt = generateTasksPrompt(fullHousehold);
    const result = await promptGemini(prompt);
    const aiTasks = JSON.parse(result.response.text());

    return {
      message: 'Onboarding complete. AI tasks generated.',
      household: fullHousehold,
      suggestedTasks: aiTasks,
    };
  }

  /**
   * Generates a cryptographically secure, unique invite code for a household.
   */
  async generateInviteCode(id: string): Promise<Household> {
    const household = await this.findOne(id);

    let inviteCode: string;
    do {
      // 4 random bytes → 8 hex chars, uppercased
      inviteCode = randomBytes(4).toString('hex').toUpperCase();
    } while (await this.householdsRepository.findOne({ where: { inviteCode } }));

    household.inviteCode = inviteCode;
    return this.householdsRepository.save(household);
  }

  /**
   * Allows a user to join a household by its invite code.
   */
  async joinByInviteCode(userId: string, inviteCode: string): Promise<Household> {
    const household = await this.householdsRepository.findOne({
      where: { inviteCode },
      relations: ['members'],
    });
    if (!household) {
      throw new NotFoundException(`No household found with invite code "${inviteCode}"`);
    }

    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['households'],
    });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    const alreadyMember = user.households?.some(h => h.id === household.id);
    if (alreadyMember) {
      throw new BadRequestException('User is already a member of this household');
    }

    user.households = [...(user.households || []), household];
    await this.usersRepository.save(user);

    return this.findOne(household.id);
  }

  async addTaskType(householdId: string, name: string): Promise<TaskType> {
    const household = await this.findOne(householdId);
    const taskType = this.taskTypesRepository.create({ name, household });
    return this.taskTypesRepository.save(taskType);
  }

  async removeUser(householdId: string, userId: string): Promise<any> {
    // Validate household exists first
    await this.findOne(householdId);

    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['households'],
    });

    if (!user) {
      throw new NotFoundException(`User #${userId} not found`);
    }

    const isMember = user.households?.some(h => h.id === householdId);
    if (!isMember) {
      throw new BadRequestException(`User #${userId} is not a member of Household #${householdId}`);
    }

    user.households = user.households.filter(h => h.id !== householdId);
    await this.usersRepository.save(user);

    // Unassign tasks and set to pending in a type-safe way
    const tasksToUnassign = await this.tasksRepository.find({
      where: {
        household: { id: householdId },
        assignee: { id: userId }
      }
    });

    if (tasksToUnassign.length > 0) {
      tasksToUnassign.forEach(t => {
        t.assignee = null as any;
        t.status = TaskStatus.PENDING;
      });
      await this.tasksRepository.save(tasksToUnassign);
    }

    return { message: `User #${userId} removed from Household #${householdId}, tasks unassigned.` };
  }

  async addPet(householdId: string, petData: Partial<Pet>): Promise<Pet> {
    const household = await this.findOne(householdId);
    const pet = this.petsRepository.create({ ...petData, household });
    return this.petsRepository.save(pet);
  }

  async updatePet(householdId: string, petId: string, petData: Partial<Pet>): Promise<Pet> {
    await this.findOne(householdId); // Validates household exists
    const pet = await this.petsRepository.findOne({ where: { id: petId, household: { id: householdId } } });
    if (!pet) throw new NotFoundException(`Pet #${petId} not found in Household #${householdId}`);

    await this.petsRepository.update(petId, petData);
    return this.petsRepository.findOneBy({ id: petId }) as Promise<Pet>;
  }

  async removePet(householdId: string, petId: string): Promise<void> {
    await this.findOne(householdId); // Validates household exists
    const result = await this.petsRepository.delete({ id: petId, household: { id: householdId } });
    if (result.affected === 0) {
      throw new NotFoundException(`Pet #${petId} not found in Household #${householdId}`);
    }
  }

  /**
   * Removes (unlinks) the house type from a household without deleting the HouseType record.
   */
  async removeHouseType(householdId: string): Promise<Household> {
    const household = await this.findOne(householdId);
    household.houseType = null;
    await this.householdsRepository.save(household);
    return this.findOne(householdId);
  }
}
