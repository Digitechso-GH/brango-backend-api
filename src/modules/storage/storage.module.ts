import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { STORAGE_SERVICE_TOKEN } from './storage.service';
import { AwsS3StorageService } from './aws-s3-storage.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_SERVICE_TOKEN,
      useClass: AwsS3StorageService,
    },
  ],
  exports: [STORAGE_SERVICE_TOKEN],
})
export class StorageModule {}
