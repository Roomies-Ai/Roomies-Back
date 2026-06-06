import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import * as jwt from 'jsonwebtoken';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { UsersService } from '../users/users.service';
import { GoogleCalendarService } from './google-calendar.service';

const JWT_SECRET = 'unit-test-secret';
const MOCK_USER_ID = 'user-uuid-123';

// Each OAuth2 client instance exposes the same underlying mock fns.
// We create them here so factories can close over them safely —
// jest.mock hoisting runs before module-level code, but factory
// functions are evaluated lazily when the module is first imported.
// Typed as `any` so mockResolvedValue / mockRejectedValue calls in tests
// don't conflict with googleapis' strict module types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const oauthMocks: any = {
  generateAuthUrl: jest.fn(),
  getToken: jest.fn(),
  refreshAccessToken: jest.fn(),
  revokeToken: jest.fn(),
  setCredentials: jest.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const calendarMocks: any = {
  eventsInsert: jest.fn(),
  eventsPatch: jest.fn(),
  eventsDelete: jest.fn(),
};

// jest.mock is hoisted above const declarations, so oauthMocks/calendarMocks are
// in the TDZ when the factory runs. We access them lazily:
//   - OAuth2 implementation: closure `() => oauthMocks` is called later (at new OAuth2() time)
//   - calendar events: ES5 getters defer property access to method-call time
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => oauthMocks),
    },
    calendar: jest.fn().mockReturnValue({
      events: {
        get insert() { return calendarMocks.eventsInsert; },
        get patch() { return calendarMocks.eventsPatch; },
        get delete() { return calendarMocks.eventsDelete; },
      },
    }),
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any));

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: MOCK_USER_ID,
    googleAccessToken: 'access-token',
    googleRefreshToken: 'refresh-token',
    googleTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarSyncEnabled: true,
    ...overrides,
  } as User);

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-uuid-456',
    title: 'Clean kitchen',
    description: 'Do the dishes',
    dueDate: new Date('2026-06-15T10:00:00Z'),
    assignee: { id: MOCK_USER_ID } as User,
    googleCalendarEventId: null,
    ...overrides,
  } as Task);

