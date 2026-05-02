import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { User } from '../models/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id }, relations: ['household', 'assignedTasks'] });
    if (!user) throw new NotFoundException(`User #${id} not found`);
    return user;
  }

  async findUserById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  async findByTelegramToken(token: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ telegramToken: token });
  }

  async generateTelegramToken(userId: string): Promise<User> {
    const user = await this.usersRepository.findOneBy({ id: userId });
    if (!user) throw new NotFoundException(`User #${userId} not found`);
    let token: string;
    do {
      token = randomBytes(4).toString('hex').toUpperCase();
    } while (await this.usersRepository.findOneBy({ telegramToken: token }));
    user.telegramToken = token;
    return this.usersRepository.save(user);
  }

  async saveTelegramChatId(userId: string, chatId: string): Promise<void> {
    await this.usersRepository.update(userId, { telegramChatId: chatId });
  }

  async update(id: string, updateData: Partial<User>): Promise<User> {
    await this.usersRepository.update(id, updateData);
    return this.findOne(id);
  }
}
