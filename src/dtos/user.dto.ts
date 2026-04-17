import { IUser } from "../models/userModel";

export class UserDto {

    id: import("mongoose").Types.ObjectId;
    username: string;
    email: string;
    profilePicture: string | undefined;
    bio: string | undefined;

    constructor(
        user: IUser
    ) {
        this.id = user._id;
        this.username = user.username;
        this.email = user.email;
        this.profilePicture = user.profilePicture;
        this.bio = user.bio;
    }
}
