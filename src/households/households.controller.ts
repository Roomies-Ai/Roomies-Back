import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UnauthorizedException, Query } from '@nestjs/common';
import { HouseholdsService } from './households.service';
import { Household } from '../models/household.entity';
import { Pet } from '../models/pet.entity';

@Controller('households')
export class HouseholdsController {
  constructor(private readonly householdsService: HouseholdsService) { }

  @Get('me')
  findMyHouseholds(@Req() req: any, @Query('full') full?: string) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    return this.householdsService.findByUserId(userId, full === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.householdsService.findOne(id);
  }

  @Post()
  create(@Req() req: any, @Body() createData: Partial<Household>) {
    const userId = req['user']?.id || req['user']?.userId;
    return this.householdsService.create(createData, userId);
  }

  @Patch(':id/onboarding')
  submitOnboarding(@Param('id') id: string, @Body() body: any) {
    return this.householdsService.submitOnboarding(id, body);
  }

  @Post(':id/invites')
  generateInviteCode(@Param('id') id: string) {
    return this.householdsService.generateInviteCode(id);
  }

  @Post('join')
  joinByInviteCode(@Req() req: any, @Body('inviteCode') inviteCode: string) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) throw new UnauthorizedException('User context not found from middleware');
    return this.householdsService.joinByInviteCode(userId, inviteCode);
  }

  @Post(':id/task-types')
  addTaskType(@Param('id') id: string, @Body('name') name: string) {
    return this.householdsService.addTaskType(id, name);
  }

  @Delete(':id/users/:userId')
  removeUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.householdsService.removeUser(id, userId);
  }

  @Post(':id/pets')
  addPet(@Param('id') id: string, @Body() petData: Partial<Pet>) {
    return this.householdsService.addPet(id, petData);
  }

  @Patch(':id/pets/:petId')
  updatePet(@Param('id') id: string, @Param('petId') petId: string, @Body() petData: Partial<Pet>) {
    return this.householdsService.updatePet(id, petId, petData);
  }

  @Delete(':id/pets/:petId')
  removePet(@Param('id') id: string, @Param('petId') petId: string) {
    return this.householdsService.removePet(id, petId);
  }

  @Delete(':id/house-type')
  removeHouseType(@Param('id') id: string) {
    return this.householdsService.removeHouseType(id);
  }
}
