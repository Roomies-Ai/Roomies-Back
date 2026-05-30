import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GoogleCalendarService } from '../src/google-calendar/google-calendar.service';
import { describe, beforeAll, afterAll, expect, it, jest } from '@jest/globals';

// Mock googleapis so no real Google HTTP calls are made during E2E tests
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock=1'),
        getToken: jest.fn().mockResolvedValue({
          tokens: {
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            expiry_date: Date.now() + 3_600_000,
          },
        }),
        refreshAccessToken: jest.fn().mockResolvedValue({
          credentials: {
            access_token: 'refreshed-token',
            refresh_token: 'mock-refresh-token',
            expiry_date: Date.now() + 3_600_000,
          },
        }),
        revokeToken: jest.fn().mockResolvedValue({}),
        setCredentials: jest.fn(),
      })),
    },
    calendar: jest.fn().mockReturnValue({
      events: {
        insert: jest.fn().mockResolvedValue({ data: { id: 'mock-event-id' } }),
        patch: jest.fn().mockResolvedValue({ data: {} }),
        delete: jest.fn().mockResolvedValue({}),
      },
    }),
  },
}));

const TEST_EMAIL = `gcal-test-${Date.now()}@test.com`;
const TEST_PASSWORD = 'Password123!';

describe('Google Calendar flow (e2e)', () => {
  let app: INestApplication;
  let googleCalendarService: GoogleCalendarService;
  let dataSource: DataSource;

  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    googleCalendarService = moduleFixture.get(GoogleCalendarService);
    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM users WHERE email = $1', [TEST_EMAIL]);
    await app.close();
  });

  it('registers a user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    accessToken = res.body.accessToken;
    userId = res.body.user.id;
  });

  it('GET /google-calendar/status returns not connected before OAuth', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({ connected: false, calendarSyncEnabled: false });
  });

  it('GET /google-calendar/connect returns a Google auth URL', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/connect')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.url).toBeDefined();
    expect(typeof res.body.url).toBe('string');
    expect(res.body.url).toContain('accounts.google.com');
  });

  it('GET /google-calendar/connect requires authentication', async () => {
    await request(app.getHttpServer())
      .get('/google-calendar/connect')
      .expect(401);
  });

  it('handleCallback persists tokens (simulates the OAuth browser callback)', async () => {
    const state = jwt.sign(
      { userId, nonce: 'e2e-nonce' },
      process.env.JWT_SECRET!,
      { expiresIn: '10m' },
    );

    await googleCalendarService.handleCallback('mock-auth-code', state);
  });

  it('GET /google-calendar/status shows connected after OAuth', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({ connected: true, calendarSyncEnabled: true });
  });

  it('PATCH /google-calendar/toggle disables calendar sync', async () => {
    const res = await request(app.getHttpServer())
      .patch('/google-calendar/toggle')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({ calendarSyncEnabled: false });
  });

  it('GET /google-calendar/status shows sync disabled', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.calendarSyncEnabled).toBe(false);
    expect(res.body.connected).toBe(true);
  });

  it('PATCH /google-calendar/toggle re-enables calendar sync', async () => {
    const res = await request(app.getHttpServer())
      .patch('/google-calendar/toggle')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({ calendarSyncEnabled: true });
  });

  it('DELETE /google-calendar/disconnect clears tokens', async () => {
    await request(app.getHttpServer())
      .delete('/google-calendar/disconnect')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('GET /google-calendar/status shows disconnected after disconnect', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({ connected: false, calendarSyncEnabled: false });
  });

  it('PATCH /google-calendar/toggle throws 400 when not connected', async () => {
    await request(app.getHttpServer())
      .patch('/google-calendar/toggle')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });
});
