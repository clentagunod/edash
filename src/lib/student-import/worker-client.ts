import { IMPORT_LIMITS, type FileKind, type ImportOptions, type ScanResult } from './types';

export class StudentImportReader {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private sequence = 0;
  private disposed = false;
  private pending: { reject: (error: Error) => void; cleanup: () => void } | null = null;

  private request<T>(message: object, transfer: Transferable[] = []): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Choose the dataset again to restart its reader.'));
    if (this.pending) return Promise.reject(new Error('An import scan is already running.'));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.pending = null;
      };
      const timer = setTimeout(() => this.dispose('The scan exceeded 45 seconds. Split the file into smaller datasets.'), IMPORT_LIMITS.milliseconds);
      this.pending = { reject, cleanup };
      this.worker.onmessage = event => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.value);
      };
      this.worker.onerror = () => this.dispose('The dataset reader failed. Choose the file again to restart.');
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }

  parse(buffer: ArrayBuffer, kind: FileKind) {
    return this.request<{ sheets: string[]; schoolId?: string; schoolYear?: string }>({ action: 'parse', buffer, kind }, [buffer]);
  }

  scan(sheet: number, options: ImportOptions) {
    return this.request<ScanResult>({ action: 'scan', sheet, options });
  }

  dispose(message = 'Scan canceled.') {
    this.disposed = true;
    const pending = this.pending;
    pending?.cleanup();
    pending?.reject(new Error(message));
    this.worker.terminate();
  }
}
