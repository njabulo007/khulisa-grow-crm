export interface StorageService {
  uploadProjectAsset: (projectId: string, file: File) => Promise<string>;
  uploadInvoicePdf: (invoiceId: string, file: File) => Promise<string>;
  deleteFile: (storagePath: string) => Promise<void>;
}

class PlaceholderStorageService implements StorageService {
  // TODO: Replace with Firebase Storage:
  // - ref(storage, path)
  // - uploadBytes(...)
  // - getDownloadURL(...)
  // - deleteObject(...)
  // Keep this interface stable so pages/hooks do not depend on Firebase SDK details.
  async uploadProjectAsset(_projectId: string, _file: File): Promise<string> {
    throw new Error('StorageService is not configured yet.');
  }

  async uploadInvoicePdf(_invoiceId: string, _file: File): Promise<string> {
    throw new Error('StorageService is not configured yet.');
  }

  async deleteFile(_storagePath: string): Promise<void> {
    throw new Error('StorageService is not configured yet.');
  }
}

export const storageService: StorageService = new PlaceholderStorageService();
