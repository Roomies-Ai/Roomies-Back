import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const getGoogleUserInfo = async (accessToken: string) => {
    try {
        const tokenInfo = await client.getTokenInfo(accessToken);

        if (tokenInfo.azp !== process.env.GOOGLE_CLIENT_ID) {
            throw new Error('Invalid Google Token');
        }

        const response = await axios.get(`https://www.googleapis.com/oauth2/v3/userinfo`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        return response.data;
    } catch (error) {
        console.error('Google Verification Error:', error);
        throw new Error('Invalid Google Token');
    }
};