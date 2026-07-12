import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './environment-variables.type';

export const env = new ConfigService<EnvironmentVariables>();
