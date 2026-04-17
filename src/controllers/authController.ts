import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import userModel, { IUser } from '../models/userModel';
import { getGoogleUserInfo } from '../services/googleAuth.service';
import { UserDto } from '../dtos/user.dto';

const generateTokens = (userId: string) => {
    const accessTokenSecret = process.env.JWT_SECRET;
    const refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
    const accessTokenExp = process.env.JWT_EXP || '15m';
    const refreshTokenExp = process.env.JWT_REFRESH_EXP || '7d';

    if (!accessTokenSecret || !refreshTokenSecret) {
        throw new Error('FATAL: JWT_SECRET and JWT_REFRESH_SECRET environment variables must be set');
    }

    const accessToken = jwt.sign(
        { userId },
        accessTokenSecret,
        { expiresIn: accessTokenExp as any }
    );

    const refreshToken = jwt.sign(
        { userId },
        refreshTokenSecret,
        { expiresIn: refreshTokenExp as any }
    );

    return { accessToken, refreshToken };
};

const setTokens = async (user: IUser) => {
    const { accessToken, refreshToken } = generateTokens(user._id.toString());

    if (!user.refreshTokens) user.refreshTokens = [];
    user.refreshTokens.push(refreshToken);
    await user.save();

    return { accessToken, refreshToken };
};

const sendAuthResponse = (res: Response, user: UserDto, accessToken: string, refreshToken: string) => {
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({
        accessToken,
        isAuth: true,
        user
    });
};

const googleLogin = async (req: Request, res: Response) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ message: 'Missing Google token' });
    }

    try {
        const { email, name, profilePicture } = await getGoogleUserInfo(token);

        let user = await userModel.findOne({ email });
        if (!user) {
            user = new userModel({
                username: name,
                email: email,
                profilePicture: profilePicture,
                password: 'google-sso'
            });
            await user.save();
        }

        const { accessToken, refreshToken } = await setTokens(user);

        sendAuthResponse(res, new UserDto(user), accessToken, refreshToken);
    } catch (err: any) {
        console.error('Google Auth Error:', err);
        res.status(500).json({ message: 'Internal server error during Google authentication' });
    }
};

const register = async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const username = email.split('@')[0];

    if (!email || !password) {
        res.status(400).json({ message: 'Missing email or password' });
        return;
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = new userModel({
            username,
            email,
            password: hashedPassword,
        });
        await user.save();

        const { accessToken, refreshToken } = await setTokens(user);

        sendAuthResponse(res, new UserDto(user), accessToken, refreshToken);
    } catch (err: any) {
        if (err.code === 11000) {
            res.status(409).json({ message: 'Email already exists' });
        } else {
            res.status(400).json({ message: err.message });
        }
    }
};

const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ message: 'Missing email or password' });
        return;
    }

    try {
        const user = await userModel.findOne({ email });
        if (!user) {
            res.status(401).json({ message: 'Invalid email or password' });
            return;
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            res.status(401).json({ message: 'Invalid email or password' });
            return;
        }

        const { accessToken, refreshToken } = await setTokens(user);

        sendAuthResponse(res, new UserDto(user), accessToken, refreshToken);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
};

const logout = async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
        res.status(400).json({ message: 'Missing refresh token' });
        return;
    }

    try {
        const refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
        if (!refreshTokenSecret) {
            console.error('FATAL: JWT_REFRESH_SECRET environment variable is not set');
            return res.status(500).json({ message: 'Server configuration error' });
        }
        const payload: any = jwt.verify(refreshToken, refreshTokenSecret);
        const user = await userModel.findById(payload.userId);

        if (!user || !user.refreshTokens || !user.refreshTokens.includes(refreshToken)) {
            res.status(401).json({ message: 'Invalid refresh token' });
            return;
        }

        user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
        await user.save();

        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        res.status(200).json({ message: 'Logged out successfully' });
    } catch (err: any) {
        res.status(401).json({ message: 'Invalid refresh token' });
    }
};

const refresh = async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
        res.status(400).json({ message: 'Missing refresh token' });
        return;
    }

    try {
        const refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
        if (!refreshTokenSecret) {
            console.error('FATAL: JWT_REFRESH_SECRET environment variable is not set');
            return res.status(500).json({ message: 'Server configuration error' });
        }
        const payload: any = jwt.verify(refreshToken, refreshTokenSecret);
        const user = await userModel.findById(payload.userId);

        if (!user || !user.refreshTokens || !user.refreshTokens.includes(refreshToken)) {
            res.status(401).json({ message: 'Invalid refresh token' });
            return;
        }

        const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user._id.toString());

        user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
        user.refreshTokens.push(newRefreshToken);
        await user.save();

        sendAuthResponse(res, new UserDto(user), newAccessToken, newRefreshToken);
    } catch (err: any) {
        res.status(401).json({ message: 'Invalid refresh token' });
    }
};

export default {
    register,
    login,
    logout,
    refresh,
    googleLogin
};
