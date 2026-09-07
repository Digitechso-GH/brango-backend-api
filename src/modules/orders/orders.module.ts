import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { TrackingModule } from '../tracking/tracking.module';
import { GeocodingService } from './services/geocoding.service';
import { OrdersClientResolverService } from './services/orders-client-resolver.service';
import { OrdersExcelParserService } from './services/orders-excel-parser.service';
import { OrdersImportService } from './services/orders-import.service';
import { OrderStopsGroupingService } from './services/order-stops-grouping.service';
import { OrderPausesService } from './services/order-pauses.service';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersPublicController } from './orders.public.controller';

@Module({
  imports: [TrackingModule, StorageModule, AuthModule],
  controllers: [OrdersController, OrdersPublicController],
  providers: [
    OrdersService,
    GeocodingService,
    OrdersClientResolverService,
    OrdersExcelParserService,
    OrdersImportService,
    OrderStopsGroupingService,
    OrderPausesService,
  ],
  exports: [
    OrdersService,
    GeocodingService,
    OrdersClientResolverService,
    OrdersExcelParserService,
    OrdersImportService,
    OrderStopsGroupingService,
    OrderPausesService,
  ],
})
export class OrdersModule {}
