import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth, useMe } from './auth/AuthProvider';
import { DataProvider, useData } from './data/DataProvider';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { usePhotoUploader } from './photos/photoQueue';
import { LoginPage, DeniedPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { GearListPage } from './pages/GearListPage';
import { GearDetailPage } from './pages/GearDetailPage';
import { GearFormPage } from './pages/GearFormPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { ProductFormPage } from './pages/ProductFormPage';
import { ReferencePage } from './pages/ReferencePage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportExportPage } from './pages/ImportExportPage';
import { ScanPage } from './pages/ScanPage';
import { QrResolvePage } from './pages/QrResolvePage';
import { LabelsPage } from './pages/LabelsPage';
import { ProfilePage } from './pages/ProfilePage';

function SignedInApp() {
  const { uid } = useMe();
  usePhotoUploader(uid);
  return (
    <DataProvider>
      <Loaded>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="gear" element={<GearListPage />} />
            <Route path="gear/new" element={<Manager><GearFormPage /></Manager>} />
            <Route path="gear/:id" element={<GearDetailPage />} />
            <Route path="gear/:id/edit" element={<Manager><GearFormPage /></Manager>} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/new" element={<Manager><ProductFormPage /></Manager>} />
            <Route path="products/:id" element={<ProductDetailPage />} />
            <Route path="products/:id/edit" element={<Manager><ProductFormPage /></Manager>} />
            <Route path="scan" element={<ScanPage />} />
            <Route path="q/:code" element={<QrResolvePage />} />
            <Route path="labels" element={<LabelsPage />} />
            <Route path="me" element={<ProfilePage />} />
            <Route path="admin/reference" element={<Manager><ReferencePage /></Manager>} />
            <Route path="admin/import-export" element={<Manager><ImportExportPage /></Manager>} />
            <Route path="admin/users" element={<Admin><UsersPage /></Admin>} />
            <Route path="admin/settings" element={<Admin><SettingsPage /></Admin>} />
            <Route path="login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<p className="text-stone-600">Page not found.</p>} />
          </Route>
        </Routes>
      </Loaded>
    </DataProvider>
  );
}

function Loaded({ children }: { children: ReactNode }) {
  const { loaded } = useData();
  return loaded ? <>{children}</> : <Spinner label="Loading gear…" />;
}

function Manager({ children }: { children: ReactNode }) {
  return useMe().isManager ? <>{children}</> : <p className="text-stone-600">Only managers and admins can open this page.</p>;
}

function Admin({ children }: { children: ReactNode }) {
  return useMe().isAdmin ? <>{children}</> : <p className="text-stone-600">Only admins can open this page.</p>;
}

export function App() {
  const { state } = useAuth();
  const location = useLocation();
  switch (state.status) {
    case 'loading':
    case 'activating':
      return <Spinner label={state.status === 'activating' ? 'Signing you in…' : 'Loading…'} />;
    case 'signedOut':
      // Remember where a scanned QR link was heading.
      return <LoginPage returnTo={location.pathname + location.search} />;
    case 'denied':
      return <DeniedPage message={state.message} email={state.user.email} />;
    case 'ready':
      return <SignedInApp />;
  }
}
