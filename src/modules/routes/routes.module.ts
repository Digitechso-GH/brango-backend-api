import { Module } from '@nestjs/common';
import { RoutesService } from './routes.service';
import { RoutesController } from './routes.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [PrismaModule, AuthModule, TrackingModule],
  providers: [RoutesService],
  controllers: [RoutesController]
})
export class RoutesModule {}
