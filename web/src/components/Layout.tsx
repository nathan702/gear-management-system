import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
  Boxes,
  ClipboardCheck,
  CloudOff,
  Home,
  LogOut,
  Menu,
  Package,
  QrCode,
  RefreshCw,
  Settings,
  Tags,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import { useAuth, useMe } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { usePhotoQueueCount } from '../photos/photoQueue';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export function Layout() {
  const { signOut } = useAuth();
  const { profile, isAdmin, isManager } = useMe();
  const { settings, pendingWrites } = useData();
  const online = useOnline();
  const queuedPhotos = usePhotoQueueCount();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const main: NavItem[] = [
    { to: '/', label: 'Home', icon: <Home size={18} />, end: true },
    { to: '/gear', label: 'Gear', icon: <Boxes size={18} /> },
    { to: '/scan', label: 'Scan', icon: <QrCode size={18} /> },
    { to: '/inspections', label: 'Inspections', icon: <ClipboardCheck size={18} /> },
    { to: '/products', label: 'Products', icon: <Package size={18} /> },
  ];
  const manage: NavItem[] = [
    ...(isManager
      ? [
          { to: '/admin/reference', label: 'Lists & categories', icon: <Tags size={18} /> },
          { to: '/admin/import-export', label: 'Import / export', icon: <Upload size={18} /> },
        ]
      : []),
    ...(isAdmin
      ? [
          { to: '/admin/users', label: 'Users', icon: <Users size={18} /> },
          { to: '/admin/settings', label: 'Settings', icon: <Settings size={18} /> },
        ]
      : []),
  ];

  const navLink = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
          isActive ? 'bg-brand-700 text-white' : 'text-stone-700 hover:bg-stone-200/60'
        }`
      }
    >
      {item.icon}
      {item.label}
    </NavLink>
  );

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2 px-2">
        <img src="/icon.svg" alt="" className="size-8" />
        <div className="leading-tight">
          <div className="font-semibold">{settings.orgName} Gear</div>
          <div className="text-xs text-stone-500">Equipment & repairs</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1">{main.map(navLink)}</nav>
      {manage.length > 0 && (
        <nav className="flex flex-col gap-1">
          <div className="px-3 text-xs font-semibold tracking-wide text-stone-500 uppercase">Manage</div>
          {manage.map(navLink)}
        </nav>
      )}
      <div className="mt-auto flex flex-col gap-1 border-t border-stone-200 pt-4">
        {navLink({ to: '/me', label: profile.displayName || 'My profile', icon: <User size={18} /> })}
        <button
          onClick={() => signOut()}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-200/60"
        >
          <LogOut size={18} /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-stone-200 bg-stone-50 md:block">{sidebar}</aside>

      {/* Mobile slide-over menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-stone-900/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-stone-50 shadow-xl">
            <button className="absolute top-4 right-4 p-1" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col pb-20 md:pb-0">
        {(!online || pendingWrites || queuedPhotos > 0) && (
          <div className={`flex items-center gap-2 px-4 py-2 text-sm ${online ? 'bg-sky-50 text-sky-900' : 'bg-amber-100 text-amber-900'}`}>
            {online ? <RefreshCw size={16} className="animate-spin" /> : <CloudOff size={16} />}
            {online
              ? `Syncing changes${queuedPhotos ? ` and ${queuedPhotos} photo${queuedPhotos === 1 ? '' : 's'}` : ''}…`
              : `Offline — changes are saved on this device and will sync when you reconnect${
                  queuedPhotos ? ` (${queuedPhotos} photo${queuedPhotos === 1 ? '' : 's'} waiting)` : ''
                }.`}
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {[...main.slice(0, 2), main[2], main[3]].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-brand-700' : 'text-stone-500'}`
            }
          >
            {item.to === '/scan' ? (
              <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg">
                <QrCode size={22} />
              </span>
            ) : (
              item.icon
            )}
            {item.label}
          </NavLink>
        ))}
        <button onClick={() => setMenuOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-stone-500">
          <Menu size={18} />
          More
        </button>
      </nav>
    </div>
  );
}
