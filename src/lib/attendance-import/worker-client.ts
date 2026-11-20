import type { scanSf2Sheet, Sf2Report } from './sf2';

export class Sf2Reader {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private sequence = 0;
  private disposed = false;
  private pending: { reject: (error: Error) => void; cleanup: () => void } | null = null;

  private request<T>(message: object, transfer: Transferable[] = []): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Choose the SF2 file again to restart its reader.'));
    if (this.pending) return Promise.reject(new Error('An SF2 scan is already running.'));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.pending = null;
      };
      const timer = setTimeout(() => this.dispose('Reading SF2 exceeded 45 seconds. Use a smaller workbook.'), 45000);
      this.pending = { reject, cleanup };
      this.worker.onmessage = event => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.value);
      };
      this.worker.onerror = () => this.dispose('The SF2 reader failed. Choose the file again.');
      try { this.worker.postMessage({ ...message, id }, transfer); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  parse(buffer: ArrayBuffer) { return this.request<{ sheets: string[] }>({ action: 'parse', buffer }, [buffer]); }
  scan(sheet: number, options: Parameters<typeof scanSf2Sheet>[1]) {
    return this.request<Sf2Report>({ action: 'scan', sheet, options });
  }
  dispose(message = 'SF2 scan canceled.') {
    this.disposed = true;
    const pending = this.pending;
    pending?.cleanup();
    pending?.reject(new Error(message));
    this.worker.terminate();
  }
}
