import { useMemo } from 'react';
import { Link } from 'react-router';
import { ClipboardCheck } from 'lucide-react';
import { kitIsLive, scheduleKind, scheduleStatus, todayIso, type Gear, type InUse, type WithId } from '@gear/shared';
import { useData } from '../data/DataProvider';
import { Card, LinkButton } from '../components/ui';
import { KindTag, intervalText, useInUse, useInspectionSummaries, useRecentlyInspected } from '../inspections/common';
import type { KitDoc } from './common';
import { fmtDate } from '../lib/format';

export interface KitCheck {
  gear: Gear & WithId;
  formId: string;
  formName: string;
  kind: 'in_service' | 'in_depth';
  /** What makes it due: overdue, due today, needed before check-out, or an in-depth inspection for maintenance. */
  why: 'overdue' | 'due' | 'checkout' | 'in_depth';
}

/** Out, or its dates have started (so its gear counts as in use). */
export function kitIsOut(kit: KitDoc, today = todayIso()): boolean {
  return kit.status === 'checked_out' || (kitIsLive(kit, today) && !!(kit.startDate || kit.endDate) && (!kit.startDate || kit.startDate <= today));
}

export const inspectLink = (gearId: string, kitId: string, formId?: string) =>
  `/gear/${gearId}/inspect?${new URLSearchParams(formId ? { form: formId, kit: kitId } : { kit: kitId })}`;

/**
 * The checks this kit's gear needs now. Once the kit is out (or its dates
 * have started) that's the in-service checks due for whoever has it; before
 * then it's the ones that will be due when it goes out today, plus any
 * product set to need a check before each check-out.
 */
export function useKitChecks(kit: KitDoc, items: (Gear & WithId)[]): KitCheck[] {
  const { products, inspectionForms } = useData();
  const inUse = useInUse();
  const summaries = useInspectionSummaries();
  const recentlyDone = useRecentlyInspected();
  return useMemo(() => {
    if (kit.status === 'returned') return [];
    const today = todayIso();
    const out = kitIsOut(kit, today);
    // Not out yet: work out what will be due on the day it goes out.
    const day = !out && kit.startDate && kit.startDate > today ? kit.startDate : today;
    const asIfOut: InUse = { since: day, holderIds: [kit.ownerId] };
    const checks: KitCheck[] = [];
    for (const g of items) {
      if (g.status === 'retired') continue;
      const product = g.productId ? products.get(g.productId) : undefined;
      for (const s of product?.inspectionSchedules ?? []) {
        const form = inspectionForms.get(s.formId);
        if (!form || recentlyDone(g.id, s.formId, today)) continue;
        const base = { gear: g, formId: s.formId, formName: form.name, kind: scheduleKind(s) };
        if (base.kind === 'in_depth') {
          if (summaries.get(g.id)?.schedules.find((x) => x.schedule.formId === s.formId)?.state === 'overdue') checks.push({ ...base, why: 'in_depth' });
          continue;
        }
        const st = out ? scheduleStatus(g, s, today, inUse.get(g.id) ?? asIfOut) : scheduleStatus(g, s, day, asIfOut);
        if (st.state === 'overdue') checks.push({ ...base, why: 'overdue' });
        else if (st.state === 'due_soon') checks.push({ ...base, why: 'due' });
        else if (!out && s.beforeEachCheckout && (g.inspectionState?.[s.formId]?.lastDate ?? '') < today) checks.push({ ...base, why: 'checkout' });
      }
    }
    const rank = { overdue: 0, due: 1, checkout: 2, in_depth: 3 };
    return checks.sort((a, b) => rank[a.why] - rank[b.why] || a.gear.name.localeCompare(b.gear.name, undefined, { numeric: true }));
  }, [kit, items, products, inspectionForms, inUse, summaries, recentlyDone]);
}

const WHY: Record<KitCheck['why'], [string, string]> = {
  overdue: ['Overdue', 'text-red-700'],
  due: ['Due today', 'text-amber-700'],
  checkout: ['Before check-out', 'text-amber-700'],
  in_depth: ['In-depth overdue — maintenance', 'text-red-700'],
};

/** Card on the kit page: the checks to do, with one tap to start each. */
export function KitChecksCard({ kit, items }: { kit: KitDoc; items: (Gear & WithId)[] }) {
  const { products } = useData();
  const checks = useKitChecks(kit, items);
  if (kit.status === 'returned') return null;
  const todo = checks.filter((c) => c.why !== 'in_depth');
  const maintenance = checks.filter((c) => c.why === 'in_depth');
  const hasInService = items.some((g) => (g.productId ? products.get(g.productId)?.inspectionSchedules ?? [] : []).some((s) => scheduleKind(s) === 'in_service'));
  if (!checks.length && !hasInService) return null;
  const out = kitIsOut(kit);
  const today = todayIso();
  const goesOut = kit.startDate && kit.startDate > today ? `on ${fmtDate(kit.startDate)}` : 'today';

  return (
    <Card
      title={todo.length ? `Checks to do (${todo.length})` : 'Checks'}
      actions={
        todo.length > 0 && (
          <LinkButton size="sm" variant="primary" to={inspectLink(todo[0].gear.id, kit.id, todo[0].formId)}>
            <ClipboardCheck size={14} /> {todo.length > 1 ? 'Start checks' : 'Inspect'}
          </LinkButton>
        )
      }
    >
      {todo.length === 0 && (
        <p className="text-sm text-stone-600">
          {out ? 'All in-service checks are done for today.' : 'Nothing needs checking before this kit goes out.'}
        </p>
      )}
      {todo.length > 0 && (
        <>
          <p className="mb-2 text-xs text-stone-500">
            {out ? 'Due now for the gear in this kit.' : `Due when this kit goes out ${goesOut}.`} Each check brings you back here when it’s done.
          </p>
          <ul className="divide-y divide-stone-100">
            {todo.map((c) => (
              <CheckRow key={`${c.gear.id}-${c.formId}`} c={c} kitId={kit.id} />
            ))}
          </ul>
        </>
      )}
      {maintenance.length > 0 && (
        <div className="mt-3 border-t border-stone-100 pt-3">
          <p className="mb-1 text-xs font-medium text-stone-600">Needs maintenance before use</p>
          <ul className="divide-y divide-stone-100">
            {maintenance.map((c) => (
              <CheckRow key={`${c.gear.id}-${c.formId}`} c={c} kitId={kit.id} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function CheckRow({ c, kitId }: { c: KitCheck; kitId: string }) {
  const { products } = useData();
  const schedule = c.gear.productId ? products.get(c.gear.productId)?.inspectionSchedules?.find((s) => s.formId === c.formId) : undefined;
  const [label, tone] = WHY[c.why];
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{c.gear.name}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
          <KindTag kind={c.kind} /> {c.formName}
          {c.kind === 'in_service' && schedule && <span>· {intervalText(schedule.everyDaysInUse)}</span>}
          <span className={`whitespace-nowrap ${tone}`}>· {label}</span>
        </div>
      </div>
      <Link className="link shrink-0 text-sm" to={inspectLink(c.gear.id, kitId, c.formId)}>
        Inspect
      </Link>
    </li>
  );
}
