import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { describe, beforeAll, afterAll, expect, it } from '@jest/globals';

const HOUSEHOLD_NAME = `E2EStatsHousehold-${Date.now()}`;
const EMAIL_MEMBER = `stats-member-${Date.now()}@test.com`;
const EMAIL_OUTSIDER = `stats-outsider-${Date.now()}@test.com`;
const PASSWORD = 'Password123!';

describe('Stats (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let memberToken: string;
  let outsiderToken: string;
  let householdId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    dataSource = moduleFixture.get(DataSource);

    const memberRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EMAIL_MEMBER, password: PASSWORD })
      .expect(201);
    memberToken = memberRes.body.accessToken;
    const memberId = memberRes.body.user.id;

    const outsiderRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EMAIL_OUTSIDER, password: PASSWORD })
      .expect(201);
    outsiderToken = outsiderRes.body.accessToken;

    const householdRes = await request(app.getHttpServer())
      .post('/households')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: HOUSEHOLD_NAME })
      .expect(201);
    householdId = householdRes.body.id;

    await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        title: 'Completed chore',
        description: 'Already done',
        household: { id: householdId },
        assignee: { id: memberId },
        points: 4,
        status: 'completed',
      })
      .expect(201);
  });

  afterAll(async () => {
    await dataSource.query(
      'DELETE FROM tasks WHERE "householdId" IN (SELECT id FROM households WHERE name = $1)',
      [HOUSEHOLD_NAME],
    );
    await dataSource.query(
      'DELETE FROM users_households_households WHERE "householdsId" IN (SELECT id FROM households WHERE name = $1)',
      [HOUSEHOLD_NAME],
    );
    await dataSource.query('DELETE FROM households WHERE name = $1', [
      HOUSEHOLD_NAME,
    ]);
    await dataSource.query('DELETE FROM users WHERE email IN ($1, $2)', [
      EMAIL_MEMBER,
      EMAIL_OUTSIDER,
    ]);
    await app.close();
  });

  describe('GET /stats/fairness', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get(`/stats/fairness?householdId=${householdId}`)
        .expect(401);
    });

    it('rejects requests missing the householdId query param', async () => {
      await request(app.getHttpServer())
        .get('/stats/fairness')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(400);
    });

    it('rejects a non-member of the household', async () => {
      await request(app.getHttpServer())
        .get(`/stats/fairness?householdId=${householdId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it('returns aggregated stats for a member', async () => {
      const res = await request(app.getHttpServer())
        .get(`/stats/fairness?householdId=${householdId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(res.body.totalPoints).toBeGreaterThanOrEqual(4);
      expect(res.body.totalTasks).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /stats/pulse', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get(`/stats/pulse?householdId=${householdId}`)
        .expect(401);
    });

    it('rejects requests missing the householdId query param', async () => {
      await request(app.getHttpServer())
        .get('/stats/pulse')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(400);
    });

    it('rejects a non-member of the household', async () => {
      await request(app.getHttpServer())
        .get(`/stats/pulse?householdId=${householdId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it('returns a leaderboard and distribution for a member', async () => {
      const res = await request(app.getHttpServer())
        .get(`/stats/pulse?householdId=${householdId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(Array.isArray(res.body.leaderboard)).toBe(true);
      expect(res.body.leaderboard.length).toBeGreaterThanOrEqual(1);
      expect(res.body.distribution).toBeDefined();
    });
  });
});
