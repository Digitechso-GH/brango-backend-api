import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSedeDto } from './dto/create-sede.dto';

@Injectable()
export class SedesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.branch.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateSedeDto) {
    return this.prisma.branch.create({
      data: {
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        active: dto.active !== undefined ? dto.active : true,
      },
    });
  }
}
