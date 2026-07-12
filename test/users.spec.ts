import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { describe, beforeAll, afterAll, expect, it } from '@jest/globals';

interface TaskTypeLike {
  id: string;
  name: string;
}

const HOUSEHOLD_NAME = `E2EUsersHousehold-${Date.now()}`;
const EMAIL = `users-${Date.now()}@test.com`;
const PASSWORD = 'Password123!';
const NEW_PASSWORD = 'NewPassword456!';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let accessToken: string;
  let userId: string;
  let householdId: string;
  let taskTypeId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    dataSource = moduleFixture.get(DataSource);

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);
    accessToken = registerRes.body.accessToken;
    userId = registerRes.body.user.id;

    const householdRes = await request(app.getHttpServer())
      .post('/households')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: HOUSEHOLD_NAME })
      .expect(201);
    householdId = householdRes.body.id;
    taskTypeId = householdRes.body.taskTypes[0].id;
  });

  afterAll(async () => {
    await dataSource.query(
      'DELETE FROM users_households_households WHERE "householdsId" IN (SELECT id FROM households WHERE name = $1)',
      [HOUSEHOLD_NAME],
    );
    await dataSource.query('DELETE FROM households WHERE name = $1', [
      HOUSEHOLD_NAME,
    ]);
    await dataSource.query('DELETE FROM users WHERE email = $1', [EMAIL]);
    await app.close();
  });

  it('GET /users/me returns the sanitized user profile', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.id).toBe(userId);
    expect(Array.isArray(res.body.preferredTaskTypes)).toBe(true);
    expect(Array.isArray(res.body.households)).toBe(true);
  });

  it('GET /users/me rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('PATCH /users/me updates allowed fields and ignores disallowed ones', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        username: 'updated-name',
        phoneNumber: '555-0100',
        password: 'sneaky-password-change',
        id: 'sneaky-id-change',
      })
      .expect(200);

    expect(res.body.username).toBe('updated-name');
    expect(res.body.phoneNumber).toBe('555-0100');
    expect(res.body.id).toBe(userId);

    // Confirm the password field was NOT overwritten: login with the original
    // password still works.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);
  });

  it('PATCH /users/me/preferred-tasks updates and returns the sanitized shape', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me/preferred-tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ taskTypeIds: [taskTypeId] })
      .expect(200);

    expect(
      res.body.preferredTaskTypes.some((t: TaskTypeLike) => t.id === taskTypeId),
    ).toBe(true);
  });

  it('GET /users/me/available-tasks returns task types across the user\'s households', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me/available-tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.some((t: TaskTypeLike) => t.id === taskTypeId)).toBe(true);
  });

  it('PATCH /users/me/password rejects the wrong current password', async () => {
    await request(app.getHttpServer())
      .patch('/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: 'totally-wrong', newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('PATCH /users/me/password updates the password and rotates access', async () => {
    await request(app.getHttpServer())
      .patch('/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: EMAIL, password: NEW_PASSWORD })
      .expect(201);
  });
});
