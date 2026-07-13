import {
  BadRequestException,
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Req,
  UnauthorizedException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { UsersService } from './users.service';
import { User } from '../models/user.entity';
import { EnvironmentVariables } from '../config/environment-variables.type';

const PROFILE_PICTURE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<EnvironmentVariables>,
  ) {}

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
      preferredTaskTypes: (user.preferredTaskTypes || []).map((t) => ({
        id: t.id,
        name: t.name,
      })),
      households: (user.households || []).map((h) => ({
        id: h.id,
        name: h.name,
        taskTypes: (h.taskTypes || []).map((tt) => ({
          id: tt.id,
          name: tt.name,
        })),
      })),
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
    Object.keys(allowedUpdates).forEach(
      (key) => allowedUpdates[key] === undefined && delete allowedUpdates[key],
    );

    const user = await this.usersService.update(userId, allowedUpdates);
    return {
      ...user,
      preferredTaskTypes: (user.preferredTaskTypes || []).map((t) => ({
        id: t.id,
        name: t.name,
      })),
      households: (user.households || []).map((h) => ({
        id: h.id,
        name: h.name,
        taskTypes: (h.taskTypes || []).map((tt) => ({
          id: tt.id,
          name: tt.name,
        })),
      })),
    };
  }

  @Post('me/picture')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'profile-pictures'),
        filename: (req, file, cb) => {
          const ext = PROFILE_PICTURE_EXTENSION_BY_MIME_TYPE[file.mimetype] ?? '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!PROFILE_PICTURE_EXTENSION_BY_MIME_TYPE[file.mimetype]) {
          cb(new BadRequestException('Only JPEG, PNG, WEBP or GIF images are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadProfilePicture(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) {
      throw new UnauthorizedException('User context not found from middleware');
    }
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const backendUrl =
      this.configService.get('BACKEND_URL', { infer: true }) ||
      `http://localhost:${this.configService.get('PORT', { infer: true }) ?? 3000}`;
    const profilePicture = `${backendUrl}/uploads/profile-pictures/${file.filename}`;

    const user = await this.usersService.update(userId, { profilePicture });
    return {
      ...user,
      preferredTaskTypes: (user.preferredTaskTypes || []).map((t) => ({
        id: t.id,
        name: t.name,
      })),
      households: (user.households || []).map((h) => ({
        id: h.id,
        name: h.name,
        taskTypes: (h.taskTypes || []).map((tt) => ({
          id: tt.id,
          name: tt.name,
        })),
      })),
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
      throw new UnauthorizedException(err instanceof Error ? err.message : 'Unauthorized');
    }
  }

  @Patch('me/preferred-tasks')
  async updatePreferredTasks(
    @Req() req: any,
    @Body('taskTypeIds') taskTypeIds: string[],
  ) {
    const userId = req['user']?.id || req['user']?.userId;
    const user = await this.usersService.updatePreferredTasks(
      userId,
      taskTypeIds,
    );
    return {
      ...user,
      preferredTaskTypes: (user.preferredTaskTypes || []).map((t) => ({
        id: t.id,
        name: t.name,
      })),
      households: (user.households || []).map((h) => ({
        id: h.id,
        name: h.name,
        taskTypes: (h.taskTypes || []).map((tt) => ({
          id: tt.id,
          name: tt.name,
        })),
      })),
    };
  }

  @Get('me/available-tasks')
  async getAvailableTasks(@Req() req: any) {
    const userId = req['user']?.id || req['user']?.userId;
    return this.usersService.getAvailableTaskTypes(userId);
  }

  @Delete('me/telegram')
  async unlinkTelegram(@Req() req: any) {
    const userId = req['user']?.id || req['user']?.userId;
    if (!userId) throw new UnauthorizedException();
    await this.usersService.unlinkTelegramChatId(userId);
    return { message: 'Telegram unlinked' };
  }
}
