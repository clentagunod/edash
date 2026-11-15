import { appSchoolFilePrefix } from './app-config';
import { parentExportRows, type ParentEntry } from './parent-list';

const columnWidths = [6, 38, 44, 20, 18, 22, 22, 18];
const excelMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// SheetJS writes the workbook data; these OOXML styles are applied to the saved
// file because its community writer does not serialize custom cell formatting.
const parentListStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFCE9D9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

/** A complete, styled .xlsx file; each parent occupies one numbered group. */
export async function createParentListWorkbook(parents: ParentEntry[], schoolYear: string): Promise<Uint8Array> {
  const [{ utils, write }, { unzipSync, zipSync, strFromU8, strToU8 }] = await Promise.all([
    import('xlsx'), import('fflate'),
  ]);
  const rows = parentExportRows(parents, schoolYear);
  // String cells retain leading zeroes and never become executable formulas.
  const sheet = utils.aoa_to_sheet(rows);
  sheet['!cols'] = columnWidths.map(wch => ({ wch }));
  sheet['!rows'] = rows.map((row, index) => ({
    hpt: index === 0 ? 26 : Math.max(24, ...row.map((value, column) =>
      Math.ceil(String(value).length / columnWidths[column]) * 15 + 6)),
  }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  sheet['!merges'] = [];
  let row = 1;
  for (const parent of parents) {
    if (parent.children.length > 1) {
      for (const column of [0, 1]) {
        sheet['!merges'].push({ s: { r: row, c: column }, e: { r: row + parent.children.length - 1, c: column } });
      }
    }
    row += parent.children.length;
  }
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, 'Parents and Learners');
  const files = unzipSync(new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' })));
  files['xl/styles.xml'] = strToU8(parentListStyles);
  let worksheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  worksheet = worksheet.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>');
  worksheet = worksheet.replace(/<c\b([^>]*)>/g, (tag, attributes: string) => {
    const reference = attributes.match(/\br="([A-Z]+)(\d+)"/);
    if (!reference) return tag;
    const style = reference[2] === '1' ? 1 : reference[1] === 'A' ? 3 : 2;
    return `<c${attributes.replace(/\s+s="\d+"/, '')} s="${style}">`;
  });
  files['xl/worksheets/sheet1.xml'] = strToU8(worksheet);
  return zipSync(files, { level: 6 });
}

export async function downloadParentList(parents: ParentEntry[], schoolYear: string): Promise<void> {
  const data = await createParentListWorkbook(parents, schoolYear);
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: excelMimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${appSchoolFilePrefix()}-parents-${schoolYear || 'current'}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
