import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../models/user.entity';
import { UserDto } from '../dtos/user.dto';

const genSaltMock = jest.fn<(rounds?: number) => Promise<string>>();
const hashMock =
  jest.fn<(password: string, salt: number | string) => Promise<string>>();
const compareMock =
  jest.fn<(password: string, hash: string) => Promise<boolean>>();
jest.mock('bcryptjs', () => ({
  genSalt: (rounds?: number) => genSaltMock(rounds),
  hash: (password: string, salt: number | string) => hashMock(password, salt),
  compare: (password: string, hash: string) => compareMock(password, hash),
}));

interface JwtPayload {
  userId: string;
}

const jwtSignMock =
  jest.fn<(payload: object, secret: string, options?: object) => string>();
const jwtVerifyMock = jest.fn<(token: string, secret: string) => JwtPayload>();
jest.mock('jsonwebtoken', () => ({
  sign: (payload: object, secret: string, options?: object) =>
    jwtSignMock(payload, secret, options),
  verify: (token: string, secret: string) => jwtVerifyMock(token, secret),
}));

interface GoogleUserInfoResponse {
  data: { email: string; name: string; profilePicture: string };
}

const axiosGetMock =
  jest.fn<(url: string, config?: object) => Promise<GoogleUserInfoResponse>>();
jest.mock('axios', () => ({
  get: (url: string, config?: object) => axiosGetMock(url, config),
}));

interface GoogleTokenInfo {
  azp?: string;
}

const getTokenInfoMock =
  jest.fn<(accessToken: string) => Promise<GoogleTokenInfo>>();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    getTokenInfo: (accessToken: string) => getTokenInfoMock(accessToken),
  })),
}));

const CONFIG_MAP: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'client-id',
  JWT_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  NODE_ENV: 'test',
};

const makeConfigService = (
  overrides: Record<string, string | undefined> = {},
) => ({
  get: jest.fn((key: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, key))
      return overrides[key];
    return CONFIG_MAP[key];
  }),
});

