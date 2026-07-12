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
import { ConfigService } from '@nestjs/config';
import { GoogleCalendarService } from './google-calendar.service';
import { EnvironmentVariables } from '../config/environment-variables.type';

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly configService: ConfigService<EnvironmentVariables>,
  ) {}

  @Get('connect')
  connect(@Req() req: any): { url: string } {
    const userId = req.user?.userId;

    if (!userId) throw new UnauthorizedException();
    const url = this.googleCalendarService.generateAuthUrl(userId);

    return { url };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: any,
  ): Promise<void> {
    await this.googleCalendarService.handleCallback(code, state);
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    res.redirect(`${frontendUrl}/profile?calendar=connected`);
  }

  @Get('status')
  async status(
    @Req() req: any,
  ): Promise<{ connected: boolean; calendarSyncEnabled: boolean }> {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedException();

    return this.googleCalendarService.getStatus(userId);
  }

  @Patch('toggle')
  async toggle(@Req() req: any): Promise<{ calendarSyncEnabled: boolean }> {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedException();

    return this.googleCalendarService.toggleSync(userId);
  }

  @Delete('disconnect')
  async disconnect(@Req() req: any): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedException();
    await this.googleCalendarService.disconnect(userId);
  }
}
