import {
  Controller,
  Delete,
  Get,
  Patch,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { GoogleCalendarService } from './google-calendar.service';

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly configService: ConfigService,
  ) {}

  @Get('connect')
  connect(@Req() req: Request): { url: string } {
    const userId = (req as any).user?.userId;
    if (!userId) throw new UnauthorizedException();
    const url = this.googleCalendarService.generateAuthUrl(userId);
    return { url };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.googleCalendarService.handleCallback(code, state);
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?calendar=connected`);
  }

  @Get('status')
  async status(@Req() req: Request): Promise<{ connected: boolean; calendarSyncEnabled: boolean }> {
    const userId = (req as any).user?.userId;
    if (!userId) throw new UnauthorizedException();
    return this.googleCalendarService.getStatus(userId);
  }

  @Patch('toggle')
  async toggle(@Req() req: Request): Promise<{ calendarSyncEnabled: boolean }> {
    const userId = (req as any).user?.userId;
    if (!userId) throw new UnauthorizedException();
    return this.googleCalendarService.toggleSync(userId);
  }

  @Delete('disconnect')
  async disconnect(@Req() req: Request): Promise<void> {
    const userId = (req as any).user?.userId;
    if (!userId) throw new UnauthorizedException();
    await this.googleCalendarService.disconnect(userId);
  }
}
