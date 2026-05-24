import { Controller, Get, Post, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('my')
  getMyNotifications(@Request() req: any) {
    const userId = req.user?.id || req.user?.userId;
    return this.notificationsService.getMyNotifications(userId);
  }

  @Post('test-reminder')
  testReminder() {
    return this.notificationsService.sendDailyTelegramReminders();
  }
}
