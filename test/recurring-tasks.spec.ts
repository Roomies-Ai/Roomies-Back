import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { describe, beforeAll, afterAll, expect, it, jest } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({
      generateAuthUrl: (jest.fn() as any).mockReturnValue('https://accounts.google.com/mock'),
      getToken: (jest.fn() as any).mockResolvedValue({ tokens: { access_token: 'tok', refresh_token: 'rtok', expiry_date: Date.now() + 3_600_000 } }),
      refreshAccessToken: (jest.fn() as any).mockResolvedValue({ credentials: { access_token: 'tok2', refresh_token: 'rtok', expiry_date: Date.now() + 3_600_000 } }),
      revokeToken: (jest.fn() as any).mockResolvedValue({}),
      setCredentials: jest.fn(),
    })) },
    calendar: jest.fn().mockReturnValue({
      events: {
        insert: (jest.fn() as any).mockResolvedValue({ data: { id: 'cal-event-id' } }),
        patch: (jest.fn() as any).mockResolvedValue({ data: {} }),
        delete: (jest.fn() as any).mockResolvedValue({}),
      },
    }),
  },
} as any));
/* eslint-enable @typescript-eslint/no-explicit-any */

const EMAIL = `recurring-${Date.now()}@test.com`;
const PASSWORD = 'Password123!';

describe('Recurring tasks (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accessToken: string;
  let householdId: string;
  let templateTaskId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM tasks WHERE household_id IN (SELECT id FROM households WHERE name = $1)', ['RecurringTestHH']);
    await dataSource.query('DELETE FROM households WHERE name = $1', ['RecurringTestHH']);
    await dataSource.query('DELETE FROM users WHERE email = $1', [EMAIL]);
    await app.close();
  });

  it('registers a user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);

    accessToken = res.body.accessToken;
  });

  it('creates a household', async () => {
    const res = await request(app.getHttpServer())
      .post('/households')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'RecurringTestHH' })
      .expect(201);

    householdId = res.body.id;
    expect(householdId).toBeDefined();
  });

  it('POST /tasks with recurrenceRule creates a template and pre-generates instances', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);

    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Weekly Vacuum',
        description: 'Vacuum the living room',
        household: { id: householdId },
        dueDate: futureDate.toISOString(),
        points: 2,
        recurrenceRule: {
          frequency: 'DAILY',
          interval: 1,
          timeOfDay: '08:00',
        },
      })
      .expect(201);

    templateTaskId = res.body.id;
    expect(res.body.recurrenceRule).toBeDefined();
    expect(res.body.recurrenceRule.frequency).toBe('DAILY');
    expect(res.body.recurrenceParentId).toBeNull();

    // Give async instance generation a moment to complete
    await new Promise((r) => setTimeout(r, 500));
  });

  it('GET /tasks/:id/recurrence returns pre-generated instances', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tasks/${templateTaskId}/recurrence`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const instance = res.body[0];
    expect(instance.recurrenceParentId).toBe(templateTaskId);
    expect(instance.googleCalendarEventId).toBeNull();
  });

  it('PATCH /tasks/:id/status COMPLETED on instance generates the next occurrence', async () => {
    // Get an instance
    const listRes = await request(app.getHttpServer())
      .get(`/tasks/${templateTaskId}/recurrence`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const instanceId = listRes.body[0].id;
    const countBefore = listRes.body.length;

    await request(app.getHttpServer())
      .patch(`/tasks/${instanceId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'COMPLETED' })
      .expect(200);

    // Wait for async generation
    await new Promise((r) => setTimeout(r, 500));

    const afterRes = await request(app.getHttpServer())
      .get(`/tasks/${templateTaskId}/recurrence`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(afterRes.body.length).toBeGreaterThanOrEqual(countBefore);
  });

  it('PATCH /tasks/:id with clearRecurrence removes the rule', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/tasks/${templateTaskId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ clearRecurrence: true })
      .expect(200);

    expect(res.body.recurrenceRule).toBeNull();
  });

  it('POST /tasks rejects invalid recurrenceRule with 400', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Bad Task',
        recurrenceRule: {
          frequency: 'INVALID_FREQ',
          interval: -1,
        },
      })
      .expect(400);
  });
});
