import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import type { GenerateContentResult } from '@google/generative-ai';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { Household } from '../models/household.entity';
import { TaskType } from '../models/task-type.entity';
import { TaskStatus } from '../helpers/consts';
import { promptGemini } from '../helpers/gemini';
import { FairnessService } from './fairness.service';

jest.mock('../helpers/gemini');

const makeGeminiResult = (payload: unknown): GenerateContentResult => ({
  response: {
    text: () => JSON.stringify(payload),
    functionCall: () => undefined,
    functionCalls: () => undefined,
  },
});

const makeTaskType = (overrides: Partial<TaskType> = {}): TaskType =>
  ({ id: 'tt-1', name: 'Cleaning', ...overrides }) as TaskType;

const makeMember = (overrides: Partial<User> = {}): User =>
  ({ id: 'user-1', username: 'jane', preferredTaskTypes: [], ...overrides }) as User;

const makeHousehold = (overrides: Partial<Household> = {}): Household =>
  ({ id: 'hh-1', members: [makeMember()], ...overrides }) as Household;

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-1',
    title: 'Vacuum',
    points: 3,
    taskType: makeTaskType(),
    household: makeHousehold(),
    ...overrides,
  }) as Task;

const mockTaskRepo = () => ({
  findOne: jest.fn<(options: object) => Promise<Task | null>>(),
  find: jest.fn<(options: object) => Promise<Task[]>>().mockResolvedValue([]),
});

const mockUserRepo = () => ({});
const mockHouseholdRepo = () => ({});

describe('FairnessService', () => {
  let service: FairnessService;
  let taskRepo: ReturnType<typeof mockTaskRepo>;

  beforeEach(async () => {
    jest.clearAllMocks();
    taskRepo = mockTaskRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FairnessService,
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo() },
        { provide: getRepositoryToken(Household), useValue: mockHouseholdRepo() },
      ],
    }).compile();

    service = module.get(FairnessService);
  });

  it('throws NotFoundException when the task does not exist', async () => {
    taskRepo.findOne.mockResolvedValueOnce(null);

    await expect(service.getFairnessSuggestions('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns [] without calling Gemini when the household has no members', async () => {
    taskRepo.findOne.mockResolvedValueOnce(
      makeTask({ household: makeHousehold({ members: [] }) }),
    );

    const result = await service.getFairnessSuggestions('task-1');

    expect(result).toEqual([]);
    expect(promptGemini).not.toHaveBeenCalled();
  });

  it('zeroes out type-specific stats when the task has no taskType', async () => {
    const member = makeMember({ preferredTaskTypes: [makeTaskType()] });
    taskRepo.findOne.mockResolvedValueOnce(
      makeTask({
        taskType: null as unknown as TaskType,
        household: makeHousehold({ members: [member] }),
      }),
    );
    taskRepo.find.mockResolvedValueOnce([
      { points: 5, taskType: makeTaskType() } as Task,
    ]);
    jest.mocked(promptGemini).mockResolvedValueOnce(makeGeminiResult([]));

    await service.getFairnessSuggestions('task-1');

    const prompt = jest.mocked(promptGemini).mock.calls[0][0];
    expect(prompt).toContain('Experience with this type: 0 times');
    expect(prompt).toContain('Neutral/No preference');
  });

  it('computes per-member totalPoints, timesDoneThisType, and prefersThisType', async () => {
    const preferredType = makeTaskType({ id: 'tt-1' });
    const member = makeMember({ id: 'user-1', preferredTaskTypes: [preferredType] });
    taskRepo.findOne.mockResolvedValueOnce(
      makeTask({
        taskType: preferredType,
        household: makeHousehold({ members: [member] }),
      }),
    );
    taskRepo.find.mockResolvedValueOnce([
      { points: 5, taskType: preferredType } as Task,
      { points: 2, taskType: makeTaskType({ id: 'tt-2' }) } as Task,
      { points: 3, taskType: preferredType } as Task,
    ]);
    jest.mocked(promptGemini).mockResolvedValueOnce(makeGeminiResult([]));

    await service.getFairnessSuggestions('task-1');

    const prompt = jest.mocked(promptGemini).mock.calls[0][0];
    expect(prompt).toContain('Total Impact Points: 10');
    expect(prompt).toContain('Experience with this type: 2 times');
    expect(prompt).toContain('LOVES this category');
  });

  it('queries completed tasks once per household member', async () => {
    const memberA = makeMember({ id: 'user-a' });
    const memberB = makeMember({ id: 'user-b' });
    taskRepo.findOne.mockResolvedValueOnce(
      makeTask({ household: makeHousehold({ members: [memberA, memberB] }) }),
    );
    jest.mocked(promptGemini).mockResolvedValueOnce(makeGeminiResult([]));

    await service.getFairnessSuggestions('task-1');

    expect(taskRepo.find).toHaveBeenCalledTimes(2);
  });

  it('parses and returns the Gemini suggestions', async () => {
    taskRepo.findOne.mockResolvedValueOnce(makeTask());
    const suggestions = [{ userId: 'user-1', username: 'jane', reason: 'Great match', score: 90 }];
    jest.mocked(promptGemini).mockResolvedValueOnce(makeGeminiResult(suggestions));

    const result = await service.getFairnessSuggestions('task-1');

    expect(promptGemini).toHaveBeenCalledTimes(1);
    expect(result).toEqual(suggestions);
  });

  it('propagates the JSON.parse error when Gemini returns malformed JSON (no fallback, unlike TasksService)', async () => {
    taskRepo.findOne.mockResolvedValueOnce(makeTask());
    jest.mocked(promptGemini).mockResolvedValueOnce({
      response: {
        text: () => 'not valid json',
        functionCall: () => undefined,
        functionCalls: () => undefined,
      },
    });

    await expect(service.getFairnessSuggestions('task-1')).rejects.toThrow(SyntaxError);
  });
});
