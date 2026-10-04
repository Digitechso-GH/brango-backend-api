import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

@Injectable()
export class AwsS3StorageService implements StorageService {
  private s3Client: S3Client;
  private bucket: string;
  private region: string;
  private publicUrlBase: string;

  constructor(private configService: ConfigService) {
    this.region =
      this.configService.get<string>('AWS_S3_REGION') ||
      this.configService.get<string>('AWS_REGION') ||
      'us-east-1';

    const accessKeyId =
      this.configService.get<string>('AWS_ACCESS_KEY_ID') ||
      this.configService.get<string>('STORAGE_ACCESS_KEY') ||
      '';

    const secretAccessKey =
      this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ||
      this.configService.get<string>('STORAGE_SECRET_KEY') ||
      '';

    this.bucket =
      this.configService.get<string>('AWS_S3_BUCKET') ||
      this.configService.get<string>('STORAGE_BUCKET') ||
      '';

    this.publicUrlBase =
      this.configService.get<string>('AWS_S3_PUBLIC_URL') ||
      this.configService.get<string>('STORAGE_PUBLIC_URL') ||
      '';

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async getUploadUrl(key: string, contentType?: string): Promise<string> {
    const sanitizedContentType =
      contentType === 'image/jpg' ? 'image/jpeg' : contentType;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(sanitizedContentType ? { ContentType: sanitizedContentType } : {}),
    });

    // URL firmada válida por 15 minutos
    return getSignedUrl(this.s3Client, command, { expiresIn: 900 });
  }

  getPublicUrl(key: string): string {
    if (this.publicUrlBase) {
      return `${this.publicUrlBase}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
