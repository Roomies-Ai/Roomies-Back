import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { describe, beforeAll, afterAll, expect, it } from '@jest/globals';

const EMAIL = `auth-${Date.now()}@test.com`;
const PASSWORD = 'Password123!';

const extractRefreshToken = (res: request.Response): string => {
  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const match = cookies.join(';').match(/refreshToken=([^;]+)/);
  if (!match) throw new Error('refreshToken cookie not found in response');
  return match[1];
};

describe('Auth flows (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let agent: ReturnType<typeof request.agent>;
  let refreshTokenAtRegister: string;
  let refreshTokenAfterRefresh: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM users WHERE email = $1', [EMAIL]);
    await app.close();
  });

  it('POST /auth/register creates a user and sets a refreshToken cookie', async () => {
    const res = await agent
      .post('/auth/register')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.isAuth).toBe(true);
    expect(res.body.user.email).toBe(EMAIL);

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;
    expect(cookieStr).toContain('refreshToken=');
    expect(cookieStr).toMatch(/HttpOnly/i);

    refreshTokenAtRegister = extractRefreshToken(res);
  });

  it('POST /auth/register rejects a duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(400);
  });

  it('POST /auth/register rejects missing fields', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'incomplete@test.com' })
      .expect(400);
  });

  it('POST /auth/login rejects a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: EMAIL, password: 'wrong-password' })
      .expect(400);
  });

  it('POST /auth/login rejects a nonexistent email', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody-here@test.com', password: PASSWORD })
      .expect(400);
  });

  it('POST /auth/login succeeds with valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.isAuth).toBe(true);
  });

  it('POST /auth/refresh rejects when no cookie is present', async () => {
    await request(app.getHttpServer()).post('/auth/refresh').expect(400);
  });

  it('POST /auth/refresh rejects a tampered/unknown cookie', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', ['refreshToken=not-a-real-token'])
      .expect(400);
  });

  it('POST /auth/refresh issues new tokens and rotates the refresh token', async () => {
    // JWTs are signed from { userId, iat, exp } — iat has 1s granularity, so a
    // refresh issued within the same wall-clock second as registration would
    // sign to a byte-identical token. Wait past the second boundary so the
    // rotation is actually observable.
    await new Promise((r) => setTimeout(r, 1100));
    const res = await agent.post('/auth/refresh').expect(201);

    expect(res.body.accessToken).toBeDefined();
    refreshTokenAfterRefresh = extractRefreshToken(res);
    expect(refreshTokenAfterRefresh).not.toBe(refreshTokenAtRegister);
  });

  it('the pre-rotation refresh token is no longer valid', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshTokenAtRegister}`])
      .expect(400);
  });

  it('POST /auth/logout rejects when no cookie is present', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(400);
  });

  it('POST /auth/logout revokes the current refresh token', async () => {
    await agent.post('/auth/logout').expect(201);
  });

  it('the revoked refresh token can no longer be used to refresh', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshTokenAfterRefresh}`])
      .expect(400);
  });
});
