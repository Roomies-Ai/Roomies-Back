import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    username: string;
    email: string;
    password: string;
    profilePicture?: string;
    bio?: string;
    refreshTokens: string[];
    suggestedBooks: string[];
}

const userSchema = new Schema<IUser>({
    username: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    profilePicture: {
        type: String,
        required: false
    },
    bio: {
        type: String,
        required: false,
        default: '',
        maxlength: 100
    },
    refreshTokens: {
        type: [String],
        default: []
    },
    suggestedBooks: {
        type: [String],
        default: []
    }
}, {
    timestamps: true
});

const userModel = mongoose.model<IUser>('User', userSchema);

export default userModel;
