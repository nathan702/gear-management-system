/**
 * Spreadsheet formats for inspection forms (one row per item, grouped by
 * form name) and the inspection log (export only).
 */
import { FAILURE_OUTCOME_LABELS, STATUS_LABELS } from './constants';
import { newItemId } from './inspections';
import { parseNumber } from './importExport';
import {
  FAILURE_OUTCOMES,
  INSPECTION_ITEM_TYPES,
  type FailureOutcome,
  type Inspection,
  type InspectionForm,
  type InspectionItem,
  type InspectionItemType,
} from './types';

export const FORM_HEADERS = [
  'form',
  'form_description',
  'form_active',
  'item_id',
  'prompt',
  'help',
  'type',
  'failure_outcome',
  'required',
  'min',
  'max',
  'unit',
] as const;

const TYPE_LABELS: Record<InspectionItemType, string> = { pass_fail: 'pass/fail', number: 'number', text: 'text' };

export function formsToRows(forms: (Pick<InspectionForm, 'name' | 'description' | 'active' | 'items'> & { id: string })[]) {
  return forms.flatMap((f) =>
    f.items.map((item) => ({
      form: f.name,
      form_description: f.description ?? '',
      form_active: f.active ? 'yes' : 'no',
      item_id: item.id,
      prompt: item.prompt,
      help: item.help ?? '',
      type: TYPE_LABELS[item.type],
      failure_outcome: item.failureOutcome,
      required: item.required ? 'yes' : 'no',
      min: item.min ?? '',
      max: item.max ?? '',
      unit: item.unit ?? '',
    })),
  );
}

export interface FormImportPlan {
  forms: {
    name: string;
    /** Existing form id when the name matches one. */
    id?: string;
    description: string;
    active: boolean;
    items: InspectionItem[];
    errors: string[];
  }[];
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');

function parseType(raw: string): InspectionItemType | null {
  const v = raw.trim().toLowerCase().replace(/[\s/-]+/g, '_');
  if (!v || v === 'pass_fail' || v === 'passfail' || v === 'check') return 'pass_fail';
  return (INSPECTION_ITEM_TYPES as readonly string[]).includes(v) ? (v as InspectionItemType) : null;
}

function parseOutcome(raw: string): FailureOutcome | null {
  const v = raw.trim().toLowerCase();
  if (!v) return 'has_issues';
  const key = v.replace(/\s+/g, '_');
  if ((FAILURE_OUTCOMES as readonly string[]).includes(key)) return key as FailureOutcome;
  if (key === 'quarantine') return 'quarantined';
  const byLabel = FAILURE_OUTCOMES.find((o) => FAILURE_OUTCOME_LABELS[o].toLowerCase() === v);
  if (byLabel) return byLabel;
  if (v.startsWith('note')) return 'note';
  return null;
}

/**
 * Groups item rows into forms. A form whose name matches an existing form
 * replaces that form's items (keeping item ids given in `item_id`).
 */
export function planFormImport(
  records: Record<string, string>[],
  existing: (Pick<InspectionForm, 'name'> & { id: string })[],
  random: () => number = Math.random,
): FormImportPlan {
  const byName = new Map<string, FormImportPlan['forms'][number]>();
  const existingByName = new Map(existing.map((f) => [f.name.trim().toLowerCase(), f.id]));

  records.forEach((raw, i) => {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) r[norm(k)] = v == null ? '' : String(v).trim();
    const name = r.form;
    const row = i + 2;
    if (!name) return;
    const key = name.toLowerCase();
    if (!byName.has(key))
      byName.set(key, {
        name,
        id: existingByName.get(key),
        description: r.form_description ?? '',
        active: !['no', 'n', 'false', '0'].includes((r.form_active ?? '').toLowerCase()),
        items: [],
        errors: [],
      });
    const form = byName.get(key)!;
    if (!r.prompt) {
      form.errors.push(`row ${row}: prompt is required`);
      return;
    }
    const type = parseType(r.type ?? '');
    const failureOutcome = parseOutcome(r.failure_outcome ?? '');
    const min = parseNumber(r.min ?? '');
    const max = parseNumber(r.max ?? '');
    if (!type) form.errors.push(`row ${row}: type must be pass/fail, number or text`);
    if (!failureOutcome) form.errors.push(`row ${row}: failure_outcome must be note, has_issues or quarantined`);
    if (min === 'invalid' || max === 'invalid') form.errors.push(`row ${row}: min and max must be numbers`);
    let id = (r.item_id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || form.items.some((it) => it.id === id)) id = newItemId(random);
    form.items.push({
      id,
      prompt: r.prompt,
      help: r.help ?? '',
      type: type ?? 'pass_fail',
      failureOutcome: failureOutcome ?? 'has_issues',
      required: !['no', 'n', 'false', '0'].includes((r.required ?? '').toLowerCase()),
      min: typeof min === 'number' ? min : null,
      max: typeof max === 'number' ? max : null,
      unit: r.unit ?? '',
    });
  });
  return { forms: [...byName.values()] };
}

export const INSPECTION_LOG_HEADERS = [
  'inspection_id',
  'date',
  'gear',
  'qr_code',
  'product',
  'form',
  'form_version',
  'inspector',
  'items_failed',
  'failed_items',
  'calculated_status',
  'override_status',
  'override_reason',
  'status_applied',
  'notes',
] as const;

export function inspectionLogRows(
  inspections: (Inspection & { id: string })[],
  lookup: { gear(id: string): { name: string; qrCode: string } | undefined; product(id: string | null): string; user(id: string): string },
) {
  return inspections.map((i) => {
    const g = lookup.gear(i.gearId);
    return {
      inspection_id: i.id,
      date: i.date,
      gear: g?.name ?? '(deleted)',
      qr_code: g?.qrCode ?? '',
      product: lookup.product(i.productId),
      form: i.formName,
      form_version: i.formVersion,
      inspector: lookup.user(i.inspectorId),
      items_failed: i.failedCount,
      failed_items: i.responses
        .filter((r) => r.result === 'fail')
        .map((r) => (r.comment ? `${r.prompt} (${r.comment})` : r.prompt))
        .join('; '),
      calculated_status: STATUS_LABELS[i.calculatedStatus],
      override_status: i.override ? STATUS_LABELS[i.override.status] : '',
      override_reason: i.override?.reason ?? '',
      status_applied: i.statusApplied ? STATUS_LABELS[i.statusApplied] : '',
      notes: i.notes ?? '',
    };
  });
}
