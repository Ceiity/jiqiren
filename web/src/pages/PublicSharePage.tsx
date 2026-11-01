import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Clock, Download, Eye, FileArchive, FolderOpen, HardDrive, Link2Off, Lock, Moon, Sun, TimerOff, Unlock, Maximize2, Ban, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ApiError, browserDownload, get, post, qs } from '../lib/api';
import { expiryText, formatBytes, formatCount, formatDate, formatDateTime } from '../lib/format';
import { iconFor, previewKind, typeLabel } from '../lib/fileIcons';
import { usePrefs, useSession } from '../lib/session';
import type { Crumb, FsItem } from '../lib/types';
import { useResolvedDark, withThemeTransition } from '../theme/ThemeProvider';
import { Avatar, Blob, Scallop } from '../ui/controls';
import { Empty } from '../ui/Empty';
import { Logo } from '../ui/Logo';
import { cardIn, listStagger, springDialog } from '../ui/motion';
import { Preview, fileUrls, type PreviewSource } from '../features/Preview';
import { CopyButton } from '../features/ShareDialog';

interface Meta {
  token: string;
  targetType: 'file' | 'folder';
  name: string;
  note: string;
  createdAt: number;
  expiresAt: number | null;
  needPassword: boolean;
  unlocked: boolean;
  allowDownload: boolean;
  allowPreview: boolean;
  viewCount: number;
  downloadCount: number;
  maxDownloads: number | null;
  sharer: { nickname: string; avatarUrl: string | null };
  item: (FsItem & { fileCount?: number; folderCount?: number }) | null;
}

const ERR_ICON: Record<string, typeof Ban> = {
  SHARE_NOT_FOUND: SearchX,
  SHARE_EXPIRED: TimerOff,
  SHARE_DISABLED: Ban,
  SHARE_EXHAUSTED: Link2Off,
  SHARE_MISSING: Link2Off,
};

export function PublicSharePage() {
  const { token = '' } = useParams();
  const { config } = useSession();
  const [, updatePrefs] = usePrefs();
  const dark = useResolvedDark();
  const qc = useQueryClient();
  const meta = useQuery({
    queryKey: ['public-share', token],
    queryFn: () => get<Meta>(`/api/public/s/${encodeURIComponent(token)}`),
    retry: false,
  });

  useEffect(() => {
    document.body.classList.add('public-page');
    return () => document.body.classList.remove('public-page');
  }, []);
  useEffect(() => {
    if (meta.data) document.title = `${meta.data.name} · ${config?.siteName ?? '奶龙云盘'}`;
  }, [meta.data, config]);

  const err = meta.error as ApiError | null;
  const m = meta.data;

  return (
    <div className="pub">
      <header className="pub-bar">
        <Logo size={30} emoji={config?.siteIcon || undefined} />
        <span className="t-headline">{config?.siteName ?? '奶龙云盘'}</span>
        <span className="spacer" />
        <button
          className="icon-btn raised"
          aria-label="切换深浅色"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            withThemeTransition(() => updatePrefs({ themeMode: dark ? 'light' : 'dark' }), { x: r.left + r.width / 2, y: r.top + r.height / 2 });
          }}
        >
          {dark ? <Sun /> : <Moon />}
        </button>
      </header>
      <main className="pub-main">
        {meta.isLoading && <SkeletonHero />}
        {err && <ShareError code={err.code} message={err.message} />}
        {m && !m.unlocked && <PasswordGate meta={m} onUnlocked={(next) => qc.setQueryData(['public-share', token], next)} />}
        {m && m.unlocked && m.item && <UnlockedShare meta={m} />}
      </main>
      <footer className="pub-foot">由 {config?.siteName ?? '奶龙云盘'} 提供文件分享服务</footer>
    </div>
  );
}

function SkeletonHero() {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="row" style={{ gap: 16 }}>
        <div className="skeleton" style={{ width: 64, height: 64, borderRadius: 18 }} />
        <div className="col grow" style={{ gap: 10 }}>
          <div className="skeleton" style={{ height: 22, width: '50%' }} />
          <div className="skeleton" style={{ height: 14, width: '30%' }} />
        </div>
      </div>
    </div>
  );
}