describe('GoogleCalendarService', () => {
  let service: GoogleCalendarService;
  let usersService: jest.Mocked<UsersService>;
  let taskRepo: { update: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Restore sensible defaults after clearAllMocks wipes implementations
    (oauthMocks.generateAuthUrl as any).mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock=1');
    (oauthMocks.revokeToken as any).mockResolvedValue({});
    (calendarMocks.eventsPatch as any).mockResolvedValue({ data: {} });
    (calendarMocks.eventsDelete as any).mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleCalendarService,
        {
          provide: UsersService,
          useValue: {
            findUserById: jest.fn(),
            saveGoogleCalendarTokens: jest.fn(),
            clearGoogleCalendarTokens: jest.fn(),
            setCalendarSyncEnabled: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Task),
          useValue: { update: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string> = {
                GOOGLE_CLIENT_ID: 'client-id',
                GOOGLE_CLIENT_SECRET: 'client-secret',
                GOOGLE_CALENDAR_REDIRECT_URI: 'http://localhost:3000/google-calendar/callback',
                JWT_SECRET,
                FRONTEND_URL: 'http://localhost:5173',
              };
              return map[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get(GoogleCalendarService);
    usersService = module.get(UsersService) as jest.Mocked<UsersService>;
    taskRepo = module.get(getRepositoryToken(Task));
  });

  // ─── generateAuthUrl ──────────────────────────────────────────────────────

  describe('generateAuthUrl', () => {
    it('returns a URL pointing to the Google authorization endpoint', () => {
      const url = service.generateAuthUrl(MOCK_USER_ID);
      expect(url).toContain('accounts.google.com');
    });

    it('requests the calendar.events scope with offline access', () => {
      service.generateAuthUrl(MOCK_USER_ID);
      expect(oauthMocks.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: 'offline',
          prompt: 'consent',
          scope: expect.arrayContaining(['https://www.googleapis.com/auth/calendar.events']),
        }),
      );
    });
  });

  // ─── handleCallback ───────────────────────────────────────────────────────

  describe('handleCallback', () => {
    const validState = () =>
      jwt.sign({ userId: MOCK_USER_ID, nonce: 'abc' }, JWT_SECRET, { expiresIn: '10m' });

    it('saves tokens when OAuth succeeds', async () => {
      oauthMocks.getToken.mockResolvedValue({
        tokens: { access_token: 'at', refresh_token: 'rt', expiry_date: 9_999_999_999_999 },
      });

      await service.handleCallback('auth-code', validState());

      expect(usersService.saveGoogleCalendarTokens).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.objectContaining({
          googleAccessToken: 'at',
          googleRefreshToken: 'rt',
          googleTokenExpiresAt: expect.any(Date),
        }),
      );
    });

    it('throws BadRequestException when state is signed with the wrong secret', async () => {
      const badState = jwt.sign({ userId: MOCK_USER_ID }, 'wrong-secret');
      await expect(service.handleCallback('code', badState)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when state JWT is expired', async () => {
      const expiredState = jwt.sign({ userId: MOCK_USER_ID, nonce: 'x' }, JWT_SECRET, {
        expiresIn: '1ms',
      });
      await new Promise((r) => setTimeout(r, 20));
      await expect(service.handleCallback('code', expiredState)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when Google returns no refresh_token', async () => {
      oauthMocks.getToken.mockResolvedValue({
        tokens: { access_token: 'at', expiry_date: 9999 },
      });
      await expect(service.handleCallback('code', validState())).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getStatus ────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns connected: false when user has no refresh token', async () => {
      usersService.findUserById.mockResolvedValue(
        makeUser({ googleRefreshToken: null, calendarSyncEnabled: false }),
      );
      expect(await service.getStatus(MOCK_USER_ID)).toEqual({
        connected: false,
        calendarSyncEnabled: false,
      });
    });

    it('returns connected: true when tokens are present', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ calendarSyncEnabled: true }));
      expect(await service.getStatus(MOCK_USER_ID)).toEqual({
        connected: true,
        calendarSyncEnabled: true,
      });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      usersService.findUserById.mockResolvedValue(null);
      await expect(service.getStatus(MOCK_USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── toggleSync ───────────────────────────────────────────────────────────

  describe('toggleSync', () => {
    it('throws BadRequestException when user is not connected', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ googleRefreshToken: null }));
      await expect(service.toggleSync(MOCK_USER_ID)).rejects.toThrow(BadRequestException);
    });

    it('flips calendarSyncEnabled from false to true', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ calendarSyncEnabled: false }));
      expect(await service.toggleSync(MOCK_USER_ID)).toEqual({ calendarSyncEnabled: true });
      expect(usersService.setCalendarSyncEnabled).toHaveBeenCalledWith(MOCK_USER_ID, true);
    });

    it('flips calendarSyncEnabled from true to false', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ calendarSyncEnabled: true }));
      expect(await service.toggleSync(MOCK_USER_ID)).toEqual({ calendarSyncEnabled: false });
      expect(usersService.setCalendarSyncEnabled).toHaveBeenCalledWith(MOCK_USER_ID, false);
    });
  });

  // ─── disconnect ───────────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('clears all calendar tokens', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      await service.disconnect(MOCK_USER_ID);
      expect(usersService.clearGoogleCalendarTokens).toHaveBeenCalledWith(MOCK_USER_ID);
    });

    it('still clears tokens even when token revocation fails', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      oauthMocks.revokeToken.mockRejectedValue(new Error('revoke failed'));
      await service.disconnect(MOCK_USER_ID);
      expect(usersService.clearGoogleCalendarTokens).toHaveBeenCalledWith(MOCK_USER_ID);
    });
  });

  // ─── createCalendarEvent ─────────────────────────────────────────────────

  describe('createCalendarEvent', () => {
    it('does nothing when task has no dueDate', async () => {
      await service.createCalendarEvent(makeTask({ dueDate: null }));
      expect(calendarMocks.eventsInsert).not.toHaveBeenCalled();
    });

    it('does nothing when task has no assignee', async () => {
      await service.createCalendarEvent(makeTask({ assignee: null as any }));
      expect(calendarMocks.eventsInsert).not.toHaveBeenCalled();
    });

    it('does nothing when calendarSyncEnabled is false', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ calendarSyncEnabled: false }));
      await service.createCalendarEvent(makeTask());
      expect(calendarMocks.eventsInsert).not.toHaveBeenCalled();
    });

    it('does nothing when user has no refresh token', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ googleRefreshToken: null }));
      await service.createCalendarEvent(makeTask());
      expect(calendarMocks.eventsInsert).not.toHaveBeenCalled();
    });

    it('creates the event and persists the event ID to the task', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      calendarMocks.eventsInsert.mockResolvedValue({ data: { id: 'ev123' } });

      await service.createCalendarEvent(makeTask());

      expect(calendarMocks.eventsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          requestBody: expect.objectContaining({ summary: 'Clean kitchen' }),
        }),
      );
      expect(taskRepo.update).toHaveBeenCalledWith('task-uuid-456', {
        googleCalendarEventId: 'ev123',
      });
    });

    it('swallows Google API errors without rethrowing', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      calendarMocks.eventsInsert.mockRejectedValue(new Error('Google API down'));
      await expect(service.createCalendarEvent(makeTask())).resolves.toBeUndefined();
    });
  });

  // ─── updateCalendarEvent ─────────────────────────────────────────────────

  describe('updateCalendarEvent', () => {
    it('falls back to createCalendarEvent when no eventId exists', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      calendarMocks.eventsInsert.mockResolvedValue({ data: { id: 'new-ev' } });

      await service.updateCalendarEvent(makeTask({ googleCalendarEventId: null }));

      expect(calendarMocks.eventsInsert).toHaveBeenCalled();
      expect(calendarMocks.eventsPatch).not.toHaveBeenCalled();
    });

    it('patches an existing calendar event', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());

      await service.updateCalendarEvent(makeTask({ googleCalendarEventId: 'ev-existing' }));

      expect(calendarMocks.eventsPatch).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'ev-existing' }),
      );
    });
  });

  // ─── deleteCalendarEvent ─────────────────────────────────────────────────

  describe('deleteCalendarEvent', () => {
    it('does nothing when task has no googleCalendarEventId', async () => {
      await service.deleteCalendarEvent(makeTask({ googleCalendarEventId: null }));
      expect(calendarMocks.eventsDelete).not.toHaveBeenCalled();
    });

    it('deletes the calendar event by eventId', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());

      await service.deleteCalendarEvent(makeTask({ googleCalendarEventId: 'ev-to-delete' }));

      expect(calendarMocks.eventsDelete).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'ev-to-delete' }),
      );
    });
  });

  // ─── token refresh ────────────────────────────────────────────────────────

  describe('token refresh', () => {
    it('refreshes the access token when it is about to expire', async () => {
      usersService.findUserById.mockResolvedValue(
        makeUser({ googleTokenExpiresAt: new Date(Date.now() + 30_000) }),
      );
      oauthMocks.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-at',
          refresh_token: 'refresh-token',
          expiry_date: Date.now() + 3_600_000,
        },
      });
      calendarMocks.eventsInsert.mockResolvedValue({ data: { id: 'ev-refreshed' } });

      await service.createCalendarEvent(makeTask());

      expect(oauthMocks.refreshAccessToken).toHaveBeenCalled();
      expect(usersService.saveGoogleCalendarTokens).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.objectContaining({ googleAccessToken: 'new-at' }),
      );
    });

    it('does not refresh when token is still valid', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      calendarMocks.eventsInsert.mockResolvedValue({ data: { id: 'ev-ok' } });

      await service.createCalendarEvent(makeTask());

      expect(oauthMocks.refreshAccessToken).not.toHaveBeenCalled();
    });
  });
});
