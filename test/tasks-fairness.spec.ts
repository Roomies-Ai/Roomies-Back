import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { describe, beforeAll, afterAll, expect, it, jest } from '@jest/globals';
import { promptGemini } from '../src/helpers/gemini';
import type { GenerateContentResult } from '@google/generative-ai';

jest.mock('../src/helpers/gemini');

const makeGeminiResult = (payload: unknown): GenerateContentResult => ({
  response: {
    text: () => JSON.stringify(payload),
    functionCall: () => undefined,
    functionCalls: () => undefined,
  },
});

const HOUSEHOLD_NAME = `E2EFairnessHousehold-${Date.now()}`;
const SOLO_HOUSEHOLD_NAME = `E2EFairnessSoloHousehold-${Date.now()}`;
const EMAIL_1 = `fairness-1-${Date.now()}@test.com`;
const EMAIL_2 = `fairness-2-${Date.now()}@test.com`;
const PASSWORD = 'Password123!';

describe('Task fairness suggestions (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let token1: string;
  let householdId: string;
  let soloHouseholdId: string;
  let taskId: string;
  let soloTaskId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    dataSource = moduleFixture.get(DataSource);

    const res1 = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EMAIL_1, password: PASSWORD })
      .expect(201);
    token1 = res1.body.accessToken;

    const res2 = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EMAIL_2, password: PASSWORD })
      .expect(201);
    const token2: string = res2.body.accessToken;

    const householdRes = await request(app.getHttpServer())
      .post('/households')
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: HOUSEHOLD_NAME })
      .expect(201);
    householdId = householdRes.body.id;
    const taskTypeId: string = householdRes.body.taskTypes[0].id;

    await request(app.getHttpServer())
      .post('/households/join')
      .set('Authorization', `Bearer ${token2}`)
      .send({ inviteCode: householdRes.body.inviteCode })
      .expect(201);

    const taskRes = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        title: 'Vacuum living room',
        description: 'Weekly vacuum',
        household: { id: householdId },
        taskType: taskTypeId,
      })
      .expect(201);
    taskId = taskRes.body.id;

    const soloHouseholdRes = await request(app.getHttpServer())
      .post('/households')
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: SOLO_HOUSEHOLD_NAME })
      .expect(201);
    soloHouseholdId = soloHouseholdRes.body.id;

    const soloTaskRes = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        title: 'Take out trash',
        description: 'Solo household task',
        household: { id: soloHouseholdId },
      })
      .expect(201);
    soloTaskId = soloTaskRes.body.id;
  });

  afterAll(async () => {
    await dataSource.query(
      'DELETE FROM tasks WHERE "householdId" IN (SELECT id FROM households WHERE name IN ($1, $2))',
      [HOUSEHOLD_NAME, SOLO_HOUSEHOLD_NAME],
    );
    await dataSource.query(
      'DELETE FROM users_households_households WHERE "householdsId" IN (SELECT id FROM households WHERE name IN ($1, $2))',
      [HOUSEHOLD_NAME, SOLO_HOUSEHOLD_NAME],
    );
    await dataSource.query('DELETE FROM households WHERE name IN ($1, $2)', [
      HOUSEHOLD_NAME,
      SOLO_HOUSEHOLD_NAME,
    ]);
    await dataSource.query('DELETE FROM users WHERE email IN ($1, $2)', [
      EMAIL_1,
      EMAIL_2,
    ]);
    await app.close();
  });

  it('GET /tasks/:id/fairness-suggestions returns the mocked Gemini suggestions', async () => {
    const suggestions = [
      { userId: 'user-1', username: 'jane', reason: 'Fair turn to help', score: 80 },
    ];
    jest.mocked(promptGemini).mockResolvedValueOnce(makeGeminiResult(suggestions));

    const res = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/fairness-suggestions`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    expect(res.body).toEqual(suggestions);
  });

  it('GET /tasks/:id/fairness-suggestions 404s for an unknown task', async () => {
    await request(app.getHttpServer())
      .get(`/tasks/${randomUUID()}/fairness-suggestions`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(404);
  });

  it('still returns a suggestion for a single-member household', async () => {
    const suggestions = [
      { userId: 'user-1', username: 'jane', reason: 'Only member available', score: 100 },
    ];
    jest.mocked(promptGemini).mockResolvedValueOnce(makeGeminiResult(suggestions));

    const res = await request(app.getHttpServer())
      .get(`/tasks/${soloTaskId}/fairness-suggestions`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    expect(res.body).toEqual(suggestions);
  });

  it('surfaces a 500 when Gemini returns malformed JSON (documents the unhandled-parse gap)', async () => {
    jest.mocked(promptGemini).mockResolvedValueOnce({
      response: {
        text: () => 'not valid json',
        functionCall: () => undefined,
        functionCalls: () => undefined,
      },
    });

    await request(app.getHttpServer())
      .get(`/tasks/${taskId}/fairness-suggestions`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(500);
  });
});