function ShareError({ code, message }: { code: string; message: string }) {
  const Icon = ERR_ICON[code] ?? Link2Off;
  return (
    <motion.div className="card pub-lock" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={springDialog}>
      <Empty icon={Icon} title={code === 'RATE_LIMITED' ? '访问过于频繁' : '无法访问此分享'} subtitle={message} />
    </motion.div>
  );
}

function PasswordGate({ meta, onUnlocked }: { meta: Meta; onUnlocked: (m: Meta) => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [ok, setOk] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    setBusy(true);
    setErr('');
    try {
      const next = await post<Meta>(`/api/public/s/${meta.token}/unlock`, { password: pw });
      setOk(true);
      setTimeout(() => onUnlocked(next), 420);
    } catch (e) {
      setErr((e as Error).message);
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.div className="card pub-lock" initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={springDialog}>
      <motion.div animate={ok ? { scale: [1, 1.15, 1], rotate: [0, -10, 0] } : {}} transition={{ duration: 0.4 }}>
        <Scallop size={84} color={ok ? 'var(--success)' : 'var(--primary)'}>
          {ok ? <Unlock /> : <Lock />}
        </Scallop>
      </motion.div>
      <div className="t-title3" style={{ marginTop: 8 }}>
        需要访问密码
      </div>
      <div className="row t-footnote c-variant" style={{ justifyContent: 'center', gap: 8 }}>
        <Avatar name={meta.sharer.nickname} url={meta.sharer.avatarUrl} size={22} />
        <span>
          <b style={{ color: 'var(--on-surface)' }}>{meta.sharer.nickname}</b> 分享了加密{meta.targetType === 'folder' ? '文件夹' : '文件'}
        </span>
      </div>
      <form onSubmit={submit} key={shake} className={shake ? 'shake' : ''}>
        <label className="input-wrap">
          <Lock />
          <input className={`input mono${err ? ' invalid' : ''}`} type="password" placeholder="请输入访问密码" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="off" style={{ textAlign: 'left' }} />
        </label>
        {err && <div className="field-error" style={{ textAlign: 'left' }}>{err}</div>}
        <button className="btn btn-filled btn-lg btn-block" disabled={busy || !pw}>
          {busy ? <span className="spinner" style={{ width: 18, height: 18 }} /> : <Unlock />} 解锁查看
        </button>
      </form>
      <div className="t-caption c-variant">{expiryText(meta.expiresAt)}</div>
    </motion.div>
  );
}

function UnlockedShare({ meta }: { meta: Meta }) {
  const item = meta.item!;
  const src: PreviewSource = { kind: 'share', token: meta.token, allowDownload: meta.allowDownload };
  const [preview, setPreview] = useState<{ files: FsItem[]; index: number } | null>(null);
  const Icon = iconFor(item);
  const isFolder = meta.targetType === 'folder';
  const urls = !isFolder ? fileUrls(src, item.id) : null;
  const kind = previewKind(item);
  const downloadAll = () => (isFolder ? browserDownload(`/api/public/s/${meta.token}/zip`) : browserDownload(urls!.download));

  return (
    <motion.div className="col" style={{ gap: 0 }} variants={listStagger} initial="hidden" animate="show">
      <motion.section variants={cardIn} className="card pub-hero" style={{ padding: 24 }}>
        <Blob className="pub-blob" />
        <div style={{ minWidth: 0, zIndex: 1 }}>
          <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
            <span className="glyph-well" style={{ width: 60, height: 60, borderRadius: 18, background: 'var(--block)', color: isFolder ? 'var(--primary)' : undefined }}>
              <Icon size={28} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h1 className="pub-title">{item.name}</h1>
              <div className="t-footnote c-variant num">
                {isFolder ? `${item.fileCount ?? 0} 个文件 · ${item.folderCount ?? 0} 个文件夹 · ${formatBytes(item.size)}` : `${typeLabel(item)} · ${formatBytes(item.size)}`}
              </div>
            </div>
          </div>
          <div className="pub-chips">
            <span className="chip">
              <Clock /> {formatDate(meta.createdAt)} 分享
            </span>
            <span className={`chip ${meta.expiresAt ? 'chip-warning' : 'chip-success'}`}>
              <TimerOff /> {expiryText(meta.expiresAt)}
            </span>
            <span className="chip">
              <Eye /> {formatCount(meta.viewCount)} 次访问
            </span>
            <span className="chip">
              <Download /> {formatCount(meta.downloadCount)}
              {meta.maxDownloads ? ` / ${meta.maxDownloads}` : ''} 次下载
            </span>
          </div>
          <div className="pub-sharer">
            <Avatar name={meta.sharer.nickname} url={meta.sharer.avatarUrl} size={30} />
            <span className="t-footnote">
              <b>{meta.sharer.nickname}</b> <span className="c-variant">分享给你</span>
            </span>
          </div>
          {meta.note && <div className="pub-note">{meta.note}</div>}
        </div>
        <div className="pub-actions">
          {meta.allowDownload ? (
            <>
              <motion.button className="scallop-btn" onClick={downloadAll} whileHover={{ scale: 1.05, rotate: 8 }} whileTap={{ scale: 0.9 }} aria-label="下载">
                <Scallop size={96}>{isFolder ? <FileArchive /> : <Download />}</Scallop>
              </motion.button>
              <button className="btn btn-filled btn-lg" onClick={downloadAll}>
                <Download /> {isFolder ? '打包下载' : '下载文件'}
              </button>
            </>
          ) : (
            <span className="chip" style={{ height: 30 }}>
              分享者未开放下载
            </span>
          )}
          <CopyButton text={window.location.href} label="复制链接" className="btn btn-tonal" />
        </div>
      </motion.section>

      {!isFolder && meta.allowPreview && kind !== 'none' && (
        <motion.section variants={cardIn} className="card pub-preview">
          <div className="card-header">
            <Eye /> 在线预览
            <span className="spacer" />
            <button className="btn btn-sm btn-tonal" onClick={() => setPreview({ files: [item], index: 0 })}>
              <Maximize2 /> 全屏
            </button>
          </div>
          {kind === 'image' && (
            <button className="media" onClick={() => setPreview({ files: [item], index: 0 })} style={{ width: '100%' }}>
              <img src={urls!.content} alt={item.name} />
            </button>
          )}
          {kind === 'video' && (
            <div className="media">
              <video src={urls!.content} controls playsInline preload="metadata" poster={item.hasThumb ? urls!.thumb(1024) : undefined} />
            </div>
          )}
          {kind === 'audio' && (
            <div className="media" style={{ minHeight: 120, padding: 20 }}>
              <audio src={urls!.content} controls preload="metadata" style={{ width: '100%' }} />
            </div>
          )}
          {(kind === 'pdf' || kind === 'text') && (
            <button className="media" style={{ width: '100%', minHeight: 160 }} onClick={() => setPreview({ files: [item], index: 0 })}>
              <span className="col" style={{ alignItems: 'center', gap: 10 }}>
                <span className="glyph-well">
                  <Icon />
                </span>
                <span className="t-subhead w-600">点击在线阅读</span>
              </span>
            </button>
          )}
        </motion.section>
      )}

      {isFolder && <FolderListing meta={meta} src={src} onOpen={(files, index) => setPreview({ files, index })} />}

      <AnimatePresence>{preview && <Preview files={preview.files} index={preview.index} source={src} onClose={() => setPreview(null)} />}</AnimatePresence>
    </motion.div>
  );
}

function FolderListing({ meta, src, onOpen }: { meta: Meta; src: PreviewSource; onOpen: (files: FsItem[], index: number) => void }) {
  const [params, setParams] = useSearchParams();
  const folderId = params.get('f') ?? undefined;
  const list = useInfiniteQuery({
    queryKey: ['public-share', meta.token, 'list', folderId],
    queryFn: ({ pageParam }) => get<{ items: FsItem[]; total: number; nextOffset: number | null; breadcrumbs: Crumb[]; folder: FsItem }>(`/api/public/s/${meta.token}/list${qs({ folderId, offset: pageParam, limit: 200 })}`),
    initialPageParam: 0,
    getNextPageParam: (l) => l.nextOffset ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const crumbs = list.data?.pages[0]?.breadcrumbs ?? [];
  const files = items.filter((i) => i.kind === 'file');
  const go = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id && id !== meta.item?.id) p.set('f', id);
    else p.delete('f');
    setParams(p);
  };
  return (
    <motion.section variants={cardIn} className="card" style={{ marginTop: 'var(--gap)', padding: 12 }}>
      <div className="row" style={{ padding: '4px 4px 10px', gap: 8 }}>
        <nav className="crumbs" style={{ flex: 1 }}>
          {crumbs.map((c, i) => (
            <span key={c.id} className="row" style={{ gap: 2, flex: 'none' }}>
              {i > 0 && <ChevronRight className="crumb-sep" />}
              <button className={`crumb${i === crumbs.length - 1 ? ' current' : ''}`} style={i === crumbs.length - 1 ? { background: 'var(--block)' } : undefined} onClick={() => go(c.id)}>
                {i === 0 && <HardDrive />}
                <span>{c.name}</span>
              </button>
            </span>
          ))}
        </nav>
        {meta.allowDownload && folderId && (
          <button className="btn btn-sm btn-tonal" onClick={() => browserDownload(`/api/public/s/${meta.token}/zip?folderId=${folderId}`)}>
            <FileArchive /> 下载此文件夹
          </button>
        )}
      </div>
      {list.isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 48, margin: '6px 4px' }} />)}
      {!list.isLoading && items.length === 0 && <Empty compact icon={FolderOpen} title="文件夹是空的" />}
      <div className="col" style={{ gap: 2 }}>
        {items.map((it, n) => {
          const I = iconFor(it);
          const urls = it.kind === 'file' ? fileUrls(src, it.id) : null;
          return (
            <motion.div
              key={it.id}
              className={`flist-row${n % 2 ? ' odd' : ''}`}
              style={{ height: 56, gridTemplateColumns: 'minmax(0,1fr) auto auto', cursor: 'pointer', background: n % 2 ? 'color-mix(in srgb, var(--block) 55%, transparent)' : undefined }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(n, 20) * 0.015 }}
              onClick={() => (it.kind === 'folder' ? go(it.id) : meta.allowPreview ? onOpen(files, files.indexOf(it)) : meta.allowDownload && browserDownload(urls!.download))}
            >
              <span className="flist-name">
                <span className={`ficon${it.kind === 'folder' ? ' folder' : ''}`}>{it.kind === 'file' && it.hasThumb && meta.allowPreview ? <img src={urls!.thumb(128)} alt="" loading="lazy" /> : <I />}</span>
                <span className="col" style={{ minWidth: 0 }}>
                  <span className="ellipsis w-500">{it.name}</span>
                  <span className="t-caption c-variant num">{it.kind === 'folder' ? formatDateTime(it.updatedAt) : `${formatBytes(it.size)} · ${formatDateTime(it.updatedAt)}`}</span>
                </span>
              </span>
              <span />
              {it.kind === 'file' && meta.allowDownload ? (
                <button
                  className="icon-btn sm"
                  aria-label="下载"
                  title="下载"
                  onClick={(e) => {
                    e.stopPropagation();
                    browserDownload(urls!.download);
                  }}
                >
                  <Download />
                </button>
              ) : it.kind === 'folder' ? (
                <ChevronRight size={18} className="c-variant" />
              ) : (
                <span />
              )}
            </motion.div>
          );
        })}
      </div>
      {list.hasNextPage && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn-tonal" onClick={() => list.fetchNextPage()}>
            加载更多
          </button>
        </div>
      )}
    </motion.section>
  );
}
