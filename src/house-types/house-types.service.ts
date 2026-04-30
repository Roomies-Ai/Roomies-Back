import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HouseType } from '../models/house-type.entity';

@Injectable()
export class HouseTypesService {
  constructor(
    @InjectRepository(HouseType)
    private houseTypesRepository: Repository<HouseType>,
  ) {}

  async create(createData: Partial<HouseType>): Promise<HouseType> {
    const houseType = this.houseTypesRepository.create(createData);
    return this.houseTypesRepository.save(houseType);
  }

  async findAll(): Promise<HouseType[]> {
    return this.houseTypesRepository.find();
  }

  async findOne(id: string): Promise<HouseType> {
    const houseType = await this.houseTypesRepository.findOne({ where: { id } });
    if (!houseType) {
      throw new NotFoundException(`HouseType #${id} not found`);
    }
    return houseType;
  }

  async update(id: string, updateData: Partial<HouseType>): Promise<HouseType> {
    const houseType = await this.findOne(id);
    await this.houseTypesRepository.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.houseTypesRepository.delete(id);
  }
}
