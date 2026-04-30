import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HouseTypesService } from './house-types.service';
import { HouseTypesController } from './house-types.controller';
import { HouseType } from '../models/house-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([HouseType])],
  controllers: [HouseTypesController],
  providers: [HouseTypesService],
  exports: [HouseTypesService],
})
export class HouseTypesModule {}
