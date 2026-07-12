import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../models/user.entity';
import { UserDto } from '../dtos/user.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
jest.mock('bcryptjs', () => ({
  genSalt: jest.fn(),
  hash: jest.fn(),
  compare: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}));
jest.mock('axios', () => ({
  get: jest.fn(),
}));

const getTokenInfoMock = jest.fn();
jest.mock('google-auth-library', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OAuth2Client: jest.fn().mockImplementation(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getTokenInfo: (...args: any[]) => getTokenInfoMock(...args),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import bcrypt from 'bcryptjs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import jwt from 'jsonwebtoken';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import axios from 'axios';

const CONFIG_MAP: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'client-id',
  JWT_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  NODE_ENV: 'test',
};

const makeConfigService = (overrides: Record<string, string | undefined> = {}) => ({
  get: jest.fn((key: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
    return CONFIG_MAP[key];
  }),
});

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-uuid',
    username: 'jane',
    email: 'jane@example.com',
    password: 'hashed-pw',
    refreshTokens: [],
    ...overrides,
  }) as User;

const mockUserRepo = () => ({
  findOneBy: jest.fn(),
  create: jest
    .fn()
    .mockImplementation((data: Partial<User>) => ({ ...data }) as User),
  save: jest.fn(),
});

const mockRequest = (body: Record<string, unknown> = {}, cookies: Record<string, string> = {}) =>
  ({ body, cookies }) as unknown as Request;

