import { readSf2Workbook, scanSf2Sheet, type Sf2Sheet } from './sf2';

let sheets: Sf2Sheet[] = [];
self.onmessage = (event: MessageEvent<{
  id: number; action: 'parse' | 'scan'; buffer?: ArrayBuffer; sheet?: number;
  options?: Parameters<typeof scanSf2Sheet>[1];
}>) => {
  const { id, action } = event.data;
  try {
    if (action === 'parse') {
      sheets = [];
      sheets = readSf2Workbook(event.data.buffer!).sheets;
      self.postMessage({ id, value: { sheets: sheets.map(sheet => sheet.name) } });
    } else {
      const sheet = sheets[event.data.sheet ?? 0];
      if (!sheet || !event.data.options) throw new Error('Choose an SF2 workbook and worksheet first.');
      self.postMessage({ id, value: scanSf2Sheet(sheet, event.data.options) });
    }
  } catch (error) { self.postMessage({ id, error: (error as Error).message }); }
};
