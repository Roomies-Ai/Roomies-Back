import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { google, Auth, calendar_v3 } from 'googleapis';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { Task } from '../models/task.entity';
import { User } from '../models/user.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
    private readonly configService: ConfigService,
  ) {}

  private createOAuth2Client(): Auth.OAuth2Client {
    return new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_CALENDAR_REDIRECT_URI'),
    );
  }

  generateAuthUrl(userId: string): string {
    const nonce = randomBytes(16).toString('hex');
    const state = jwt.sign(
      { userId, nonce },
      this.configService.get<string>('JWT_SECRET')!,
      { expiresIn: '10m' },
    );

    const oauth2Client = this.createOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
    });
  }

  async handleCallback(code: string, state: string): Promise<void> {
    let userId: string;
    try {
      const payload = jwt.verify(
        state,
        this.configService.get<string>('JWT_SECRET')!,
      ) as { userId: string };
      userId = payload.userId;
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    const oauth2Client = this.createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'No refresh token received. Please disconnect and reconnect your Google account.',
      );
    }

    await this.usersService.saveGoogleCalendarTokens(userId, {
      googleAccessToken: tokens.access_token!,
      googleRefreshToken: tokens.refresh_token,
      googleTokenExpiresAt: new Date(tokens.expiry_date!),
    });
  }

  async getStatus(
    userId: string,
  ): Promise<{ connected: boolean; calendarSyncEnabled: boolean }> {
    const user = await this.usersService.findUserById(userId);
    if (!user) throw new NotFoundException(`User #${userId} not found`);
    return {
      connected: !!user.googleRefreshToken,
      calendarSyncEnabled: user.calendarSyncEnabled,
    };
  }

  async toggleSync(userId: string): Promise<{ calendarSyncEnabled: boolean }> {
    const user = await this.usersService.findUserById(userId);
    if (!user) throw new NotFoundException(`User #${userId} not found`);
    if (!user.googleRefreshToken) {
      throw new BadRequestException('Not connected to Google Calendar');
    }
    const next = !user.calendarSyncEnabled;
    await this.usersService.setCalendarSyncEnabled(userId, next);

    return { calendarSyncEnabled: next };
  }

  async disconnect(userId: string): Promise<void> {
    const user = await this.usersService.findUserById(userId);
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    if (user.googleAccessToken) {
      try {
        const oauth2Client = this.createOAuth2Client();
        oauth2Client.setCredentials({ access_token: user.googleAccessToken });
        await oauth2Client.revokeToken(user.googleAccessToken);
      } catch {
        // Best-effort revocation — do not block disconnect
      }
    }

    await this.usersService.clearGoogleCalendarTokens(userId);
  }

  async createCalendarEvent(task: Task): Promise<void> {
    try {
      if (!task.assignee?.id || !task.dueDate) return;

      const assignee = await this.usersService.findUserById(task.assignee.id);
      if (!assignee?.calendarSyncEnabled || !assignee.googleRefreshToken)
        return;

      const auth = await this.getValidOAuth2Client(assignee);
      const calendarClient = google.calendar({ version: 'v3', auth });

      const endTime = new Date(task.dueDate);
      endTime.setHours(endTime.getHours() + 1);

      const response = await calendarClient.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: task.title,
          description: task.description || '',
          start: { dateTime: new Date(task.dueDate).toISOString() },
          end: { dateTime: endTime.toISOString() },
        },
      });

      if (response.data.id) {
        await this.taskRepo.update(task.id, {
          googleCalendarEventId: response.data.id,
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to create calendar event for task ${task.id}`,
        JSON.stringify(err),
      );
    }
  }

  async updateCalendarEvent(task: Task): Promise<void> {
    try {
      if (!task.assignee?.id || !task.dueDate) return;

      if (!task.googleCalendarEventId) {
        await this.createCalendarEvent(task);

        return;
      }

      const assignee = await this.usersService.findUserById(task.assignee.id);
      if (!assignee?.calendarSyncEnabled || !assignee.googleRefreshToken)
        return;

      const auth = await this.getValidOAuth2Client(assignee);
      const calendarClient = google.calendar({ version: 'v3', auth });

      const endTime = new Date(task.dueDate);
      endTime.setHours(endTime.getHours() + 1);

      await calendarClient.events.patch({
        calendarId: 'primary',
        eventId: task.googleCalendarEventId,
        requestBody: {
          summary: task.title,
          description: task.description || '',
          start: { dateTime: task.dueDate.toISOString() },
          end: { dateTime: endTime.toISOString() },
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to update calendar event for task ${task.id}`,
        err,
      );
    }
  }

  async deleteCalendarEvent(task: Task): Promise<void> {
    try {
      if (!task.googleCalendarEventId || !task.assignee?.id) return;

      const assignee = await this.usersService.findUserById(task.assignee.id);
      if (!assignee?.googleRefreshToken) return;

      const auth = await this.getValidOAuth2Client(assignee);
      const calendarClient = google.calendar({ version: 'v3', auth });

      await calendarClient.events.delete({
        calendarId: 'primary',
        eventId: task.googleCalendarEventId,
      });
    } catch (err) {
      this.logger.error(
        `Failed to delete calendar event for task ${task.id}`,
        err,
      );
    }
  }

  private async getValidOAuth2Client(user: User): Promise<Auth.OAuth2Client> {
    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
      refresh_token: user.googleRefreshToken,
      expiry_date: user.googleTokenExpiresAt?.getTime(),
    });

    const expiryDate = user.googleTokenExpiresAt?.getTime() ?? 0;
    const isExpiringSoon = expiryDate - Date.now() < 60_000;

    if (isExpiringSoon) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await this.usersService.saveGoogleCalendarTokens(user.id, {
        googleAccessToken: credentials.access_token!,
        googleRefreshToken:
          credentials.refresh_token ?? user.googleRefreshToken!,
        googleTokenExpiresAt: new Date(credentials.expiry_date!),
      });
      oauth2Client.setCredentials(credentials);
    }

    return oauth2Client;
  }
}
