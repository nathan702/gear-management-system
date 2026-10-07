import { qrUrl } from '@gear/shared';

/** Sheet layouts in inches (US Letter). Fine-tune with the offsets in Settings. */
export interface LabelTemplate {
  id: string;
  name: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  left: number;
  top: number;
  hPitch: number;
  vPitch: number;
  shape: 'square' | 'round' | 'rect';
}

export const LABEL_TEMPLATES: LabelTemplate[] = [
  {
    id: 'avery-22805',
    name: 'Avery 22805 · 1½″ square · 24 per sheet (weatherproof)',
    cols: 4,
    rows: 6,
    width: 1.5,
    height: 1.5,
    left: 0.625,
    top: 0.625,
    hPitch: 1.9167,
    vPitch: 1.65,
    shape: 'square',
  },
  {
    id: 'avery-22806',
    name: 'Avery 22806 · 2″ square · 12 per sheet',
    cols: 3,
    rows: 4,
    width: 2,
    height: 2,
    left: 0.625,
    top: 0.625,
    hPitch: 2.625,
    vPitch: 2.5833,
    shape: 'square',
  },
  {
    id: 'avery-22807',
    name: 'Avery 22807 · 2″ round · 12 per sheet',
    cols: 3,
    rows: 4,
    width: 2,
    height: 2,
    left: 0.625,
    top: 0.625,
    hPitch: 2.625,
    vPitch: 2.5833,
    shape: 'round',
  },
  {
    id: 'avery-5160',
    name: 'Avery 5160 / 18160 · 1″ × 2⅝″ · 30 per sheet',
    cols: 3,
    rows: 10,
    width: 2.625,
    height: 1,
    left: 0.1875,
    top: 0.5,
    hPitch: 2.75,
    vPitch: 1,
    shape: 'rect',
  },
];

export const templateById = (id: string) => LABEL_TEMPLATES.find((t) => t.id === id) ?? LABEL_TEMPLATES[0];

export interface LabelItem {
  name: string;
  code: string;
}

export interface LabelOptions {
  template: LabelTemplate;
  baseUrl: string;
  orgName: string;
  /** 1-based position of the first free label on a partly used sheet. */
  startAt: number;
  offsetX: number;
  offsetY: number;
  outlines: boolean;
}

function fitText(pdf: import('jspdf').jsPDF, text: string, maxWidth: number) {
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && pdf.getTextWidth(`${t}…`) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

export async function buildLabelPdf(items: LabelItem[], opts: LabelOptions): Promise<Blob> {
  const [{ jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);
  const pdf = new jsPDF({ unit: 'in', format: 'letter' });
  const t = opts.template;
  const perSheet = t.cols * t.rows;
  let slot = Math.max(0, Math.min(perSheet - 1, opts.startAt - 1));

  for (let i = 0; i < items.length; i++) {
    if (slot === perSheet) {
      pdf.addPage();
      slot = 0;
    }
    const col = slot % t.cols;
    const row = Math.floor(slot / t.cols);
    const x = t.left + col * t.hPitch + opts.offsetX;
    const y = t.top + row * t.vPitch + opts.offsetY;
    const item = items[i];
    const png = await QRCode.toDataURL(qrUrl(opts.baseUrl, item.code), {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 600,
    });

    if (opts.outlines) {
      pdf.setDrawColor(180);
      pdf.setLineWidth(0.005);
      if (t.shape === 'round') pdf.circle(x + t.width / 2, y + t.height / 2, t.width / 2);
      else pdf.roundedRect(x, y, t.width, t.height, 0.06, 0.06);
    }

    pdf.setTextColor(20);
    if (t.shape === 'rect') {
      // QR on the left, text on the right.
      const pad = 0.08;
      const qr = t.height - pad * 2;
      pdf.addImage(png, 'PNG', x + pad, y + pad, qr, qr);
      const tx = x + pad * 2 + qr;
      const tw = t.width - qr - pad * 3;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.text(fitText(pdf, item.name, tw), tx, y + 0.32);
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(10);
      pdf.text(item.code, tx, y + 0.55);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.text(fitText(pdf, opts.orgName, tw), tx, y + 0.78);
    } else {
      // QR centred with name and code underneath. Round labels need a smaller
      // QR so the corners stay inside the circle.
      const qr = t.shape === 'round' ? t.width * 0.56 : t.width * 0.66;
      const qx = x + (t.width - qr) / 2;
      const qy = y + (t.shape === 'round' ? t.height * 0.13 : t.height * 0.07);
      pdf.addImage(png, 'PNG', qx, qy, qr, qr);
      const textWidth = t.shape === 'round' ? t.width * 0.62 : t.width - 0.12;
      const fs = t.width >= 2 ? 9 : 7;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(fs);
      pdf.text(fitText(pdf, item.name, textWidth), x + t.width / 2, qy + qr + 0.14, { align: 'center' });
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(fs);
      pdf.text(item.code, x + t.width / 2, qy + qr + 0.14 + fs / 72 + 0.02, { align: 'center' });
    }
    slot++;
  }
  return pdf.output('blob');
}
