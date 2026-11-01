import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import { SessionProvider, useSession } from './lib/session';
import { ThemeProvider } from './theme/ThemeProvider';
import { AppShell } from './layout/AppShell';
import { Toaster } from './ui/Toast';
import { DialogHost } from './ui/dialogs';
import { BootScreen } from './ui/BootScreen';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { FilesPage, CategoryPage } from './pages/FilesPage';
import { LoginPage, RegisterPage, SetupPage } from './pages/AuthPages';
import { PublicSharePage } from './pages/PublicSharePage';

const SharesPage = lazy(() => import('./pages/SharesPage').then((m) => ({ default: () => <m.SharesPage /> })));
const TrashPage = lazy(() => import('./pages/TrashPage').then((m) => ({ default: m.TrashPage })));
const StoragePage = lazy(() => import('./pages/StoragePage').then((m) => ({ default: m.StoragePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));

function AdminOnly({ children }: { children: JSX.Element }) {
  const { user } = useSession();
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

function PageFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}>
      <span className="spinner c-variant" />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider>
          <BrowserRouter>
            <ErrorBoundary>
            <Suspense fallback={<BootScreen />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/setup" element={<SetupPage />} />
                <Route path="/s/:token" element={<PublicSharePage />} />
                <Route element={<AppShell />}>
                  <Route index element={<HomePage />} />
                  <Route path="files" element={<FilesPage />} />
                  <Route path="files/:folderId" element={<FilesPage />} />
                  <Route path="images" element={<CategoryPage category="image" />} />
                  <Route path="videos" element={<CategoryPage category="video" />} />
                  <Route path="audio" element={<CategoryPage category="audio" />} />
                  <Route path="documents" element={<CategoryPage category="document" />} />
                  <Route path="shares" element={<Suspense fallback={<PageFallback />}><SharesPage /></Suspense>} />
                  <Route path="trash" element={<Suspense fallback={<PageFallback />}><TrashPage /></Suspense>} />
                  <Route path="storage" element={<Suspense fallback={<PageFallback />}><StoragePage /></Suspense>} />
                  <Route path="settings" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>} />
                  <Route path="admin" element={<AdminOnly><Suspense fallback={<PageFallback />}><AdminPage /></Suspense></AdminOnly>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
          <Toaster />
          <DialogHost />
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