const userId = crypto.randomUUID();
const makeUser = (overrides: Partial<User> = {}): User => ({
  id: userId,
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

const mockUserRepo = () => ({
  findOneBy: jest.fn<(where: Partial<User>) => Promise<User | null>>(),
  create: jest
    .fn<(data: Partial<User>) => User>()
    .mockImplementation((data) => makeUser(data)),
  save: jest.fn<(user: User) => Promise<User>>(),
});

const mockRequest = (
  body: Record<string, unknown> = {},
  cookies: Record<string, string> = {},
) => ({ body, cookies }) as unknown as Request;

const mockResponse = () => {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    res: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
};

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let usersService: {
    generateTelegramToken: jest.Mock<(userId: string) => Promise<User>>;
  };
  let configService: ReturnType<typeof makeConfigService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    userRepo = mockUserRepo();
    usersService = {
      generateTelegramToken: jest
        .fn<(userId: string) => Promise<User>>()
        .mockResolvedValue(makeUser()),
    };
    configService = makeConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ── getGoogleUserInfo ──────────────────────────────────────────────────────

  describe('getGoogleUserInfo()', () => {
    it('returns userinfo data on a valid token', async () => {
      const googleInfo = {
        data: {
          email: 'jane@example.com',
          name: 'Jane',
          profilePicture: 'pic.png',
        },
      };
      getTokenInfoMock.mockResolvedValueOnce({ azp: 'client-id' });
      axiosGetMock.mockResolvedValueOnce(googleInfo);

      const result = await service.getGoogleUserInfo('tok');

      expect(result).toEqual(googleInfo.data);
    });

    it('throws when the token audience does not match the configured client id', async () => {
      getTokenInfoMock.mockResolvedValueOnce({ azp: 'someone-elses-client' });

      await expect(service.getGoogleUserInfo('tok')).rejects.toThrow(
        'Invalid Google Token',
      );
    });

    it('throws when the userinfo request fails', async () => {
      getTokenInfoMock.mockResolvedValueOnce({ azp: 'client-id' });
      axiosGetMock.mockRejectedValueOnce(new Error('network error'));

      await expect(service.getGoogleUserInfo('tok')).rejects.toThrow(
        'Invalid Google Token',
      );
    });
  });

  // ── generateTokens ───────────────────────────────────────────────────────

  describe('generateTokens()', () => {
    it('signs and returns an access + refresh token pair', () => {
      jwtSignMock
        .mockReturnValueOnce('access-tok')
        .mockReturnValueOnce('refresh-tok');

      const result = service.generateTokens(userId);

      expect(result).toEqual({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
      });
      expect(jwtSignMock).toHaveBeenNthCalledWith(
        1,
        { userId },
        'access-secret',
        expect.objectContaining({ expiresIn: '15m' }),
      );
      expect(jwtSignMock).toHaveBeenNthCalledWith(
        2,
        { userId },
        'refresh-secret',
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });

    it('uses configured expirations when provided', () => {
      configService.get.mockImplementation((key: string) => {
        const map: Record<string, string> = {
          ...CONFIG_MAP,
          JWT_EXP: '30m',
          JWT_REFRESH_EXP: '14d',
        };
        return map[key];
      });
      jwtSignMock.mockReturnValue('tok');

      service.generateTokens(userId);

      expect(jwtSignMock).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ expiresIn: '30m' }),
      );
      expect(jwtSignMock).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ expiresIn: '14d' }),
      );
    });

    it('throws when JWT secrets are not configured', () => {
      configService.get.mockReturnValue(undefined);

      expect(() => service.generateTokens(userId)).toThrow(
        'FATAL: JWT_SECRET and JWT_REFRESH_SECRET environment variables must be set',
      );
    });
  });

  // ── setTokens ────────────────────────────────────────────────────────────

  describe('setTokens()', () => {
    it('appends the new refresh token to an existing list and saves', async () => {
      jwtSignMock
        .mockReturnValueOnce('access-tok')
        .mockReturnValueOnce('refresh-tok');
      const user = makeUser({ refreshTokens: ['old-tok'] });
      userRepo.save.mockResolvedValueOnce(user);

      const result = await service.setTokens(user);

      expect(user.refreshTokens).toEqual(['old-tok', 'refresh-tok']);
      expect(userRepo.save).toHaveBeenCalledWith(user);
      expect(result).toEqual({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
      });
    });

    it('initializes refreshTokens when missing', async () => {
      jwtSignMock
        .mockReturnValueOnce('access-tok')
        .mockReturnValueOnce('refresh-tok');
      const user = makeUser({ refreshTokens: undefined });

      await service.setTokens(user);

      expect(user.refreshTokens).toEqual(['refresh-tok']);
    });
  });

  // ── sendAuthResponse ─────────────────────────────────────────────────────

  describe('sendAuthResponse()', () => {
    it('sets a non-secure cookie outside production and returns the auth payload', () => {
      const { res, cookie } = mockResponse();
      const user = new UserDto(makeUser());

      const result = service.sendAuthResponse(
        res,
        user,
        'access-tok',
        'refresh-tok',
      );

      expect(cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh-tok',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          secure: false,
        }),
      );
      expect(result).toEqual({ accessToken: 'access-tok', isAuth: true, user });
    });

    it('sets a secure cookie in production', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'production' : CONFIG_MAP[key],
      );
      const { res, cookie } = mockResponse();

      service.sendAuthResponse(res, new UserDto(makeUser()), 'a', 'r');

      expect(cookie).toHaveBeenCalledWith(
        'refreshToken',
        'r',
        expect.objectContaining({ secure: true }),
      );
    });
  });

  // ── googleLogin ──────────────────────────────────────────────────────────

  describe('googleLogin()', () => {
    it('throws BadRequestException when the token is missing', async () => {
      const req = mockRequest({});
      const { res } = mockResponse();

      await expect(service.googleLogin(req, res)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reuses an existing user found by email without generating a telegram token', async () => {
      jest.spyOn(service, 'getGoogleUserInfo').mockResolvedValueOnce({
        email: 'jane@example.com',
        name: 'Jane',
        profilePicture: 'p',
      });
      const existing = makeUser();
      userRepo.findOneBy.mockResolvedValueOnce(existing);
      userRepo.save.mockResolvedValueOnce(existing);
      jwtSignMock.mockReturnValue('tok');

      const req = mockRequest({ token: 'google-tok' });
      const { res } = mockResponse();

      await service.googleLogin(req, res);

      expect(userRepo.create).not.toHaveBeenCalled();
      expect(usersService.generateTelegramToken).not.toHaveBeenCalled();
    });

    it('creates a new user with a google-sso password and generates a telegram token', async () => {
      jest.spyOn(service, 'getGoogleUserInfo').mockResolvedValueOnce({
        email: 'new@example.com',
        name: 'New',
        profilePicture: 'p',
      });
      userRepo.findOneBy.mockResolvedValueOnce(null);
      userRepo.save.mockImplementation((u: User) => {
        u.id = 'new-id';
        return Promise.resolve(u);
      });
      jwtSignMock.mockReturnValue('tok');

      const req = mockRequest({ token: 'google-tok' });
      const { res } = mockResponse();

      await service.googleLogin(req, res);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          password: 'google-sso',
        }),
      );
      expect(usersService.generateTelegramToken).toHaveBeenCalledWith('new-id');
    });

    it('wraps any internal error as a generic BadRequestException', async () => {
      jest
        .spyOn(service, 'getGoogleUserInfo')
        .mockRejectedValueOnce(new Error('boom'));

      const req = mockRequest({ token: 'google-tok' });
      const { res } = mockResponse();

      await expect(service.googleLogin(req, res)).rejects.toThrow(
        'Internal server error during Google authentication',
      );
    });
  });

  // ── register ─────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('throws BadRequestException when email or password is missing', async () => {
      const req = mockRequest({ email: 'a@b.com' });
      const { res } = mockResponse();

      await expect(service.register(req, res)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('hashes the password, creates the user, and generates a telegram token', async () => {
      genSaltMock.mockResolvedValueOnce('salt');
      hashMock.mockResolvedValueOnce('hashed-pw');
      userRepo.save.mockImplementation((u: User) => {
        u.id = 'new-id';
        return Promise.resolve(u);
      });
      jwtSignMock.mockReturnValue('tok');

      const req = mockRequest({
        email: 'jane@example.com',
        password: 'plain-pw',
      });
      const { res } = mockResponse();

      await service.register(req, res);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'jane',
          email: 'jane@example.com',
          password: 'hashed-pw',
        }),
      );
      expect(usersService.generateTelegramToken).toHaveBeenCalledWith('new-id');
    });

    it('maps a unique-violation db error to "Email already exists"', async () => {
      genSaltMock.mockResolvedValueOnce('salt');
      hashMock.mockResolvedValueOnce('hashed-pw');
      userRepo.save.mockRejectedValueOnce({ code: '23505' });

      const req = mockRequest({
        email: 'jane@example.com',
        password: 'plain-pw',
      });
      const { res } = mockResponse();

      await expect(service.register(req, res)).rejects.toThrow(
        'Email already exists',
      );
    });

    it('propagates other db errors as their raw message', async () => {
      genSaltMock.mockResolvedValueOnce('salt');
      hashMock.mockResolvedValueOnce('hashed-pw');
      userRepo.save.mockRejectedValueOnce(new Error('db exploded'));

      const req = mockRequest({
        email: 'jane@example.com',
        password: 'plain-pw',
      });
      const { res } = mockResponse();

      await expect(service.register(req, res)).rejects.toThrow('db exploded');
    });
  });

  // ── login ────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('throws BadRequestException when email or password is missing', async () => {
      const req = mockRequest({ email: 'a@b.com' });
      const { res } = mockResponse();

      await expect(service.login(req, res)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws when no user is found for the email', async () => {
      userRepo.findOneBy.mockResolvedValueOnce(null);

      const req = mockRequest({ email: 'jane@example.com', password: 'pw' });
      const { res } = mockResponse();

      await expect(service.login(req, res)).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('throws when the password does not match', async () => {
      userRepo.findOneBy.mockResolvedValueOnce(makeUser());
      compareMock.mockResolvedValueOnce(false);

      const req = mockRequest({ email: 'jane@example.com', password: 'wrong' });
      const { res } = mockResponse();

      await expect(service.login(req, res)).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('returns an auth response on success', async () => {
      const user = makeUser();
      userRepo.findOneBy.mockResolvedValueOnce(user);
      compareMock.mockResolvedValueOnce(true);
      userRepo.save.mockResolvedValueOnce(user);
      jwtSignMock.mockReturnValue('tok');

      const req = mockRequest({
        email: 'jane@example.com',
        password: 'plain-pw',
      });
      const { res } = mockResponse();

      const result = await service.login(req, res);

      expect(result).toEqual(
        expect.objectContaining({ isAuth: true, accessToken: 'tok' }),
      );
    });
  });

  // ── logout ───────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('throws BadRequestException when the refresh cookie is missing', async () => {
      const req = mockRequest({}, {});
      const { res } = mockResponse();

      await expect(service.logout(req, res)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('wraps an invalid/expired refresh token as BadRequestException', async () => {
      jwtVerifyMock.mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });

      const req = mockRequest({}, { refreshToken: 'stale-tok' });
      const { res } = mockResponse();

      await expect(service.logout(req, res)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('throws when the refresh token is not on the user record', async () => {
      jwtVerifyMock.mockReturnValueOnce({ userId: userId });
      userRepo.findOneBy.mockResolvedValueOnce(
        makeUser({ refreshTokens: ['other-tok'] }),
      );

      const req = mockRequest({}, { refreshToken: 'unknown-tok' });
      const { res } = mockResponse();

      await expect(service.logout(req, res)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('removes the refresh token, saves, and clears the cookie on success', async () => {
      jwtVerifyMock.mockReturnValueOnce({ userId: userId });
      const user = makeUser({ refreshTokens: ['tok-a', 'tok-b'] });
      userRepo.findOneBy.mockResolvedValueOnce(user);
      userRepo.save.mockResolvedValueOnce(user);

      const req = mockRequest({}, { refreshToken: 'tok-a' });
      const { res, clearCookie } = mockResponse();

      const result = await service.logout(req, res);

      expect(user.refreshTokens).toEqual(['tok-b']);
      expect(clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.any(Object),
      );
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  // ── refresh ──────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('throws BadRequestException when the refresh cookie is missing', async () => {
      const req = mockRequest({}, {});
      const { res } = mockResponse();

      await expect(service.refresh(req, res)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('wraps an invalid refresh token as BadRequestException', async () => {
      jwtVerifyMock.mockImplementationOnce(() => {
        throw new Error('bad token');
      });

      const req = mockRequest({}, { refreshToken: 'stale-tok' });
      const { res } = mockResponse();

      await expect(service.refresh(req, res)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('throws when the refresh token is not on the user record', async () => {
      jwtVerifyMock.mockReturnValueOnce({ userId: userId });
      userRepo.findOneBy.mockResolvedValueOnce(
        makeUser({ refreshTokens: ['other-tok'] }),
      );

      const req = mockRequest({}, { refreshToken: 'unknown-tok' });
      const { res } = mockResponse();

      await expect(service.refresh(req, res)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('rotates the refresh token and returns new tokens on success', async () => {
      jwtVerifyMock.mockReturnValueOnce({ userId: userId });
      const user = makeUser({ refreshTokens: ['old-tok'] });
      userRepo.findOneBy.mockResolvedValueOnce(user);
      userRepo.save.mockResolvedValueOnce(user);
      jwtSignMock
        .mockReturnValueOnce('new-access-tok')
        .mockReturnValueOnce('new-refresh-tok');

      const req = mockRequest({}, { refreshToken: 'old-tok' });
      const { res } = mockResponse();

      const result = await service.refresh(req, res);

      expect(user.refreshTokens).toEqual(['new-refresh-tok']);
      expect(result).toEqual(
        expect.objectContaining({
          accessToken: 'new-access-tok',
          isAuth: true,
        }),
      );
    });
  });
});
