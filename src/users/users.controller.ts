import { Controller, Get, Patch, Body, Req, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../models/user.entity';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() req: any) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    return this.usersService.findOne(userId);
  }

  @Patch('me')
  updateMe(@Req() req: any, @Body() updateData: Partial<User>) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    // Only allow updating certain fields like username or profilePicture
    const allowedUpdates = {
      username: updateData.username,
      profilePicture: updateData.profilePicture,
      phoneNumber: updateData.phoneNumber,
    };
    // remove undefined
    Object.keys(allowedUpdates).forEach(key => allowedUpdates[key] === undefined && delete allowedUpdates[key]);
    
    return this.usersService.update(userId, allowedUpdates);
  }
}
