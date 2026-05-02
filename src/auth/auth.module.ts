import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from '../models/user.entity';
import { UsersModule } from '../users/users.module';


@Module({
    imports: [TypeOrmModule.forFeature([User]), UsersModule],
    controllers: [AuthController],
    providers: [AuthService],
    exports: [AuthService]
})
export class AuthModule { }

