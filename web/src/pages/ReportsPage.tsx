import { useParams, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '../components/ui';
import { DateRangePicker, GearFilters, useDateRange, useGearFilter } from '../reports/common';
import { InventoryReport } from '../reports/InventoryReport';
import { LifespanReport } from '../reports/LifespanReport';
import { UsageReport } from '../reports/UsageReport';
import { InspectionReport } from '../reports/InspectionReport';
import { WorkOrderReport } from '../reports/WorkOrderReport';

const TABS = {
  inventory: 'Inventory',
  replacement: 'Age & replacement',
  usage: 'Usage',
  inspections: 'Inspections',
  'work-orders': 'Work orders',
} as const;
type Tab = keyof typeof TABS;
const DATED: Tab[] = ['usage', 'inspections', 'work-orders'];

export function ReportsPage() {
  const { tab: tabParam } = useParams();
  const tab = (tabParam && tabParam in TABS ? tabParam : 'inventory') as Tab;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filter = useGearFilter();
  const range = useDateRange();

  return (
    <div>
      <PageHeader title="Reports" subtitle="Filter by program, category or location; every table exports to CSV or Excel." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
        {Object.entries(TABS).map(([k, label]) => (
          <button
            key={k}
            // Keep filters when switching tabs.
            onClick={() => navigate({ pathname: `/reports/${k}`, search: params.toString() })}
            className={`border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${k === tab ? 'border-brand-700 text-brand-800' : 'border-transparent text-stone-600 hover:text-stone-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {DATED.includes(tab) && <DateRangePicker r={range} />}
        <GearFilters f={filter} />
      </div>
      {tab === 'inventory' && <InventoryReport gear={filter.gear} />}
      {tab === 'replacement' && <LifespanReport gear={filter.gear} />}
      {tab === 'usage' && <UsageReport gear={filter.gear} range={range} />}
      {tab === 'inspections' && <InspectionReport gear={filter.gear} range={range} />}
      {tab === 'work-orders' && <WorkOrderReport gear={filter.gear} range={range} />}
    </div>
  );
}
