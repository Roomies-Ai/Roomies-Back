import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { UsersService } from '../users/users.service';
import { GoogleCalendarService } from './google-calendar.service';

const JWT_SECRET = 'unit-test-secret';
const MOCK_USER_ID = 'user-uuid-123';

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

// Mock googleapis
const mockEventsInsert = jest.fn();
const mockEventsPatch = jest.fn();
const mockEventsDelete = jest.fn();
const mockGetToken = jest.fn();
const mockRefreshAccessToken = jest.fn();
const mockRevokeToken = jest.fn();
const mockGenerateAuthUrl = jest.fn();
const mockSetCredentials = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: mockGenerateAuthUrl,
        getToken: mockGetToken,
        refreshAccessToken: mockRefreshAccessToken,
        revokeToken: mockRevokeToken,
        setCredentials: mockSetCredentials,
      })),
    },
    calendar: jest.fn().mockReturnValue({
      events: {
        insert: mockEventsInsert,
        patch: mockEventsPatch,
        delete: mockEventsDelete,
      },
    }),
  },
}));

describe('GoogleCalendarService', () => {
  let service: GoogleCalendarService;
  let usersService: jest.Mocked<UsersService>;
  let taskRepo: { update: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

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
    it('returns a URL with the Google authorization endpoint', () => {
      mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?foo=bar');
      const url = service.generateAuthUrl(MOCK_USER_ID);
      expect(url).toContain('accounts.google.com');
    });

    it('passes the calendar.events scope and offline access type', () => {
      mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth');
      service.generateAuthUrl(MOCK_USER_ID);
      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
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

    it('saves tokens and enables calendar sync on success', async () => {
      const state = validState();
      mockGetToken.mockResolvedValue({
        tokens: {
          access_token: 'at',
          refresh_token: 'rt',
          expiry_date: 9999999999999,
        },
      });

      await service.handleCallback('auth-code', state);

      expect(usersService.saveGoogleCalendarTokens).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.objectContaining({
          googleAccessToken: 'at',
          googleRefreshToken: 'rt',
          googleTokenExpiresAt: expect.any(Date),
        }),
      );
    });

    it('throws BadRequestException when state is tampered', async () => {
      const badState = jwt.sign({ userId: MOCK_USER_ID }, 'wrong-secret');
      await expect(service.handleCallback('code', badState)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when state is expired', async () => {
      const expiredState = jwt.sign({ userId: MOCK_USER_ID, nonce: 'x' }, JWT_SECRET, {
        expiresIn: '1ms',
      });
      await new Promise((r) => setTimeout(r, 10));
      await expect(service.handleCallback('code', expiredState)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when no refresh_token is returned', async () => {
      const state = validState();
      mockGetToken.mockResolvedValue({
        tokens: { access_token: 'at', expiry_date: 9999 },
      });
      await expect(service.handleCallback('code', state)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getStatus ────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns connected: false when no refresh token exists', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ googleRefreshToken: null }));
      const status = await service.getStatus(MOCK_USER_ID);
      expect(status).toEqual({ connected: false, calendarSyncEnabled: false });
    });

    it('returns connected: true and calendarSyncEnabled: true when tokens exist and sync is on', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ calendarSyncEnabled: true }));
      const status = await service.getStatus(MOCK_USER_ID);
      expect(status).toEqual({ connected: true, calendarSyncEnabled: true });
    });

    it('throws NotFoundException when user does not exist', async () => {
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
      const result = await service.toggleSync(MOCK_USER_ID);
      expect(result).toEqual({ calendarSyncEnabled: true });
      expect(usersService.setCalendarSyncEnabled).toHaveBeenCalledWith(MOCK_USER_ID, true);
    });

    it('flips calendarSyncEnabled from true to false', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ calendarSyncEnabled: true }));
      const result = await service.toggleSync(MOCK_USER_ID);
      expect(result).toEqual({ calendarSyncEnabled: false });
      expect(usersService.setCalendarSyncEnabled).toHaveBeenCalledWith(MOCK_USER_ID, false);
    });
  });

  // ─── disconnect ───────────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('clears all calendar tokens', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      mockRevokeToken.mockResolvedValue({});
      await service.disconnect(MOCK_USER_ID);
      expect(usersService.clearGoogleCalendarTokens).toHaveBeenCalledWith(MOCK_USER_ID);
    });

    it('still clears tokens even if token revocation fails', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      mockRevokeToken.mockRejectedValue(new Error('revoke failed'));
      await service.disconnect(MOCK_USER_ID);
      expect(usersService.clearGoogleCalendarTokens).toHaveBeenCalledWith(MOCK_USER_ID);
    });
  });

  // ─── createCalendarEvent ─────────────────────────────────────────────────

  describe('createCalendarEvent', () => {
    it('does nothing when task has no dueDate', async () => {
      await service.createCalendarEvent(makeTask({ dueDate: null }));
      expect(mockEventsInsert).not.toHaveBeenCalled();
    });

    it('does nothing when task has no assignee', async () => {
      await service.createCalendarEvent(makeTask({ assignee: null as any }));
      expect(mockEventsInsert).not.toHaveBeenCalled();
    });

    it('does nothing when calendarSyncEnabled is false', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ calendarSyncEnabled: false }));
      await service.createCalendarEvent(makeTask());
      expect(mockEventsInsert).not.toHaveBeenCalled();
    });

    it('does nothing when user has no refresh token', async () => {
      usersService.findUserById.mockResolvedValue(makeUser({ googleRefreshToken: null }));
      await service.createCalendarEvent(makeTask());
      expect(mockEventsInsert).not.toHaveBeenCalled();
    });

    it('creates the calendar event and persists the event ID', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      mockEventsInsert.mockResolvedValue({ data: { id: 'ev123' } });

      await service.createCalendarEvent(makeTask());

      expect(mockEventsInsert).toHaveBeenCalledWith(
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
      mockEventsInsert.mockRejectedValue(new Error('Google API down'));
      await expect(service.createCalendarEvent(makeTask())).resolves.toBeUndefined();
    });
  });

  // ─── updateCalendarEvent ─────────────────────────────────────────────────

  describe('updateCalendarEvent', () => {
    it('falls back to createCalendarEvent when no eventId exists', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      mockEventsInsert.mockResolvedValue({ data: { id: 'new-ev' } });

      await service.updateCalendarEvent(makeTask({ googleCalendarEventId: null }));

      expect(mockEventsInsert).toHaveBeenCalled();
      expect(mockEventsPatch).not.toHaveBeenCalled();
    });

    it('patches an existing event', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      mockEventsPatch.mockResolvedValue({ data: {} });

      await service.updateCalendarEvent(makeTask({ googleCalendarEventId: 'ev-existing' }));

      expect(mockEventsPatch).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'ev-existing' }),
      );
    });
  });

  // ─── deleteCalendarEvent ─────────────────────────────────────────────────

  describe('deleteCalendarEvent', () => {
    it('does nothing when task has no googleCalendarEventId', async () => {
      await service.deleteCalendarEvent(makeTask({ googleCalendarEventId: null }));
      expect(mockEventsDelete).not.toHaveBeenCalled();
    });

    it('deletes the calendar event', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      mockEventsDelete.mockResolvedValue({});

      await service.deleteCalendarEvent(makeTask({ googleCalendarEventId: 'ev-to-delete' }));

      expect(mockEventsDelete).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'ev-to-delete' }),
      );
    });
  });

  // ─── token refresh (getValidOAuth2Client) ─────────────────────────────────

  describe('token refresh', () => {
    it('refreshes the access token when it is about to expire', async () => {
      const nearlyExpiredUser = makeUser({
        googleTokenExpiresAt: new Date(Date.now() + 30_000),
      });
      usersService.findUserById.mockResolvedValue(nearlyExpiredUser);
      mockRefreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-at',
          refresh_token: 'refresh-token',
          expiry_date: Date.now() + 3_600_000,
        },
      });
      mockEventsInsert.mockResolvedValue({ data: { id: 'ev-new' } });

      await service.createCalendarEvent(makeTask());

      expect(mockRefreshAccessToken).toHaveBeenCalled();
      expect(usersService.saveGoogleCalendarTokens).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.objectContaining({ googleAccessToken: 'new-at' }),
      );
    });

    it('does not refresh when token is still valid', async () => {
      usersService.findUserById.mockResolvedValue(makeUser());
      mockEventsInsert.mockResolvedValue({ data: { id: 'ev-ok' } });

      await service.createCalendarEvent(makeTask());

      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });
  });
});
