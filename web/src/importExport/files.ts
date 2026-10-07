/** Reading and writing CSV / Excel files. Excel support is loaded on demand. */
import Papa from 'papaparse';

export type Row = Record<string, string | number>;

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return cellToString(o.result);
    if (o.text !== undefined) return cellToString(o.text);
    if (o.hyperlink) return o.hyperlink;
    return '';
  }
  return String(v);
}

export async function readSpreadsheet(file: File): Promise<Record<string, string>[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (headers[col] = cellToString(cell.value).trim()));
    const out: Record<string, string>[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const rec: Record<string, string> = {};
      let any = false;
      headers.forEach((h, col) => {
        if (!h) return;
        const s = cellToString(row.getCell(col).value).trim();
        if (s) any = true;
        rec[h] = s;
      });
      if (any) out.push(rec);
    });
    return out;
  }
  if (/\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv') {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy' });
    if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
    return parsed.data;
  }
  throw new Error('Choose a .csv or .xlsx file.');
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadCsv(headers: string[], rows: Row[], filename: string) {
  const csv = Papa.unparse({ fields: headers, data: rows.map((r) => headers.map((h) => r[h] ?? '')) });
  // BOM so Excel opens UTF-8 correctly.
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename);
}

export async function downloadXlsx(sheets: { name: string; headers: string[]; rows: Row[] }[], filename: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.headers.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(10, h.length + 2)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    s.rows.forEach((r) => ws.addRow(r));
  }
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export const stamp = () => new Date().toISOString().slice(0, 10);
