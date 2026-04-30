import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { HouseTypesService } from './house-types.service';
import { HouseType } from '../models/house-type.entity';

@Controller('house-types')
export class HouseTypesController {
  constructor(private readonly houseTypesService: HouseTypesService) {}

  @Post()
  create(@Body() createData: Partial<HouseType>) {
    return this.houseTypesService.create(createData);
  }

  @Get()
  findAll() {
    return this.houseTypesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.houseTypesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateData: Partial<HouseType>) {
    return this.houseTypesService.update(id, updateData);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.houseTypesService.remove(id);
  }
}
