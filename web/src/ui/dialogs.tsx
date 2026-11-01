import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Dialog } from './Dialog';

/** Promise-based confirm / prompt dialogs rendered by <DialogHost/>. */
type Req =
  | { kind: 'confirm'; title: string; message?: ReactNode; confirmText?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; message?: ReactNode; initial?: string; placeholder?: string; confirmText?: string; selectStem?: boolean; validate?: (v: string) => string | null; resolve: (v: string | null) => void };

let current: Req | null = null;
const ls = new Set<() => void>();
const set = (r: Req | null) => {
  current = r;
  ls.forEach((l) => l());
};

export function confirmDialog(opts: { title: string; message?: ReactNode; confirmText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => set({ kind: 'confirm', ...opts, resolve }));
}

export function promptDialog(opts: { title: string; message?: ReactNode; initial?: string; placeholder?: string; confirmText?: string; selectStem?: boolean; validate?: (v: string) => string | null }): Promise<string | null> {
  return new Promise((resolve) => set({ kind: 'prompt', ...opts, resolve }));
}

export function DialogHost() {
  const req = useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => current,
  );
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Req | null>(null);

  useEffect(() => {
    if (req) {
      setSnapshot(req);
      setOpen(true);
      setErr(null);
      if (req.kind === 'prompt') setValue(req.initial ?? '');
    }
  }, [req]);

  const finish = (v: boolean | string | null) => {
    if (!snapshot) return;
    if (snapshot.kind === 'confirm') snapshot.resolve(v as boolean);
    else snapshot.resolve(v as string | null);
    setOpen(false);
    set(null);
  };

  const r = snapshot;
  const submit = () => {
    if (!r) return;
    if (r.kind === 'confirm') return finish(true);
    const v = value.trim();
    const e = r.validate?.(v) ?? (v ? null : '不能为空');
    if (e) return setErr(e);
    finish(v);
  };

  return (
    <Dialog
      open={open}
      onClose={() => finish(r?.kind === 'confirm' ? false : null)}
      title={r?.title}
      subtitle={r?.kind === 'confirm' ? undefined : undefined}
      width={400}
      sheetOnMobile={false}
      hideClose
      actions={
        <>
          <button className="btn btn-tonal" onClick={() => finish(r?.kind === 'confirm' ? false : null)}>
            取消
          </button>
          <button className={`btn ${r?.kind === 'confirm' && r.danger ? 'btn-danger' : 'btn-filled'}`} onClick={submit}>
            {r?.confirmText ?? '确定'}
          </button>
        </>
      }
    >
      {r?.message && <div className="c-variant t-subhead" style={{ marginBottom: r.kind === 'prompt' ? 14 : 0 }}>{r.message}</div>}
      {r?.kind === 'prompt' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className={`input${err ? ' invalid' : ''}`}
            value={value}
            placeholder={r.placeholder}
            autoFocus
            onFocus={(e) => {
              if (r.selectStem) {
                const dot = e.target.value.lastIndexOf('.');
                e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
              } else e.target.select();
            }}
            onChange={(e) => {
              setValue(e.target.value);
              setErr(null);
            }}
          />
          {err && <div className="field-error">{err}</div>}
        </form>
      )}
    </Dialog>
  );
}
