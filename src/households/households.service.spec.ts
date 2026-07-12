import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import type { GenerateContentResult } from '@google/generative-ai';
import { Household } from '../models/household.entity';
import { User } from '../models/user.entity';
import { Pet } from '../models/pet.entity';
import { TaskType } from '../models/task-type.entity';
import { Task } from '../models/task.entity';
import { HouseType } from '../models/house-type.enum';
import { DEFAULT_TASK_TYPES, TaskStatus } from '../helpers/consts';
import { promptGemini } from '../helpers/gemini';
import { HouseholdsService } from './households.service';

jest.mock('../helpers/gemini');

const makeHousehold = (overrides: Partial<Household> = {}): Household => ({
  id: 'hh-uuid',
  name: 'Test House',
  houseType: null,
  inviteCode: 'ABCD1234',
  pets: [],
  members: [],
  tasks: [],
  taskTypes: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-uuid',
  username: 'jane',
  email: 'jane@example.com',
  password: 'hashed-pw',
  profilePicture: null,
  phoneNumber: null,
  telegramToken: null,
  telegramChatId: null,
  googleAccessToken: null,
  googleRefreshToken: null,
  googleTokenExpiresAt: null,
  calendarSyncEnabled: false,
  vibes: [],
  preferences: {},
  refreshTokens: [],
  households: [],
  assignedTasks: [],
  preferredTaskTypes: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makePet = (overrides: Partial<Pet> = {}): Pet => ({
  id: 'pet-uuid',
  name: 'Rex',
  kind: 'Dog',
  household: makeHousehold(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeTaskType = (overrides: Partial<TaskType> = {}): TaskType => ({
  id: 'task-type-uuid',
  name: 'General',
  household: makeHousehold(),
  tasks: [],
  preferringUsers: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-uuid',
  title: 'Task',
  description: '',
  status: TaskStatus.PENDING,
  taskType: makeTaskType(),
  dueDate: null,
  points: 1,
  household: makeHousehold(),
  assignee: makeUser(),
  googleCalendarEventId: null,
  recurrenceRule: null,
  recurrenceParentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeQb = () => ({
  where: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  loadRelationCountAndMap: jest.fn().mockReturnThis(),
  getMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
});

const mockHouseholdRepo = () => ({
  create: jest
    .fn<(data: Partial<Household>) => Household>()
    .mockImplementation((d) => makeHousehold(d)),
  save: jest
    .fn<(household: Household) => Promise<Household>>()
    .mockImplementation((h) => Promise.resolve(h)),
  find: jest
    .fn<(options: object) => Promise<Household[]>>()
    .mockResolvedValue([]),
  findOne: jest
    .fn<(options: object) => Promise<Household | null>>()
    .mockResolvedValue(null),
  createQueryBuilder: jest
    .fn<() => ReturnType<typeof makeQb>>()
    .mockImplementation(() => makeQb()),
});

const mockUserRepo = () => ({
  findOneBy: jest.fn<(where: object) => Promise<User | null>>(),
  findOne: jest.fn<(options: object) => Promise<User | null>>(),
  save: jest
    .fn<(user: User) => Promise<User>>()
    .mockImplementation((u) => Promise.resolve(u)),
});

const mockPetRepo = () => ({
  create: jest
    .fn<(data: Partial<Pet>) => Pet>()
    .mockImplementation((d) => makePet(d)),
  save: jest
    .fn<(pet: Pet | Pet[]) => Promise<Pet | Pet[]>>()
    .mockImplementation((p) => Promise.resolve(p)),
  findOne: jest.fn<(options: object) => Promise<Pet | null>>(),
  findOneBy: jest.fn<(where: object) => Promise<Pet | null>>(),
  update: jest
    .fn<(id: string, data: object) => Promise<object>>()
    .mockResolvedValue({}),
  delete: jest
    .fn<(where: object) => Promise<{ affected: number | null }>>()
    .mockResolvedValue({ affected: 1 }),
});

const mockTaskTypeRepo = () => ({
  create: jest
    .fn<(data: Partial<TaskType>) => TaskType>()
    .mockImplementation((d) => makeTaskType(d)),
  save: jest
    .fn<(taskType: TaskType | TaskType[]) => Promise<TaskType | TaskType[]>>()
    .mockImplementation((t) => Promise.resolve(t)),
});

const mockTaskRepo = () => ({
  find: jest.fn<() => Promise<Task[]>>().mockResolvedValue([]),
  save: jest
    .fn<(task: Task | Task[]) => Promise<Task | Task[]>>()
    .mockImplementation((t) => Promise.resolve(t)),
});

describe('HouseholdsService', () => {
  let service: HouseholdsService;
  let householdRepo: ReturnType<typeof mockHouseholdRepo>;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let petRepo: ReturnType<typeof mockPetRepo>;
  let taskTypeRepo: ReturnType<typeof mockTaskTypeRepo>;
  let taskRepo: ReturnType<typeof mockTaskRepo>;

  beforeEach(async () => {
    jest.clearAllMocks();
    householdRepo = mockHouseholdRepo();
    userRepo = mockUserRepo();
    petRepo = mockPetRepo();
    taskTypeRepo = mockTaskTypeRepo();
    taskRepo = mockTaskRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HouseholdsService,
        { provide: getRepositoryToken(Household), useValue: householdRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Pet), useValue: petRepo },
        { provide: getRepositoryToken(TaskType), useValue: taskTypeRepo },
        { provide: getRepositoryToken(Task), useValue: taskRepo },
      ],
    }).compile();

    service = module.get(HouseholdsService);
  });

  // ── create() ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    let generateInviteCodeSpy: jest.SpiedFunction<
      typeof service.generateInviteCode
    >;
    let findOneSpy: jest.SpiedFunction<typeof service.findOne>;

    beforeEach(() => {
      generateInviteCodeSpy = jest
        .spyOn(service, 'generateInviteCode')
        .mockResolvedValue(makeHousehold());
      findOneSpy = jest
        .spyOn(service, 'findOne')
        .mockResolvedValue(makeHousehold());
      householdRepo.save.mockImplementation((h) =>
        Promise.resolve({ ...h, id: 'hh-uuid' }),
      );
    });

    it('seeds all default task types', async () => {
      await service.create({ name: 'My House' });

      expect(taskTypeRepo.save).toHaveBeenCalledWith(
        DEFAULT_TASK_TYPES.map((name) => expect.objectContaining({ name })),
      );
    });

    it('links the creator as a member when userId is provided and found', async () => {
      userRepo.findOneBy.mockResolvedValueOnce(makeUser());

      await service.create({ name: 'My House' }, 'user-uuid');

      expect(householdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          members: [expect.objectContaining({ id: 'user-uuid' })],
        }),
      );
    });

    it('skips linking when creator is not found', async () => {
      userRepo.findOneBy.mockResolvedValueOnce(null);

      await service.create({ name: 'My House' }, 'missing-user');

      expect(householdRepo.save).toHaveBeenCalledWith(
        expect.not.objectContaining({ members: expect.anything() }),
      );
    });

    it('skips linking when userId is omitted', async () => {
      await service.create({ name: 'My House' });

      expect(userRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('saves pets when petsData is a non-empty array', async () => {
      await service.create({
        name: 'My House',
        pets: [{ name: 'Rex', kind: 'Dog' }],
      });

      expect(petRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'Rex', kind: 'Dog' }),
      ]);
    });

    it('skips saving pets when petsData is absent or empty', async () => {
      await service.create({ name: 'My House' });
      expect(petRepo.save).not.toHaveBeenCalled();

      await service.create({ name: 'My House', pets: [] });
      expect(petRepo.save).not.toHaveBeenCalled();
    });

    it('generates an invite code and returns the fully-loaded household', async () => {
      const result = await service.create({ name: 'My House' });

      expect(generateInviteCodeSpy).toHaveBeenCalledWith('hh-uuid');
      expect(findOneSpy).toHaveBeenCalledWith('hh-uuid');
      expect(result).toEqual(makeHousehold());
    });
  });

  // ── findOne() ────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('returns the household with its relations', async () => {
      const household = makeHousehold();
      householdRepo.findOne.mockResolvedValueOnce(household);

      const result = await service.findOne('hh-uuid');

      expect(householdRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'hh-uuid' },
        relations: [
          'members',
          'tasks',
          'tasks.assignee',
          'tasks.taskType',
          'pets',
          'taskTypes',
        ],
      });
      expect(result).toBe(household);
    });

    it('throws NotFoundException when the household does not exist', async () => {
      householdRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findByUserId() ───────────────────────────────────────────────────────

  describe('findByUserId()', () => {
    it('basic view: builds a query with taskCount relation-count mapping', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([{ id: 'hh-1', name: 'House 1' }]);
      householdRepo.createQueryBuilder.mockReturnValueOnce(qb);

      const result = await service.findByUserId('user-uuid');

      expect(qb.innerJoin).toHaveBeenCalledWith(
        'household.members',
        'members',
        'members.id = :userId',
        { userId: 'user-uuid' },
      );
      expect(qb.loadRelationCountAndMap).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'hh-1', name: 'House 1' }]);
    });

    it('full view: returns [] immediately when the user has no households', async () => {
      householdRepo.find.mockResolvedValueOnce([]);

      const result = await service.findByUserId('user-uuid', true);

      expect(result).toEqual([]);
      expect(householdRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('full view: queries full relations for the user households found', async () => {
      householdRepo.find.mockResolvedValueOnce([
        makeHousehold({ id: 'hh-1' }),
        makeHousehold({ id: 'hh-2' }),
      ]);
      const qb = makeQb();
      qb.getMany.mockResolvedValueOnce([makeHousehold({ id: 'hh-1' })]);
      householdRepo.createQueryBuilder.mockReturnValueOnce(qb);

      const result = await service.findByUserId('user-uuid', true);

      expect(qb.where).toHaveBeenCalledWith('household.id IN (:...ids)', {
        ids: ['hh-1', 'hh-2'],
      });
      expect(result).toEqual([makeHousehold({ id: 'hh-1' })]);
    });
  });

  // ── submitOnboarding() ───────────────────────────────────────────────────

  describe('submitOnboarding()', () => {
    it('applies questionnaire data, saves, and returns AI-generated suggested tasks', async () => {
      const existing = makeHousehold({ name: 'Old Name' });
      const updated = makeHousehold({ id: 'hh-uuid', name: 'New Name' });
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);
      householdRepo.save.mockResolvedValueOnce({ ...existing, id: 'hh-uuid' });
      const geminiResult: GenerateContentResult = {
        response: {
          text: () => JSON.stringify([{ title: 'Task A' }]),
          functionCall: () => undefined,
          functionCalls: () => undefined,
        },
      };
      jest.mocked(promptGemini).mockResolvedValueOnce(geminiResult);

      const result = await service.submitOnboarding('hh-uuid', {
        name: 'New Name',
      });

      expect(householdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Name' }),
      );
      expect(result).toEqual({
        message: 'Onboarding complete. AI tasks generated.',
        household: updated,
        suggestedTasks: [{ title: 'Task A' }],
      });
    });

    it('propagates NotFoundException when the household does not exist', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockRejectedValueOnce(new NotFoundException());

      await expect(service.submitOnboarding('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── generateInviteCode() ─────────────────────────────────────────────────

  describe('generateInviteCode()', () => {
    it('generates a code and saves it on the household', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(makeHousehold());
      householdRepo.findOne.mockResolvedValueOnce(null); // no collision

      const result = await service.generateInviteCode('hh-uuid');

      expect(householdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          inviteCode: expect.stringMatching(/^[0-9A-F]{8}$/),
        }),
      );
      expect(result).toBeDefined();
    });

    it('retries when the generated code collides with an existing one', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(makeHousehold());
      householdRepo.findOne
        .mockResolvedValueOnce(makeHousehold({ inviteCode: 'COLLIDE1' })) // first attempt collides
        .mockResolvedValueOnce(null); // second attempt is free

      await service.generateInviteCode('hh-uuid');

      expect(householdRepo.findOne).toHaveBeenCalledTimes(2);
    });
  });

  // ── joinByInviteCode() ───────────────────────────────────────────────────

  describe('joinByInviteCode()', () => {
    it('throws NotFoundException for an unknown invite code', async () => {
      householdRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.joinByInviteCode('user-uuid', 'BADCODE1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      householdRepo.findOne.mockResolvedValueOnce(makeHousehold());
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.joinByInviteCode('missing-user', 'ABCD1234'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when already a member', async () => {
      const household = makeHousehold({ id: 'hh-uuid' });
      householdRepo.findOne.mockResolvedValueOnce(household);
      userRepo.findOne.mockResolvedValueOnce(
        makeUser({ households: [makeHousehold({ id: 'hh-uuid' })] }),
      );

      await expect(
        service.joinByInviteCode('user-uuid', 'ABCD1234'),
      ).rejects.toThrow(BadRequestException);
    });

    it('adds the household to the user and returns the refreshed household', async () => {
      const household = makeHousehold({ id: 'hh-uuid' });
      householdRepo.findOne.mockResolvedValueOnce(household);
      const user = makeUser({ households: [] });
      userRepo.findOne.mockResolvedValueOnce(user);
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(household);

      const result = await service.joinByInviteCode('user-uuid', 'ABCD1234');

      expect(user.households).toEqual([household]);
      expect(userRepo.save).toHaveBeenCalledWith(user);
      expect(result).toBe(household);
    });
  });

  // ── addTaskType() ────────────────────────────────────────────────────────

  describe('addTaskType()', () => {
    it('creates and saves a task type linked to the household', async () => {
      const household = makeHousehold();
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(household);

      await service.addTaskType('hh-uuid', 'Gardening');

      expect(taskTypeRepo.create).toHaveBeenCalledWith({
        name: 'Gardening',
        household,
      });
      expect(taskTypeRepo.save).toHaveBeenCalled();
    });

    it('propagates NotFoundException when the household is missing', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockRejectedValueOnce(new NotFoundException());

      await expect(service.addTaskType('missing', 'Gardening')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── removeUser() ─────────────────────────────────────────────────────────

  describe('removeUser()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(makeHousehold());
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.removeUser('hh-uuid', 'missing-user'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the user is not a member', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(makeHousehold());
      userRepo.findOne.mockResolvedValueOnce(makeUser({ households: [] }));

      await expect(service.removeUser('hh-uuid', 'user-uuid')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('removes the household from the user and unassigns their tasks', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(makeHousehold({ id: 'hh-uuid' }));
      const user = makeUser({ households: [makeHousehold({ id: 'hh-uuid' })] });
      userRepo.findOne.mockResolvedValueOnce(user);
      const staleTask = makeTask({
        id: 'task-1',
        assignee: user,
        status: TaskStatus.IN_PROGRESS,
      });
      taskRepo.find.mockResolvedValueOnce([staleTask]);

      await service.removeUser('hh-uuid', 'user-uuid');

      expect(user.households).toEqual([]);
      expect(userRepo.save).toHaveBeenCalledWith(user);
      expect(taskRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ assignee: null, status: TaskStatus.PENDING }),
      ]);
    });

    it('skips the task save call when the user has no assigned tasks', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(makeHousehold({ id: 'hh-uuid' }));
      const user = makeUser({ households: [makeHousehold({ id: 'hh-uuid' })] });
      userRepo.findOne.mockResolvedValueOnce(user);
      taskRepo.find.mockResolvedValueOnce([]);

      await service.removeUser('hh-uuid', 'user-uuid');

      expect(taskRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── pets ─────────────────────────────────────────────────────────────────

  describe('addPet()', () => {
    it('creates and saves a pet linked to the household', async () => {
      const household = makeHousehold();
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(household);

      await service.addPet('hh-uuid', { name: 'Rex', kind: 'Dog' });

      expect(petRepo.create).toHaveBeenCalledWith({
        name: 'Rex',
        kind: 'Dog',
        household,
      });
      expect(petRepo.save).toHaveBeenCalled();
    });
  });

  describe('updatePet()', () => {
    it('throws NotFoundException when the pet does not exist in the household', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(makeHousehold());
      petRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updatePet('hh-uuid', 'missing-pet', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates and re-fetches the pet on success', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(makeHousehold());
      petRepo.findOne.mockResolvedValueOnce(makePet({ id: 'pet-1' }));
      petRepo.findOneBy.mockResolvedValueOnce(
        makePet({ id: 'pet-1', name: 'Updated' }),
      );

      const result = await service.updatePet('hh-uuid', 'pet-1', {
        name: 'Updated',
      });

      expect(petRepo.update).toHaveBeenCalledWith('pet-1', { name: 'Updated' });
      expect(result).toEqual(
        expect.objectContaining({ id: 'pet-1', name: 'Updated' }),
      );
    });
  });

  describe('removePet()', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(makeHousehold());
      petRepo.delete.mockResolvedValueOnce({ affected: 0 });

      await expect(service.removePet('hh-uuid', 'missing-pet')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('resolves without error when the pet is deleted', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(makeHousehold());
      petRepo.delete.mockResolvedValueOnce({ affected: 1 });

      await expect(
        service.removePet('hh-uuid', 'pet-1'),
      ).resolves.toBeUndefined();
    });
  });

  // ── removeHouseType() ────────────────────────────────────────────────────

  describe('removeHouseType()', () => {
    it('sets houseType to null and returns the refreshed household', async () => {
      const household = makeHousehold({ houseType: HouseType.APARTMENT });
      const refreshed = makeHousehold({ houseType: null });
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(household)
        .mockResolvedValueOnce(refreshed);

      const result = await service.removeHouseType('hh-uuid');

      expect(household.houseType).toBeNull();
      expect(householdRepo.save).toHaveBeenCalledWith(household);
      expect(result).toBe(refreshed);
    });
  });
});
