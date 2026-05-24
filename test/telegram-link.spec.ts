import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { describe, beforeAll, afterAll, expect, it } from '@jest/globals';

const TEST_EMAIL = `telegram-test-${Date.now()}@test.com`;
const TEST_PASSWORD = 'Password123!';
const FAKE_CHAT_ID = '987654321';

describe('Telegram linking flow (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let dataSource: DataSource;

  let accessToken: string;
  let userId: string;
  let telegramToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    usersService = moduleFixture.get(UsersService);
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
    expect(res.body.user.id).toBeDefined();
    accessToken = res.body.accessToken;
    userId = res.body.user.id;
  });

  it('GET /users/me/telegram-token returns a token (auto-generated on register)', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me/telegram-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.telegramToken).toBeDefined();
    expect(typeof res.body.telegramToken).toBe('string');
    expect(res.body.telegramToken.length).toBe(8);
    telegramToken = res.body.telegramToken;
  });

  it('findByTelegramToken resolves to the correct user', async () => {
    const user = await usersService.findByTelegramToken(telegramToken);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(userId);
  });

  it('saveTelegramChatId persists the chatId (simulates bot /connect)', async () => {
    await usersService.saveTelegramChatId(userId, FAKE_CHAT_ID);
    const user = await usersService.findUserById(userId);
    expect(user!.telegramChatId).toBe(FAKE_CHAT_ID);
  });

  it('GET /users/me returns telegramChatId after linking', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.telegramChatId).toBe(FAKE_CHAT_ID);
  });

  it('DELETE /users/me/telegram unlinks the account', async () => {
    await request(app.getHttpServer())
      .delete('/users/me/telegram')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('GET /users/me has null telegramChatId after unlinking', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.telegramChatId).toBeNull();
  });

  it('old token no longer resolves a user after unlink (token rotated)', async () => {
    const user = await usersService.findByTelegramToken(telegramToken);
    expect(user).toBeNull();
  });

  it('GET /users/me/telegram-token returns a new token after unlink', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me/telegram-token')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.telegramToken).toBeDefined();
    expect(res.body.telegramToken).not.toBe(telegramToken);
  });
});
