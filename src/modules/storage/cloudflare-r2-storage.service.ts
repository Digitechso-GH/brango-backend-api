import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

@Injectable()
export class CloudflareR2StorageService implements StorageService {
  private s3Client: S3Client;
  private bucket: string;
  private publicUrlBase: string;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.configService.get<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('STORAGE_SECRET_KEY');
    this.bucket = this.configService.get<string>('STORAGE_BUCKET') || '';
    this.publicUrlBase = this.configService.get<string>('STORAGE_PUBLIC_URL') || '';

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKeyId || '',
        secretAccessKey: secretAccessKey || '',
      },
      forcePathStyle: true,
    });
  }

  async getUploadUrl(key: string, contentType?: string): Promise<string> {
    const sanitizedContentType = contentType === 'image/jpg' ? 'image/jpeg' : contentType;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(sanitizedContentType ? { ContentType: sanitizedContentType } : {}),
    });
    // URL valid for 15 minutes
    return getSignedUrl(this.s3Client, command, { expiresIn: 900 });
  }

  getPublicUrl(key: string): string {
    if (this.publicUrlBase) {
      return `${this.publicUrlBase}/${key}`;
    }
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT') || '';
    return `${endpoint}/${this.bucket}/${key}`;
  }
}
