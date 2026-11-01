import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Dices, Download, ExternalLink, Eye, Hash, KeyRound, Link2, MessageSquareText, Timer, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { patch, post } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { iconFor } from '../lib/fileIcons';
import { queryClient } from '../lib/queryClient';
import { usePrefs } from '../lib/session';
import type { FsItem, Preferences, Share } from '../lib/types';
import { Segmented, Switch } from '../ui/controls';
import { Dialog } from '../ui/Dialog';
import { springSoft } from '../ui/motion';
import { toast, toastError } from '../ui/Toast';
import { copyText, shareUrl } from './actions';

type ExpireOpt = 'never' | '1h' | '1d' | '7d' | '30d' | 'custom';
const EXPIRE_MS: Record<Exclude<ExpireOpt, 'never' | 'custom'>, number> = { '1h': 3600_000, '1d': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 };

const randomCode = () => {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(4));
  return [...b].map((x) => a[x % a.length]).join('');
};

const toLocalInput = (ts: number) => {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

interface Form {
  expire: ExpireOpt;
  customAt: string;
  usePassword: boolean;
  password: string;
  allowDownload: boolean;
  allowPreview: boolean;
  limitDownloads: boolean;
  maxDownloads: number;
  limitViews: boolean;
  maxViews: number;
  note: string;
}

function initialForm(prefs: Preferences, share?: Share | null): Form {
  if (share) {
    return {
      expire: share.expiresAt ? 'custom' : 'never',
      customAt: toLocalInput(share.expiresAt ?? Date.now() + 7 * 86400_000),
      usePassword: share.hasPassword,
      password: '',
      allowDownload: share.allowDownload,
      allowPreview: share.allowPreview,
      limitDownloads: !!share.maxDownloads,
      maxDownloads: share.maxDownloads ?? 10,
      limitViews: !!share.maxViews,
      maxViews: share.maxViews ?? 100,
      note: share.note,
    };
  }
  return {
    expire: prefs.shareDefaultExpire,
    customAt: toLocalInput(Date.now() + 3 * 86400_000),
    usePassword: prefs.shareDefaultPassword === 'random',
    password: prefs.shareDefaultPassword === 'random' ? randomCode() : '',
    allowDownload: prefs.shareDefaultAllowDownload,
    allowPreview: true,
    limitDownloads: false,
    maxDownloads: 10,
    limitViews: false,
    maxViews: 100,
    note: '',
  };
}

export function ShareDialog({ item, share, onClose }: { item?: FsItem | null; share?: Share | null; onClose: () => void }) {
  const [prefs] = usePrefs();
  const open = !!item || !!share;
  const [form, setForm] = useState<Form>(() => initialForm(prefs, share));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ share: Share; password: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open) {
      setForm(initialForm(prefs, share));
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id, share?.id]);

  const expiresAt = (): number | null => {
    if (form.expire === 'never') return null;
    if (form.expire === 'custom') return new Date(form.customAt).getTime();
    return Date.now() + EXPIRE_MS[form.expire];
  };

  const submit = async () => {
    const at = expiresAt();
    if (at !== null && (!Number.isFinite(at) || at <= Date.now())) return toast.error('到期时间必须晚于当前时间');
    if (form.usePassword && !share?.hasPassword && !form.password.trim()) return toast.error('请输入访问密码');
    setBusy(true);
    try {
      const body = {
        expiresAt: at,
        allowDownload: form.allowDownload,
        allowPreview: form.allowPreview,
        maxDownloads: form.limitDownloads ? form.maxDownloads : null,
        maxViews: form.limitViews ? form.maxViews : null,
        note: form.note,
        // edit: undefined keeps the current password
        password: form.usePassword ? (form.password.trim() ? form.password.trim() : share ? undefined : '') : share?.hasPassword ? null : undefined,
      };
      let saved: Share;
      if (share) saved = await patch<Share>(`/api/shares/${share.id}`, body);
      else saved = await post<Share>('/api/shares', { ...body, targetType: item!.kind, targetId: item!.id });
      void queryClient.invalidateQueries({ queryKey: ['shares'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      if (share) {
        toast.success('分享设置已保存');
        onClose();
      } else setResult({ share: saved, password: form.usePassword ? form.password.trim() : '' });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const name = share?.name ?? item?.name ?? '';
  const Icon = item ? iconFor(item) : share ? iconFor({ kind: share.targetType, category: share.category, ext: share.name.split('.').pop() ?? '' }) : Link2;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={500}
      icon={
        <span className="glyph-well" style={{ background: 'var(--float-block)' }}>
          <Icon />
        </span>
      }
      title={result ? '分享链接已创建' : share ? '编辑分享' : '创建分享链接'}
      subtitle={<span className="ellipsis" style={{ display: 'block' }}>{name}</span>}
      actions={
        result ? (
          <>
            <a className="btn btn-tonal" href={result.share.url} target="_blank" rel="noreferrer">
              <ExternalLink /> 打开
            </a>
            <button className="btn btn-filled" onClick={onClose}>
              完成
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-tonal" onClick={onClose}>
              取消
            </button>
            <button className="btn btn-filled" onClick={submit} disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 16, height: 16 }} /> : share ? <Check /> : <Link2 />}
              {share ? '保存' : '创建链接'}
            </button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {result ? (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={springSoft}>
            <ShareResult share={result.share} password={result.password} />
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.15 }} className="col" style={{ gap: 14, paddingBottom: 4 }}>
            <div>
              <div className="field-label row">
                <Timer size={15} /> 有效期
              </div>
              <Segmented
                size="small"
                fill
                value={form.expire}
                onChange={(v) => set('expire', v)}
                options={[
                  { value: 'never', label: '永久' },
                  { value: '1h', label: '1小时' },
                  { value: '1d', label: '1天' },
                  { value: '7d', label: '7天' },
                  { value: '30d', label: '30天' },
                  { value: 'custom', label: '自定义' },
                ]}
              />
              <AnimatePresence initial={false}>
                {form.expire === 'custom' && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                    <input className="input" type="datetime-local" style={{ marginTop: 8 }} value={form.customAt} min={toLocalInput(Date.now())} onChange={(e) => set('customAt', e.target.value)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="group">
              <div className="set-row has-icon">
                <span className="glyph-well">
                  <KeyRound />
                </span>
                <span className="set-row-text">
                  <span className="set-row-title">访问密码</span>
                  <span className="set-row-sub">{share?.hasPassword && form.usePassword ? '已设置，留空则保持不变' : '访客需输入密码才能查看'}</span>
                </span>
                <Switch checked={form.usePassword} onChange={(v) => setForm((f) => ({ ...f, usePassword: v, password: v && !f.password && !share?.hasPassword ? randomCode() : f.password }))} label="访问密码" />
              </div>
              <AnimatePresence initial={false}>
                {form.usePassword && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                    <div className="set-row-block row">
                      <input className="input mono" style={{ background: 'var(--float)' }} value={form.password} maxLength={64} placeholder={share?.hasPassword ? '输入新密码以修改' : '设置访问密码'} onChange={(e) => set('password', e.target.value)} />
                      <button className="icon-btn" title="随机生成" aria-label="随机生成" onClick={() => set('password', randomCode())}>
                        <Dices />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="set-row has-icon">
                <span className="glyph-well">
                  <Download />
                </span>
                <span className="set-row-text">
                  <span className="set-row-title">允许下载</span>
                </span>
                <Switch checked={form.allowDownload} onChange={(v) => set('allowDownload', v)} label="允许下载" />
              </div>
              <div className="set-row has-icon">
                <span className="glyph-well">
                  <Eye />
                </span>
                <span className="set-row-text">
                  <span className="set-row-title">允许在线预览</span>
                </span>
                <Switch checked={form.allowPreview} onChange={(v) => set('allowPreview', v)} label="允许在线预览" />
              </div>
              <LimitRow icon={Hash} title="限制下载次数" on={form.limitDownloads} value={form.maxDownloads} onToggle={(v) => set('limitDownloads', v)} onValue={(v) => set('maxDownloads', v)} unit="次下载" />
              <LimitRow icon={Users} title="限制访问次数" on={form.limitViews} value={form.maxViews} onToggle={(v) => set('limitViews', v)} onValue={(v) => set('maxViews', v)} unit="次访问" />
            </div>

            <div>
              <div className="field-label row">
                <MessageSquareText size={15} /> 分享备注
              </div>
              <textarea className="textarea" style={{ minHeight: 64 }} maxLength={500} placeholder="对访客可见的说明（可选）" value={form.note} onChange={(e) => set('note', e.target.value)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
}

function LimitRow({ icon: Icon, title, on, value, onToggle, onValue, unit }: { icon: typeof Hash; title: string; on: boolean; value: number; onToggle: (v: boolean) => void; onValue: (v: number) => void; unit: string }) {
  return (
    <div className="set-row has-icon">
      <span className="glyph-well">
        <Icon />
      </span>
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
      </span>
      <AnimatePresence initial={false}>
        {on && (
          <motion.span className="row" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} style={{ gap: 6 }}>
            <input className="input num" type="number" min={1} style={{ width: 84, height: 36, background: 'var(--float)', textAlign: 'center' }} value={value} onChange={(e) => onValue(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label={title} />
            <span className="t-caption c-variant">{unit}</span>
          </motion.span>
        )}
      </AnimatePresence>
      <Switch checked={on} onChange={onToggle} label={title} />
    </div>
  );
}

export function CopyButton({ text, label = '复制', copiedLabel = '已复制', className = 'btn btn-filled' }: { text: string; label?: string; copiedLabel?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <motion.button
      layout
      className={className}
      style={copied ? { ['--btn-bg' as string]: 'var(--success)', ['--btn-fg' as string]: '#fff' } : undefined}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) setCopied(true);
        else toast.error('复制失败，请手动复制');
      }}
      transition={springSoft}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={copied ? 'ok' : 'copy'} initial={{ scale: 0.4, opacity: 0, rotate: -30 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: 'spring', bounce: 0.5, duration: 0.4 }} style={{ display: 'grid' }}>
          {copied ? <Check /> : <Copy />}
        </motion.span>
      </AnimatePresence>
      <motion.span layout="position">{copied ? copiedLabel : label}</motion.span>
    </motion.button>
  );
}

export function ShareResult({ share, password }: { share: Share; password: string }) {
  const url = shareUrl(share.token);
  const full = password ? `链接：${url}\n访问密码：${password}` : url;
  return (
    <div className="col" style={{ gap: 14, paddingBottom: 4 }}>
      <motion.div className="row" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }} style={{ justifyContent: 'center', padding: '6px 0 2px' }}>
        <span className="chip chip-success" style={{ height: 28, padding: '0 12px', fontSize: 13 }}>
          <Check size={15} /> 任何人都可以通过链接访问
        </span>
      </motion.div>
      <div className="well row" style={{ padding: 6, paddingLeft: 14, borderRadius: 18, background: 'var(--float-block)' }}>
        <Link2 size={17} className="c-variant" style={{ flex: 'none' }} />
        <span className="mono ellipsis grow t-footnote" title={url}>
          {url}
        </span>
        <CopyButton text={url} label="复制" />
      </div>
      {password && (
        <div className="well row" style={{ padding: 6, paddingLeft: 14, borderRadius: 18, background: 'var(--float-block)' }}>
          <KeyRound size={17} className="c-variant" style={{ flex: 'none' }} />
          <span className="t-footnote c-variant">访问密码</span>
          <span className="mono w-600 grow">{password}</span>
          <CopyButton text={full} label="复制链接和密码" className="btn btn-tonal-primary btn-sm" />
        </div>
      )}
      <div className="row t-footnote c-variant" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="chip">{share.expiresAt ? `${formatDateTime(share.expiresAt)} 到期` : '永久有效'}</span>
        <span className="chip">{share.allowDownload ? '允许下载' : '仅预览'}</span>
        {share.maxDownloads && <span className="chip">最多 {share.maxDownloads} 次下载</span>}
        {share.maxViews && <span className="chip">最多 {share.maxViews} 次访问</span>}
      </div>
    </div>
  );
}
