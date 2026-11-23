import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../users/users.constants';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SYS_ADMIN, ROLES.SYS_COORDINATOR, ROLES.SYS_OPERATOR)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post('companies')
  async createCompany(@Body() dto: CreateCompanyDto, @Req() req: any) {
    return this.customersService.createCompany(dto, req.user?.tenantId);
  }

  @Get('companies')
  async findAllCompanies(@Req() req: any) {
    return this.customersService.findAllCompanies(req.user?.tenantId);
  }

  @Delete('companies/:id')
  async deleteCompany(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.customersService.deleteCompany(id, req.user?.tenantId);
  }

  @Put('companies/:id')
  async updateCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCompanyDto,
    @Req() req: any,
  ) {
    return this.customersService.updateCompany(id, dto, req.user?.tenantId);
  }

  @Post('clients')
  async createClient(@Body() dto: CreateClientDto, @Req() req: any) {
    return this.customersService.createClient(dto, req.user?.tenantId);
  }

  @Get('clients')
  async findAllClients(@Req() req: any) {
    return this.customersService.findAllClients(req.user?.tenantId);
  }

  @Delete('clients/:id')
  async deleteClient(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.customersService.deleteClient(id, req.user?.tenantId);
  }
}