const mockResponse = () =>
  ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  }) as unknown as { cookie: jest.Mock; clearCookie: jest.Mock };

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let usersService: { generateTelegramToken: jest.Mock };
  let configService: ReturnType<typeof makeConfigService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    userRepo = mockUserRepo();
    usersService = { generateTelegramToken: jest.fn().mockResolvedValue(undefined) };
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
      getTokenInfoMock.mockResolvedValueOnce({ azp: 'client-id' });
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: { email: 'jane@example.com', name: 'Jane', profilePicture: 'pic.png' },
      });

      const result = await service.getGoogleUserInfo('tok');

      expect(result).toEqual({
        email: 'jane@example.com',
        name: 'Jane',
        profilePicture: 'pic.png',
      });
    });

    it('throws when the token audience does not match the configured client id', async () => {
      getTokenInfoMock.mockResolvedValueOnce({ azp: 'someone-elses-client' });

      await expect(service.getGoogleUserInfo('tok')).rejects.toThrow(
        'Invalid Google Token',
      );
    });

    it('throws when the userinfo request fails', async () => {
      getTokenInfoMock.mockResolvedValueOnce({ azp: 'client-id' });
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('network error'));

      await expect(service.getGoogleUserInfo('tok')).rejects.toThrow(
        'Invalid Google Token',
      );
    });
  });

  // ── generateTokens ───────────────────────────────────────────────────────

  describe('generateTokens()', () => {
    it('signs and returns an access + refresh token pair', () => {
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce('access-tok')
        .mockReturnValueOnce('refresh-tok');

      const result = service.generateTokens('user-uuid');

      expect(result).toEqual({ accessToken: 'access-tok', refreshToken: 'refresh-tok' });
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        { userId: 'user-uuid' },
        'access-secret',
        expect.objectContaining({ expiresIn: '15m' }),
      );
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        { userId: 'user-uuid' },
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
      (jwt.sign as jest.Mock).mockReturnValue('tok');

      service.generateTokens('user-uuid');

      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ expiresIn: '30m' }),
      );
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ expiresIn: '14d' }),
      );
    });

    it('throws when JWT secrets are not configured', () => {
      configService.get.mockReturnValue(undefined);

      expect(() => service.generateTokens('user-uuid')).toThrow(
        'FATAL: JWT_SECRET and JWT_REFRESH_SECRET environment variables must be set',
      );
    });
  });

  // ── setTokens ────────────────────────────────────────────────────────────

  describe('setTokens()', () => {
    it('appends the new refresh token to an existing list and saves', async () => {
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce('access-tok')
        .mockReturnValueOnce('refresh-tok');
      const user = makeUser({ refreshTokens: ['old-tok'] });
      userRepo.save.mockResolvedValueOnce(user);

      const result = await service.setTokens(user);

      expect(user.refreshTokens).toEqual(['old-tok', 'refresh-tok']);
      expect(userRepo.save).toHaveBeenCalledWith(user);
      expect(result).toEqual({ accessToken: 'access-tok', refreshToken: 'refresh-tok' });
    });

    it('initializes refreshTokens when missing', async () => {
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce('access-tok')
        .mockReturnValueOnce('refresh-tok');
      const user = makeUser({ refreshTokens: undefined as unknown as string[] });
      userRepo.save.mockResolvedValueOnce(user);

      await service.setTokens(user);

      expect(user.refreshTokens).toEqual(['refresh-tok']);
    });
  });

  // ── sendAuthResponse ─────────────────────────────────────────────────────

  describe('sendAuthResponse()', () => {
    it('sets a non-secure cookie outside production and returns the auth payload', () => {
      const res = mockResponse();
      const user = new UserDto(makeUser());

      const result = service.sendAuthResponse(
        res as any,
        user,
        'access-tok',
        'refresh-tok',
      );

      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh-tok',
        expect.objectContaining({ httpOnly: true, sameSite: 'strict', secure: false }),
      );
      expect(result).toEqual({ accessToken: 'access-tok', isAuth: true, user });
    });

    it('sets a secure cookie in production', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'production' : CONFIG_MAP[key],
      );
      const res = mockResponse();

      service.sendAuthResponse(res as any, new UserDto(makeUser()), 'a', 'r');

      expect(res.cookie).toHaveBeenCalledWith(
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
      const res = mockResponse();

      await expect(service.googleLogin(req as any, res as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reuses an existing user found by email without generating a telegram token', async () => {
      jest
        .spyOn(service, 'getGoogleUserInfo')
        .mockResolvedValueOnce({ email: 'jane@example.com', name: 'Jane', profilePicture: 'p' } as any);
      const existing = makeUser();
      userRepo.findOneBy.mockResolvedValueOnce(existing);
      userRepo.save.mockResolvedValueOnce(existing);
      (jwt.sign as jest.Mock).mockReturnValue('tok');

      const req = mockRequest({ token: 'google-tok' });
      const res = mockResponse();

      await service.googleLogin(req as any, res as any);

      expect(userRepo.create).not.toHaveBeenCalled();
      expect(usersService.generateTelegramToken).not.toHaveBeenCalled();
    });

    it('creates a new user with a google-sso password and generates a telegram token', async () => {
      jest
        .spyOn(service, 'getGoogleUserInfo')
        .mockResolvedValueOnce({ email: 'new@example.com', name: 'New', profilePicture: 'p' } as any);
      userRepo.findOneBy.mockResolvedValueOnce(null);
      userRepo.save.mockImplementation((u: Partial<User>) => {
        (u as User).id = 'new-id';
        return Promise.resolve(u as User);
      });
      (jwt.sign as jest.Mock).mockReturnValue('tok');

      const req = mockRequest({ token: 'google-tok' });
      const res = mockResponse();

      await service.googleLogin(req as any, res as any);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com', password: 'google-sso' }),
      );
      expect(usersService.generateTelegramToken).toHaveBeenCalledWith('new-id');
    });

    it('wraps any internal error as a generic BadRequestException', async () => {
      jest.spyOn(service, 'getGoogleUserInfo').mockRejectedValueOnce(new Error('boom'));

      const req = mockRequest({ token: 'google-tok' });
      const res = mockResponse();

      await expect(service.googleLogin(req as any, res as any)).rejects.toThrow(
        'Internal server error during Google authentication',
      );
    });
  });

  // ── register ─────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('throws BadRequestException when email or password is missing', async () => {
      const req = mockRequest({ email: 'a@b.com' });
      const res = mockResponse();

      await expect(service.register(req as any, res as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('hashes the password, creates the user, and generates a telegram token', async () => {
      (bcrypt.genSalt as jest.Mock).mockResolvedValueOnce('salt');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-pw');
      userRepo.save.mockImplementation((u: Partial<User>) => {
        (u as User).id = 'new-id';
        return Promise.resolve(u as User);
      });
      (jwt.sign as jest.Mock).mockReturnValue('tok');

      const req = mockRequest({ email: 'jane@example.com', password: 'plain-pw' });
      const res = mockResponse();

      await service.register(req as any, res as any);

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
      (bcrypt.genSalt as jest.Mock).mockResolvedValueOnce('salt');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-pw');
      userRepo.save.mockRejectedValueOnce({ code: '23505' });

      const req = mockRequest({ email: 'jane@example.com', password: 'plain-pw' });
      const res = mockResponse();

      await expect(service.register(req as any, res as any)).rejects.toThrow(
        'Email already exists',
      );
    });

    it('propagates other db errors as their raw message', async () => {
      (bcrypt.genSalt as jest.Mock).mockResolvedValueOnce('salt');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-pw');
      userRepo.save.mockRejectedValueOnce(new Error('db exploded'));

      const req = mockRequest({ email: 'jane@example.com', password: 'plain-pw' });
      const res = mockResponse();

      await expect(service.register(req as any, res as any)).rejects.toThrow(
        'db exploded',
      );
    });
  });

  // ── login ────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('throws BadRequestException when email or password is missing', async () => {
      const req = mockRequest({ email: 'a@b.com' });
      const res = mockResponse();

      await expect(service.login(req as any, res as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws when no user is found for the email', async () => {
      userRepo.findOneBy.mockResolvedValueOnce(null);

      const req = mockRequest({ email: 'jane@example.com', password: 'pw' });
      const res = mockResponse();

      await expect(service.login(req as any, res as any)).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('throws when the password does not match', async () => {
      userRepo.findOneBy.mockResolvedValueOnce(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const req = mockRequest({ email: 'jane@example.com', password: 'wrong' });
      const res = mockResponse();

      await expect(service.login(req as any, res as any)).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('returns an auth response on success', async () => {
      const user = makeUser();
      userRepo.findOneBy.mockResolvedValueOnce(user);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      userRepo.save.mockResolvedValueOnce(user);
      (jwt.sign as jest.Mock).mockReturnValue('tok');

      const req = mockRequest({ email: 'jane@example.com', password: 'plain-pw' });
      const res = mockResponse();

      const result = await service.login(req as any, res as any);

      expect(result).toEqual(
        expect.objectContaining({ isAuth: true, accessToken: 'tok' }),
      );
    });
  });

  // ── logout ───────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('throws BadRequestException when the refresh cookie is missing', async () => {
      const req = mockRequest({}, {});
      const res = mockResponse();

      await expect(service.logout(req as any, res as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('wraps an invalid/expired refresh token as BadRequestException', async () => {
      (jwt.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });

      const req = mockRequest({}, { refreshToken: 'stale-tok' });
      const res = mockResponse();

      await expect(service.logout(req as any, res as any)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('throws when the refresh token is not on the user record', async () => {
      (jwt.verify as jest.Mock).mockReturnValueOnce({ userId: 'user-uuid' });
      userRepo.findOneBy.mockResolvedValueOnce(makeUser({ refreshTokens: ['other-tok'] }));

      const req = mockRequest({}, { refreshToken: 'unknown-tok' });
      const res = mockResponse();

      await expect(service.logout(req as any, res as any)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('removes the refresh token, saves, and clears the cookie on success', async () => {
      (jwt.verify as jest.Mock).mockReturnValueOnce({ userId: 'user-uuid' });
      const user = makeUser({ refreshTokens: ['tok-a', 'tok-b'] });
      userRepo.findOneBy.mockResolvedValueOnce(user);
      userRepo.save.mockResolvedValueOnce(user);

      const req = mockRequest({}, { refreshToken: 'tok-a' });
      const res = mockResponse();

      const result = await service.logout(req as any, res as any);

      expect(user.refreshTokens).toEqual(['tok-b']);
      expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', expect.any(Object));
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  // ── refresh ──────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('throws BadRequestException when the refresh cookie is missing', async () => {
      const req = mockRequest({}, {});
      const res = mockResponse();

      await expect(service.refresh(req as any, res as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('wraps an invalid refresh token as BadRequestException', async () => {
      (jwt.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error('bad token');
      });

      const req = mockRequest({}, { refreshToken: 'stale-tok' });
      const res = mockResponse();

      await expect(service.refresh(req as any, res as any)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('throws when the refresh token is not on the user record', async () => {
      (jwt.verify as jest.Mock).mockReturnValueOnce({ userId: 'user-uuid' });
      userRepo.findOneBy.mockResolvedValueOnce(makeUser({ refreshTokens: ['other-tok'] }));

      const req = mockRequest({}, { refreshToken: 'unknown-tok' });
      const res = mockResponse();

      await expect(service.refresh(req as any, res as any)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('rotates the refresh token and returns new tokens on success', async () => {
      (jwt.verify as jest.Mock).mockReturnValueOnce({ userId: 'user-uuid' });
      const user = makeUser({ refreshTokens: ['old-tok'] });
      userRepo.findOneBy.mockResolvedValueOnce(user);
      userRepo.save.mockResolvedValueOnce(user);
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce('new-access-tok')
        .mockReturnValueOnce('new-refresh-tok');

      const req = mockRequest({}, { refreshToken: 'old-tok' });
      const res = mockResponse();

      const result = await service.refresh(req as any, res as any);

      expect(user.refreshTokens).toEqual(['new-refresh-tok']);
      expect(result).toEqual(
        expect.objectContaining({ accessToken: 'new-access-tok', isAuth: true }),
      );
    });
  });
});
