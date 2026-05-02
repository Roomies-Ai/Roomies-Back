import { User } from '../models/user.entity';


export class UserDto {
  id: string;
  username: string;
  email: string;
  profilePicture: string | undefined;
  phoneNumber: string | undefined;

  constructor(user: User) {
    this.id = user.id;
    this.username = user.username;
    this.email = user.email;
    this.profilePicture = user.profilePicture;
    this.phoneNumber = user.phoneNumber;
  }
}
