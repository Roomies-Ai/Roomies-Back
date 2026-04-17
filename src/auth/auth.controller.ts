import { Controller, Post, Body, Res, Req } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';


@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }
    @Post('/register')
    async register(@Body() body: any, @Res() res: Response, @Req() req: Request) {
        const result = await this.authService.register(req, res);
        return result;
    }

    @Post('/google')
    async googleLogin(@Body() body: { token: string }, @Res() res: Response, @Req() req: Request) {
        const result = await this.authService.googleLogin(req, res);
        return result;
    }

    @Post('/login')
    async login(@Body() body: { email: string, password: string }, @Res() res: Response, @Req() req: Request) {
        const result = await this.authService.login(req, res);
        return result;
    }

    @Post('/logout')
    async logout(@Body() body: { email: string, password: string }, @Res() res: Response, @Req() req: Request) {
        const result = await this.authService.logout(req, res);
        return result;
    }

    @Post('/refresh')
    async refresh(@Body() body: { email: string, password: string }, @Res() res: Response, @Req() req: Request) {
        const result = await this.authService.refresh(req, res);
        return result;
    }
}

