import type { PaperOrientation } from './student-card-layout';

export type CertificateExportFormat = 'pdf' | 'png' | 'docx';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function prepareCertificateSheets(sheets: HTMLElement[]): Promise<void> {
  await document.fonts?.ready;
  await Promise.all(sheets.flatMap((sheet) => Array.from(sheet.querySelectorAll('img'))).map(async (img) => {
    if (!img.complete) await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        window.clearTimeout(timeout);
        img.removeEventListener('load', loaded);
        img.removeEventListener('error', failed);
        if (error) reject(error); else resolve();
      };
      const loaded = () => finish();
      const failed = () => finish(new Error(`Could not load ${img.alt}. Check the logo address before printing.`));
      const timeout = window.setTimeout(() => finish(new Error(`Loading ${img.alt} took too long. Check the connection and try again.`)), 15000);
      img.addEventListener('load', loaded, { once: true });
      img.addEventListener('error', failed, { once: true });
    });
    if (!img.naturalWidth) throw new Error(`Could not load ${img.alt}. Check the logo address before printing.`);
  }));
  for (const sheet of sheets) {
    const body = sheet.querySelector<HTMLElement>('.certificate-body');
    const note = sheet.querySelector<HTMLElement>('.certificate-seal-note');
    const footer = sheet.querySelector<HTMLElement>('.certificate-footer');
    const doc = sheet.querySelector<HTMLElement>('.certificate-document');
    const letterhead = sheet.querySelector<HTMLElement>('.certificate-letterhead');
    const envelope = doc?.dataset.documentLayout === 'envelope';
    if (!body || !footer || !doc || (!envelope && !letterhead)) {
      throw new Error('The certificate preview is incomplete. Reload the studio and try again.');
    }
    const documentBounds = doc.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    const bodyOverlapsSeal = !envelope && body.getBoundingClientRect().bottom > (note?.getBoundingClientRect().top ?? footerBounds.top) - 4;
    const footerOverflows = footerBounds.bottom > documentBounds.bottom || footerBounds.right > documentBounds.right;
    const footerOverlapsSeal = !!note && footerBounds.top < note.getBoundingClientRect().bottom + 4;
    const letterheadOverflows = !!letterhead && letterhead.scrollHeight > letterhead.clientHeight + 1;
    const envelopeOverflows = envelope && Array.from(doc.querySelectorAll<HTMLElement>('[data-record-block]')).some((block) => {
      const rect = block.getBoundingClientRect();
      const overlapsFooter = rect.left < footerBounds.right && rect.right > footerBounds.left && rect.top < footerBounds.bottom && rect.bottom > footerBounds.top;
      return rect.right > documentBounds.right || rect.bottom > documentBounds.bottom || rect.left < documentBounds.left || rect.top < documentBounds.top || block.scrollHeight > block.clientHeight + 1 || overlapsFooter;
    });
    if (bodyOverlapsSeal || footerOverflows || footerOverlapsSeal || letterheadOverflows || envelopeOverflows) {
      throw new Error('The entered text exceeds the template space. Shorten the long fields before printing or exporting.');
    }
  }
}

/** Export the same composed sheets used by the browser print view. */
export async function createCertificateFile({ sheets, format, width, height, orientation, name }: {
  sheets: HTMLElement[];
  format: CertificateExportFormat;
  width: number;
  height: number;
  orientation: PaperOrientation;
  name: string;
}): Promise<File> {
  if (!sheets.length) throw new Error('Choose a student before exporting.');
  await prepareCertificateSheets(sheets);
  const { toPng } = await import('html-to-image');
  const images: string[] = [];
  for (const sheet of sheets) {
    images.push(await toPng(sheet, { pixelRatio: 2, backgroundColor: '#ffffff', style: { boxShadow: 'none' } }));
  }
  const filename = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'certificate';
  if (format === 'png') {
    const response = await fetch(images[0]);
    if (!response.ok) throw new Error('Could not prepare the certificate image.');
    return new File([await response.blob()], `${filename}.png`, { type: 'image/png' });
  } else if (format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation, unit: 'mm', format: [width, height], compress: true });
    images.forEach((image, index) => {
      if (index) pdf.addPage([width, height], orientation);
      pdf.addImage(image, 'PNG', 0, 0, width, height);
    });
    return new File([pdf.output('blob')], `${filename}.pdf`, { type: 'application/pdf' });
  } else {
    const { Document, ImageRun, Packer, Paragraph } = await import('docx');
    const doc = new Document({ sections: images.map((image) => ({
      properties: { page: {
        size: { width: Math.round(width / 25.4 * 1440), height: Math.round(height / 25.4 * 1440), orientation },
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
      } },
      children: [new Paragraph({ spacing: { before: 0, after: 0, line: 1 }, children: [new ImageRun({
        type: 'png', data: image,
        // A small bottom allowance avoids Word's trailing paragraph spilling onto another page.
        transformation: { width: width / 25.4 * 96, height: (height - 1) / 25.4 * 96 },
      })] })],
    })) });
    return new File([await Packer.toBlob(doc)], `${filename}.docx`, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
}

export async function exportCertificateSheets(options: Parameters<typeof createCertificateFile>[0]): Promise<void> {
  const file = await createCertificateFile(options);
  download(file, file.name);
}
