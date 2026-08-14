import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { TrackingModule } from '../tracking/tracking.module';
import { GeocodingService } from './services/geocoding.service';
import { OrdersClientResolverService } from './services/orders-client-resolver.service';
import { OrdersExcelParserService } from './services/orders-excel-parser.service';
import { OrdersImportService } from './services/orders-import.service';
import { OrdersCronService } from './orders-cron.service';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TrackingModule, StorageModule, AuthModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    GeocodingService,
    OrdersClientResolverService,
    OrdersExcelParserService,
    OrdersImportService,
    OrdersCronService,
  ],
  exports: [
    OrdersService,
    GeocodingService,
    OrdersClientResolverService,
    OrdersExcelParserService,
    OrdersImportService,
    OrdersCronService,
  ],
})
export class OrdersModule {}
