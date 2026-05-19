import { Controller, Get, Patch, Body, Req, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../models/user.entity';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me/telegram-token')
  async getTelegramToken(@Req() req: any) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    let user = await this.usersService.findUserById(userId);
    if (!user) throw new UnauthorizedException();
    if (!user.telegramToken) {
      user = await this.usersService.generateTelegramToken(userId);
    }
    return { telegramToken: user.telegramToken };
  }

  @Get('me')
  async getMe(@Req() req: any) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    const user = await this.usersService.findOne(userId);
    
    // Sanitize to prevent circular references in JSON serialization
    return {
      ...user,
      preferredTaskTypes: (user.preferredTaskTypes || []).map(t => ({ id: t.id, name: t.name })),
      households: (user.households || []).map(h => ({ 
        id: h.id, 
        name: h.name,
        taskTypes: (h.taskTypes || []).map(tt => ({ id: tt.id, name: tt.name }))
      }))
    };
  }

  @Patch('me')
  async updateMe(@Req() req: any, @Body() updateData: Partial<User>) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    
    // Only allow updating certain fields
    const allowedUpdates: any = {
      username: updateData.username,
      email: updateData.email,
      profilePicture: updateData.profilePicture,
      phoneNumber: updateData.phoneNumber,
      vibes: updateData.vibes,
      preferences: updateData.preferences,
    };
    
    // remove undefined
    Object.keys(allowedUpdates).forEach(key => allowedUpdates[key] === undefined && delete allowedUpdates[key]);
    
    const user = await this.usersService.update(userId, allowedUpdates);
    return {
      ...user,
      preferredTaskTypes: (user.preferredTaskTypes || []).map(t => ({ id: t.id, name: t.name })),
      households: (user.households || []).map(h => ({ 
        id: h.id, 
        name: h.name,
        taskTypes: (h.taskTypes || []).map(tt => ({ id: tt.id, name: tt.name }))
      }))
    };
  }

  @Patch('me/password')
  async changePassword(@Req() req: any, @Body() body: any) {
    const userId = req['user']?.id || req['user']?.userId;
    const { oldPassword, newPassword } = body;
    
    try {
      await this.usersService.updatePassword(userId, oldPassword, newPassword);
      return { message: 'Password updated successfully' };
    } catch (err) {
      throw new UnauthorizedException(err.message);
    }
  }

  @Patch('me/preferred-tasks')
  async updatePreferredTasks(@Req() req: any, @Body('taskTypeIds') taskTypeIds: string[]) {
    const userId = req['user']?.id || req['user']?.userId;
    const user = await this.usersService.updatePreferredTasks(userId, taskTypeIds);
    return {
      ...user,
      preferredTaskTypes: (user.preferredTaskTypes || []).map(t => ({ id: t.id, name: t.name })),
      households: (user.households || []).map(h => ({ 
        id: h.id, 
        name: h.name,
        taskTypes: (h.taskTypes || []).map(tt => ({ id: tt.id, name: tt.name }))
      }))
    };
  }

  @Get('me/available-tasks')
  async getAvailableTasks(@Req() req: any) {
    const userId = req['user']?.id || req['user']?.userId;
    return this.usersService.getAvailableTaskTypes(userId);
  }
}
