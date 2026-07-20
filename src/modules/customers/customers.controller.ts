import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CreateClientDto } from './dto/create-client.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post('companies')
  async createCompany(@Body() dto: CreateCompanyDto) {
    return this.customersService.createCompany(dto);
  }

  @Get('companies')
  async findAllCompanies() {
    return this.customersService.findAllCompanies();
  }

  @Delete('companies/:id')
  async deleteCompany(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.deleteCompany(id);
  }

  @Put('companies/:id')
  async updateCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.customersService.updateCompany(id, dto);
  }

  @Post('clients')
  async createClient(@Body() dto: CreateClientDto) {
    return this.customersService.createClient(dto);
  }

  @Get('clients')
  async findAllClients() {
    return this.customersService.findAllClients();
  }

  @Delete('clients/:id')
  async deleteClient(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.deleteClient(id);
  }
}
