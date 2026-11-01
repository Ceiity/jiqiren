import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useIsMobile } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Sidebar } from './Sidebar';
import { Dock } from './Dock';
import { UploadPanel } from '../features/UploadPanel';
import { Uploader } from '../features/Uploader';
import { BootScreen } from '../ui/BootScreen';
import { ErrorBoundary } from '../ui/ErrorBoundary';

export function AppShell() {
  const { user, loading, config } = useSession();
  const mobile = useIsMobile();
  const loc = useLocation();
  if (loading) return <BootScreen />;
  if (config?.needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return (
    <div className="shell">
      {!mobile && <Sidebar />}
      <main className="main">
        <ErrorBoundary key={loc.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      {mobile && <Dock />}
      <Uploader />
      <UploadPanel />
    </div>
  );
}
