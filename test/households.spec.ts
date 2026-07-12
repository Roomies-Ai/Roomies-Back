import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { describe, beforeAll, afterAll, expect, it, jest } from '@jest/globals';
import { DEFAULT_TASK_TYPES } from '../src/helpers/consts';
import { promptGemini } from '../src/helpers/gemini';
import type { GenerateContentResult } from '@google/generative-ai';

jest.mock('../src/helpers/gemini');

const mockGeminiResult: GenerateContentResult = {
  response: {
    text: () =>
      JSON.stringify([
        { title: 'Wipe kitchen counters', description: 'Quick wipe-down', points: 2 },
      ]),
    functionCall: () => undefined,
    functionCalls: () => undefined,
  },
};

jest.mocked(promptGemini).mockResolvedValue(mockGeminiResult);

interface TaskTypeLike {
  name: string;
}

interface MemberLike {
  id: string;
}

interface TaskLike {
  id: string;
}

interface HouseholdLike {
  id: string;
}

const HOUSEHOLD_NAME = `E2EHousehold-${Date.now()}`;
const NO_AUTH_HOUSEHOLD_NAME = `E2ENoAuthHousehold-${Date.now()}`;
const EMAIL_1 = `households-creator-${Date.now()}@test.com`;
const EMAIL_2 = `households-joiner-${Date.now()}@test.com`;
const PASSWORD = 'Password123!';

