export interface StorageService {
  getUploadUrl(key: string, contentType?: string): Promise<string>;
  getPublicUrl(key: string): string;
}

export const STORAGE_SERVICE_TOKEN = 'StorageService';
