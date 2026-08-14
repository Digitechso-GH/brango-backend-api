import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { STORAGE_SERVICE_TOKEN } from './storage.service';
import { CloudflareR2StorageService } from './cloudflare-r2-storage.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_SERVICE_TOKEN,
      useClass: CloudflareR2StorageService,
    },
  ],
  exports: [STORAGE_SERVICE_TOKEN],
})
export class StorageModule {}