describe('Households (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let token1: string;
  let token2: string;
  let userId2: string;
  let householdId: string;
  let originalInviteCode: string;
  let newInviteCode: string;
  let taskId: string;
  let petId: string;

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
    token2 = res2.body.accessToken;
    userId2 = res2.body.user.id;
  });

  afterAll(async () => {
    await dataSource.query(
      'DELETE FROM tasks WHERE "householdId" IN (SELECT id FROM households WHERE name = $1)',
      [HOUSEHOLD_NAME],
    );
    await dataSource.query(
      'DELETE FROM users_households_households WHERE "householdsId" IN (SELECT id FROM households WHERE name IN ($1, $2))',
      [HOUSEHOLD_NAME, NO_AUTH_HOUSEHOLD_NAME],
    );
    await dataSource.query('DELETE FROM households WHERE name IN ($1, $2)', [
      HOUSEHOLD_NAME,
      NO_AUTH_HOUSEHOLD_NAME,
    ]);
    await dataSource.query('DELETE FROM users WHERE email IN ($1, $2)', [
      EMAIL_1,
      EMAIL_2,
    ]);
    await app.close();
  });

  it('POST /households creates a household, seeding default task types and an invite code', async () => {
    const res = await request(app.getHttpServer())
      .post('/households')
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: HOUSEHOLD_NAME })
      .expect(201);

    householdId = res.body.id;
    originalInviteCode = res.body.inviteCode;

    expect(householdId).toBeDefined();
    expect(originalInviteCode).toMatch(/^[0-9A-F]{8}$/);
    expect(res.body.taskTypes).toHaveLength(DEFAULT_TASK_TYPES.length);
    expect(res.body.taskTypes.map((t: TaskTypeLike) => t.name).sort()).toEqual(
      [...DEFAULT_TASK_TYPES].sort(),
    );
  });

  it('POST /households without auth still succeeds but has no members', async () => {
    const res = await request(app.getHttpServer())
      .post('/households')
      .send({ name: NO_AUTH_HOUSEHOLD_NAME })
      .expect(201);

    expect(res.body.members).toEqual([]);
  });

  it('GET /households/me returns a basic view with taskCount', async () => {
    const res = await request(app.getHttpServer())
      .get('/households/me')
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    const mine = res.body.find((h: HouseholdLike) => h.id === householdId);
    expect(mine).toBeDefined();
    expect(mine.taskCount).toBeDefined();
  });

  it('GET /households/me?full=true returns full relations', async () => {
    const res = await request(app.getHttpServer())
      .get('/households/me?full=true')
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    const mine = res.body.find((h: HouseholdLike) => h.id === householdId);
    expect(mine).toBeDefined();
    expect(Array.isArray(mine.tasks)).toBe(true);
    expect(Array.isArray(mine.pets)).toBe(true);
    expect(Array.isArray(mine.taskTypes)).toBe(true);
  });

  it('GET /households/:id returns 404 for an unknown but valid uuid', async () => {
    await request(app.getHttpServer())
      .get(`/households/${randomUUID()}`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(404);
  });

  it('PATCH /households/:id/onboarding persists fields and returns AI-suggested tasks', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/households/${householdId}/onboarding`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: HOUSEHOLD_NAME })
      .expect(200);

    expect(res.body.message).toBe('Onboarding complete. AI tasks generated.');
    expect(res.body.household.id).toBe(householdId);
    expect(res.body.suggestedTasks).toEqual([
      { title: 'Wipe kitchen counters', description: 'Quick wipe-down', points: 2 },
    ]);
  });

  it('POST /households/:id/invites regenerates the invite code', async () => {
    const res = await request(app.getHttpServer())
      .post(`/households/${householdId}/invites`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(201);

    newInviteCode = res.body.inviteCode;
    expect(newInviteCode).toMatch(/^[0-9A-F]{8}$/);
    expect(newInviteCode).not.toBe(originalInviteCode);
  });

  it('POST /households/join rejects the old, regenerated-away invite code', async () => {
    await request(app.getHttpServer())
      .post('/households/join')
      .set('Authorization', `Bearer ${token2}`)
      .send({ inviteCode: originalInviteCode })
      .expect(404);
  });

  it('POST /households/join rejects an unknown invite code', async () => {
    await request(app.getHttpServer())
      .post('/households/join')
      .set('Authorization', `Bearer ${token2}`)
      .send({ inviteCode: 'NOTREAL1' })
      .expect(404);
  });

  it('POST /households/join rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/households/join')
      .send({ inviteCode: newInviteCode })
      .expect(401);
  });

  it('POST /households/join adds the user as a member using the current invite code', async () => {
    const res = await request(app.getHttpServer())
      .post('/households/join')
      .set('Authorization', `Bearer ${token2}`)
      .send({ inviteCode: newInviteCode })
      .expect(201);

    expect(res.body.members.some((m: MemberLike) => m.id === userId2)).toBe(true);
  });

  it('POST /households/join rejects joining a second time', async () => {
    await request(app.getHttpServer())
      .post('/households/join')
      .set('Authorization', `Bearer ${token2}`)
      .send({ inviteCode: newInviteCode })
      .expect(400);
  });

  it('POST /households/:id/task-types adds a custom task type', async () => {
    await request(app.getHttpServer())
      .post(`/households/${householdId}/task-types`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: 'Gardening' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/households/${householdId}`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    expect(res.body.taskTypes.some((t: TaskTypeLike) => t.name === 'Gardening')).toBe(true);
  });

  it('DELETE /households/:id/users/:userId unassigns the removed member\'s tasks', async () => {
    const taskRes = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        title: 'Take out trash',
        description: 'Empty all bins',
        household: { id: householdId },
        assignee: { id: userId2 },
        dueDate: new Date().toISOString(),
      })
      .expect(201);
    taskId = taskRes.body.id;

    await request(app.getHttpServer())
      .delete(`/households/${householdId}/users/${userId2}`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    const tasksRes = await request(app.getHttpServer())
      .get(`/tasks?householdId=${householdId}`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    const unassigned = tasksRes.body.find((t: TaskLike) => t.id === taskId);
    expect(unassigned.assignee).toBeNull();
    expect(unassigned.status).toBe('pending');
  });

  it('DELETE /households/:id/users/:userId rejects a user who is not a member', async () => {
    await request(app.getHttpServer())
      .delete(`/households/${householdId}/users/${userId2}`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(400);
  });

  it('DELETE /households/:id/users/:userId 404s for an unknown household', async () => {
    await request(app.getHttpServer())
      .delete(`/households/${randomUUID()}/users/${userId2}`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(404);
  });

  it('pets: full add / update / remove round trip', async () => {
    const addRes = await request(app.getHttpServer())
      .post(`/households/${householdId}/pets`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: 'Rex', kind: 'Dog' })
      .expect(201);
    petId = addRes.body.id;
    expect(addRes.body.name).toBe('Rex');

    const updateRes = await request(app.getHttpServer())
      .patch(`/households/${householdId}/pets/${petId}`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: 'Rex Jr.' })
      .expect(200);
    expect(updateRes.body.name).toBe('Rex Jr.');

    await request(app.getHttpServer())
      .delete(`/households/${householdId}/pets/${petId}`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);
  });

  it('pets: updating/removing an unknown pet 404s', async () => {
    await request(app.getHttpServer())
      .patch(`/households/${householdId}/pets/${randomUUID()}`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: 'Ghost' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/households/${householdId}/pets/${randomUUID()}`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(404);
  });

  it('DELETE /households/:id/house-type unlinks the house type', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/households/${householdId}/house-type`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    expect(res.body.houseType).toBeNull();
  });
});
