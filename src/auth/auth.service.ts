import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../models/user.entity';

import { UserDto } from '../dtos/user.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async getGoogleUserInfo(accessToken: string) {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    try {
      const tokenInfo = await client.getTokenInfo(accessToken);

      if (tokenInfo.azp !== process.env.GOOGLE_CLIENT_ID) {
        throw new Error('Invalid Google Token');
      }

      const response = await axios.get(
        `https://www.googleapis.com/oauth2/v3/userinfo`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      return response.data;
    } catch (error) {
      console.error('Google Verification Error:', error);
      throw new Error('Invalid Google Token');
    }
  }

  generateTokens(userId: string) {
    const accessTokenSecret = process.env.JWT_SECRET;
    const refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
    const accessTokenExp = process.env.JWT_EXP || '15m';
    const refreshTokenExp = process.env.JWT_REFRESH_EXP || '7d';

    if (!accessTokenSecret || !refreshTokenSecret) {
      throw new Error(
        'FATAL: JWT_SECRET and JWT_REFRESH_SECRET environment variables must be set',
      );
    }

    const accessToken = jwt.sign({ userId }, accessTokenSecret, {
      expiresIn: accessTokenExp as any,
    });

    const refreshToken = jwt.sign({ userId }, refreshTokenSecret, {
      expiresIn: refreshTokenExp as any,
    });

    return { accessToken, refreshToken };
  }

  async setTokens(user: User) {
    const { accessToken, refreshToken } = this.generateTokens(user.id);

    if (!user.refreshTokens) user.refreshTokens = [];
    user.refreshTokens.push(refreshToken);
    await this.userRepository.save(user);

    return { accessToken, refreshToken };
  }

  sendAuthResponse(
    res: Response,
    user: UserDto,
    accessToken: string,
    refreshToken: string,
  ) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      accessToken,
      isAuth: true,
      user,
    };
  }

  async googleLogin(req: Request, res: Response) {
    const { token } = req.body;

    if (!token) {
      throw new BadRequestException('Missing Google token');
    }

    try {
      const { email, name, profilePicture } = await this.getGoogleUserInfo(token);

      let user = await this.userRepository.findOneBy({ email });
      if (!user) {
        user = this.userRepository.create({
          username: name,
          email: email,
          profilePicture: profilePicture,
          password: 'google-sso',
        });
        await this.userRepository.save(user);
      }

      const { accessToken, refreshToken } = await this.setTokens(user);

      this.sendAuthResponse(res, new UserDto(user), accessToken, refreshToken);
    } catch (err: any) {
      throw new BadRequestException(
        'Internal server error during Google authentication',
      );
    }
  }

  async register(req: Request, res: Response) {
    const { email, password } = req.body;
    const username = email.split('@')[0];

    if (!email || !password) {
      throw new BadRequestException('Missing email or password');
    }

    try {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const user = this.userRepository.create({
        username,
        email,
        password: hashedPassword,
      });
      await this.userRepository.save(user);

      const { accessToken, refreshToken } = await this.setTokens(user);

      this.sendAuthResponse(res, new UserDto(user), accessToken, refreshToken);
    } catch (err: any) {
      if (err.code === '23505') {
        // PostgreSQL unique violation code
        throw new BadRequestException('Email already exists');
      } else {
        throw new BadRequestException(err.message);
      }
    }
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new BadRequestException('Missing email or password');
    }

    try {
      const user = await this.userRepository.findOneBy({ email });
      if (!user) {
        throw new BadRequestException('Invalid email or password');
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        throw new BadRequestException('Invalid email or password');
      }

      const { accessToken, refreshToken } = await this.setTokens(user);

      this.sendAuthResponse(res, new UserDto(user), accessToken, refreshToken);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  async logout(req: Request, res: Response) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new BadRequestException('Missing refresh token');
    }

    try {
      const refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
      if (!refreshTokenSecret) {
        throw new BadRequestException(
          'FATAL: JWT_REFRESH_SECRET environment variable is not set',
        );
      }
      const payload: any = jwt.verify(refreshToken, refreshTokenSecret);
      const user = await this.userRepository.findOneBy({ id: payload.userId });

      if (
        !user ||
        !user.refreshTokens ||
        !user.refreshTokens.includes(refreshToken)
      ) {
        throw new BadRequestException('Invalid refresh token');
      }

      user.refreshTokens = user.refreshTokens.filter(
        (token) => token !== refreshToken,
      );
      await this.userRepository.save(user);

      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      return { message: 'Logged out successfully' };
    } catch (err: any) {
      throw new BadRequestException('Invalid refresh token');
    }
  }

  async refresh(req: Request, res: Response) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new BadRequestException('Missing refresh token');
    }

    try {
      const refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
      if (!refreshTokenSecret) {
        throw new Error('FATAL: JWT_REFRESH_SECRET environment variable is not set');
      }
      const payload: any = jwt.verify(refreshToken, refreshTokenSecret);
      const user = await this.userRepository.findOneBy({ id: payload.userId });

      if (
        !user ||
        !user.refreshTokens ||
        !user.refreshTokens.includes(refreshToken)
      ) {
        throw new BadRequestException('Invalid refresh token');
      }

      const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
        this.generateTokens(user.id);

      user.refreshTokens = user.refreshTokens.filter(
        (token) => token !== refreshToken,
      );
      user.refreshTokens.push(newRefreshToken);
      await this.userRepository.save(user);

      this.sendAuthResponse(
        res,
        new UserDto(user),
        newAccessToken,
        newRefreshToken,
      );
    } catch (err: any) {
      throw new BadRequestException('Invalid refresh token');
    }
  }
}