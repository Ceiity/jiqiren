import { Logo } from './Logo';

export function BootScreen() {
  return (
    <div style={{ height: '100dvh', display: 'grid', placeItems: 'center' }}>
      <div className="col" style={{ alignItems: 'center', gap: 14, animation: 'boot-in 400ms var(--ease-out) both' }}>
        <Logo size={56} />
        <div className="spinner c-variant" />
      </div>
      <style>{'@keyframes boot-in{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}'}</style>
    </div>
  );
}
