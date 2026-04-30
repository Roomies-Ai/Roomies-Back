import { Controller, Get, Req, Query, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('fairness')
  getFairness(@Req() req: any, @Query('householdId') householdId: string) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    if (!householdId) {
      throw new BadRequestException('householdId query parameter is required');
    }
    return this.statsService.getFairnessStats(userId, householdId);
  }

  @Get('pulse')
  getPulse(@Req() req: any, @Query('householdId') householdId: string) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    if (!householdId) {
      throw new BadRequestException('householdId query parameter is required');
    }
    return this.statsService.getPulseStats(userId, householdId);
  }
}
