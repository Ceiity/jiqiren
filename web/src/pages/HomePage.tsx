import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  Clapperboard,
  Clock,
  CloudUpload,
  FileText,
  Files,
  FolderPlus,
  HardDrive,
  History,
  Image,
  Link2,
  ListChecks,
  Moon,
  Sun,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../lib/api';
import { bytesParts, formatBytes, formatCount, formatDate, formatRelative, expiryText } from '../lib/format';
import { iconFor } from '../lib/fileIcons';
import { usePrefs, useUser } from '../lib/session';
import type { FsItem, Overview, Share } from '../lib/types';
import { pickUpload } from '../lib/uploadTarget';
import { uploadSummary, useUploads } from '../lib/uploads';
import { Page } from '../layout/Page';
import { createFolderIn } from '../features/actions';
import { Preview } from '../features/Preview';
import { ShareDialog } from '../features/ShareDialog';
import { FolderPicker } from '../features/FolderPicker';
import { UploadItem } from '../features/UploadPanel';
import { Thumb } from '../features/browser/FileBrowser';
import { Scallop, Blob } from '../ui/controls';
import { Sparkline, lastNDays } from '../ui/Sparkline';
import { cardIn, listStagger } from '../ui/motion';
import { useResolvedDark, withThemeTransition } from '../theme/ThemeProvider';
import { Empty } from '../ui/Empty';

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export function HomePage() {
  const user = useUser();
  const nav = useNavigate();
  const [, updatePrefs] = usePrefs();
  const dark = useResolvedDark();
  const ov = useQuery({ queryKey: ['stats', 'overview'], queryFn: () => get<Overview>('/api/stats/overview') });
  const shares = useQuery({ queryKey: ['shares', 'recent'], queryFn: () => get<{ items: Share[] }>('/api/shares?limit=4') });
  const uploads = useUploads();
  const sum = uploadSummary(uploads);
  const [preview, setPreview] = useState<number | null>(null);
  const [sharePick, setSharePick] = useState(false);
  const [shareItem, setShareItem] = useState<FsItem | null>(null);

  const d = ov.data;
  const days = lastNDays(14);
  const dailyFiles = days.map((day) => d?.daily?.find((x) => x.day === day)?.c ?? 0);
  const dailyBytes = d?.daily?.reduce((a, x) => a + (days.includes(x.day) ? x.b : 0), 0) ?? 0;
  const weekFiles = dailyFiles.slice(-7).reduce((a, b) => a + b, 0);
  const dailyViews = days.map((day) => d?.shareDaily?.find((x) => x.day === day)?.views ?? 0);
  const recentFiles = d?.recent.filter((f) => f.kind === 'file') ?? [];

  return (
    <Page
      title={`${greeting()}，${user.nickname}`}
      subtitle="欢迎使用奶龙云盘"
      actions={
        <button
          className="icon-btn raised"
          aria-label="切换深浅色"
          title="切换深浅色"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            withThemeTransition(() => updatePrefs({ themeMode: dark ? 'light' : 'dark' }), { x: r.left + r.width / 2, y: r.top + r.height / 2 });
          }}
        >
          {dark ? <Sun /> : <Moon />}
        </button>
      }
    >
      <motion.div className="dash" variants={listStagger} initial="hidden" animate="show">
        {/* storage hero */}
        <motion.section variants={cardIn} className="card dash-hero span-6">
          <div className="card-header">
            <HardDrive />
            存储空间
            {d && <StorageChip used={d.usedBytes} quota={d.quotaBytes} />}
          </div>
          <div className="hero-body">
            <div className="col" style={{ gap: 4, minWidth: 0 }}>
              {d ? (
                <div className="big-num">
                  {bytesParts(d.usedBytes)[0]}
                  <small>{bytesParts(d.usedBytes)[1]}</small>
                </div>
              ) : (
                <div className="skeleton" style={{ height: 40, width: 140 }} />
              )}
              <div className="t-footnote c-variant num">
                {d ? (d.quotaBytes ? `共 ${formatBytes(d.quotaBytes)} · 剩余 ${formatBytes(Math.max(0, d.quotaBytes - d.usedBytes))}` : '不限容量') : ' '}
              </div>
              <div className="hero-meta">
                <div>
                  <div className="t-caption c-variant">文件</div>
                  <div className="t-headline num">{d ? formatCount(d.fileCount) : '–'}</div>
                </div>
                <div>
                  <div className="t-caption c-variant">文件夹</div>
                  <div className="t-headline num">{d ? formatCount(d.folderCount) : '–'}</div>
                </div>
                <div>
                  <div className="t-caption c-variant">回收站</div>
                  <div className="t-headline num">{d ? formatBytes(d.trash.bytes) : '–'}</div>
                </div>
              </div>
            </div>
            <div className="hero-art">
              <Blob className="hero-blob" />
              <motion.button className="hero-action" whileHover={{ scale: 1.05, rotate: 8 }} whileTap={{ scale: 0.92 }} transition={{ type: 'spring', bounce: 0.5 }} onClick={() => pickUpload('files', null)} aria-label="上传文件" title="上传文件">
                <Scallop size={92}>
                  <CloudUpload />
                </Scallop>
              </motion.button>
            </div>
          </div>
          {d && <CategoryBar d={d} />}
        </motion.section>

        {/* upload trend */}
        <motion.section variants={cardIn} className="card span-3 trend-card clickable" onClick={() => nav('/files')}>
          <div className="card-header">
            <ArrowUpFromLine />
            近 7 天上传
          </div>
          <div className="big-num">
            {weekFiles}
            <small>个文件</small>
          </div>
          <div className="t-caption c-variant num">14 天共 {formatBytes(dailyBytes)}</div>
          <div className="trend-chart">
            <Sparkline data={dailyFiles} />
          </div>
        </motion.section>

        <motion.section variants={cardIn} className="card span-3 trend-card clickable" onClick={() => nav('/shares')}>
          <div className="card-header">
            <ArrowDownToLine />
            分享访问
          </div>
          <div className="big-num">
            {d ? formatCount(d.shares.views) : '–'}
            <small>次</small>
          </div>
          <div className="t-caption c-variant num">下载 {d ? formatCount(d.shares.downloads) : '–'} 次 · {d?.shares.active ?? 0} 个有效分享</div>
          <div className="trend-chart">
            <Sparkline data={dailyViews} />
          </div>
        </motion.section>

        {/* stats */}
        {[
          { label: '全部文件', icon: Files, count: d?.fileCount, bytes: d?.usedBytes, to: '/files' },
          { label: '图片', icon: Image, count: d?.categories.image?.count ?? 0, bytes: d?.categories.image?.bytes ?? 0, to: '/images' },
          { label: '视频', icon: Clapperboard, count: d?.categories.video?.count ?? 0, bytes: d?.categories.video?.bytes ?? 0, to: '/videos' },
          { label: '文档', icon: FileText, count: d?.categories.document?.count ?? 0, bytes: d?.categories.document?.bytes ?? 0, to: '/documents' },
        ].map((s) => (
          <motion.section key={s.label} variants={cardIn} className="card span-3 stat-card clickable" onClick={() => nav(s.to)}>
            <div className="card-header">
              <s.icon />
              {s.label}
              <span className="spacer" />
              <ChevronRight className="c-variant" style={{ width: 16, height: 16 }} />
            </div>
            <div className="mid-num num">{d ? formatCount(s.count ?? 0) : <span className="skeleton" style={{ display: 'inline-block', height: 28, width: 60 }} />}</div>
            <div className="well stat-well">
              <span className="t-footnote c-variant">占用</span>
              <span className="t-footnote w-600 num">{d ? formatBytes(s.bytes ?? 0) : '–'}</span>
            </div>
          </motion.section>
        ))}

        {/* quick actions */}
        <motion.section variants={cardIn} className="card span-6">
          <div className="card-header">
            <ListChecks />
            快捷操作
          </div>
          <div className="quick-grid">
            <button className="quick on" onClick={() => pickUpload('files', null)}>
              <Upload />
              上传文件
            </button>
            <button className="quick" onClick={() => createFolderIn(null)}>
              <FolderPlus />
              新建文件夹
            </button>
            <button className="quick" onClick={() => setSharePick(true)}>
              <Link2 />
              创建分享
            </button>
            <button className="quick" onClick={() => nav('/shares')}>
              <History />
              分享记录
            </button>
          </div>
        </motion.section>

        {/* uploads */}
        <motion.section variants={cardIn} className="card span-6">
          <div className="card-header">
            <CloudUpload />
            上传任务
            {sum.activeCount > 0 && <span className="chip chip-primary num">{sum.activeCount}</span>}
            <span className="spacer" />
            {sum.activeCount > 0 && <span className="t-caption c-variant num">{Math.round(sum.progress * 100)}%</span>}
          </div>
          {uploads.filter((t) => t.status !== 'canceled').length ? (
            <div className="col dash-uploads">
              {uploads
                .filter((t) => t.status !== 'canceled')
                .slice(-3)
                .reverse()
                .map((t) => (
                  <UploadItem key={t.id} t={t} compact />
                ))}
            </div>
          ) : (
            <div className="well row" style={{ padding: '14px 16px', gap: 12 }}>
              <span className="glyph-well" style={{ background: 'var(--inset)', width: 36, height: 36 }}>
                <CloudUpload size={18} />
              </span>
              <div className="grow">
                <div className="t-subhead w-600">暂无上传任务</div>
                <div className="t-caption c-variant">拖拽文件到窗口任意位置即可上传</div>
              </div>
              <button className="btn btn-sm btn-filled" onClick={() => pickUpload('files', null)}>
                选择文件
              </button>
            </div>
          )}
        </motion.section>

        {/* recent */}
        <motion.section variants={cardIn} className="card span-8 recent-card">
          <div className="card-header">
            <Clock />
            最近文件
            <span className="spacer" />
            <button className="btn btn-sm btn-text" onClick={() => nav('/files')}>
              全部 <ChevronRight />
            </button>
          </div>
          {ov.isLoading && Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 40, margin: '6px 0' }} />)}
          {d && recentFiles.length === 0 && <Empty compact icon={Files} title="还没有文件" subtitle="上传的文件会出现在这里" />}
          {recentFiles.length > 0 && (
            <div className="recent-table">
              <div className="table-head recent-cols">
                <span>名称</span>
                <span className="hide-sm">大小</span>
                <span className="hide-sm">修改时间</span>
              </div>
              {recentFiles.slice(0, 8).map((f, i) => {
                const Icon = iconFor(f);
                return (
                  <button key={f.id} className="table-row recent-cols" onClick={() => setPreview(i)}>
                    <span className="row" style={{ gap: 10 }}>
                      <span className="recent-icon">{f.hasThumb ? <Thumb item={f} size={128} /> : <Icon />}</span>
                      <span className="ellipsis w-500">{f.name}</span>
                    </span>
                    <span className="hide-sm num c-variant t-footnote">{formatBytes(f.size)}</span>
                    <span className="hide-sm c-variant t-footnote">{formatRelative(f.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </motion.section>

        {/* shares */}
        <motion.section variants={cardIn} className="card span-4">
          <div className="card-header">
            <Link2 />
            我的分享
            <span className="count-badge num">{d?.shares.total ?? 0}</span>
            <span className="spacer" />
            <button className="icon-btn sm" onClick={() => nav('/shares')} aria-label="查看全部分享">
              <ChevronRight />
            </button>
          </div>
          <div className="col" style={{ gap: 8 }}>
            {shares.data?.items.length === 0 && <Empty compact icon={Link2} title="还没有分享" subtitle="选择文件后点击分享即可生成外链" />}
            {shares.data?.items.map((s) => (
              <button key={s.id} className="well share-mini" onClick={() => nav('/shares')}>
                <span className="letter-well">{s.name.slice(0, 1).toUpperCase()}</span>
                <span className="col grow" style={{ textAlign: 'left' }}>
                  <span className="t-subhead w-600 ellipsis">{s.name}</span>
                  <span className="t-caption c-variant ellipsis num">
                    {s.viewCount} 次访问 · {s.state === 'active' ? expiryText(s.expiresAt) : '已失效'}
                  </span>
                </span>
                <span className={`dot-state ${s.state}`} />
              </button>
            ))}
          </div>
        </motion.section>
      </motion.div>

      {preview !== null && <Preview files={recentFiles} index={preview} source={{ kind: 'owner' }} onClose={() => setPreview(null)} onShare={(f) => setShareItem(f)} />}
      <FolderPicker
        open={sharePick}
        title="选择要分享的文件夹"
        confirmText="分享此文件夹"
        onClose={() => setSharePick(false)}
        onPick={async (id) => {
          setSharePick(false);
          if (!id) return nav('/files');
          const f = await get<FsItem>(`/api/fs/folders/${id}`);
          setShareItem(f);
        }}
      />
      <ShareDialog item={shareItem} onClose={() => setShareItem(null)} />
    </Page>
  );
}

function StorageChip({ used, quota }: { used: number; quota: number }) {
  if (!quota) return <span className="chip chip-success"><span className="dot" />不限容量</span>;
  const p = used / quota;
  if (p >= 0.95) return <span className="chip chip-error"><span className="dot" />空间不足</span>;
  if (p >= 0.8) return <span className="chip chip-warning"><span className="dot" />即将用满</span>;
  return <span className="chip chip-success"><span className="dot" />空间充足</span>;
}

const CAT_ORDER = ['image', 'video', 'audio', 'document', 'archive', 'other'];
const CAT_NAME: Record<string, string> = { image: '图片', video: '视频', audio: '音频', document: '文档', archive: '压缩包', other: '其他' };
const CAT_ALPHA: Record<string, number> = { image: 1, video: 0.78, audio: 0.6, document: 0.45, archive: 0.32, other: 0.2 };

function CategoryBar({ d }: { d: Overview }) {
  const total = d.quotaBytes || Math.max(d.usedBytes, 1);
  const segs = CAT_ORDER.map((c) => ({ c, b: d.categories[c]?.bytes ?? 0 })).filter((s) => s.b > 0);
  return (
    <div className="cat-bar-wrap">
      <div className="cat-bar">
        {segs.map((s, i) => (
          <motion.i
            key={s.c}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(0.6, (s.b / total) * 100)}%` }}
            transition={{ duration: 0.8, delay: 0.1 + i * 0.05, ease: [0.3, 0, 0, 1] }}
            style={{ background: `color-mix(in srgb, var(--primary) ${CAT_ALPHA[s.c] * 100}%, var(--block))` }}
            title={`${CAT_NAME[s.c]} ${formatBytes(s.b)}`}
          />
        ))}
      </div>
      <div className="cat-legend">
        {segs.slice(0, 5).map((s) => (
          <span key={s.c} className="row t-caption" style={{ gap: 5 }}>
            <span className="legend-dot" style={{ background: `color-mix(in srgb, var(--primary) ${CAT_ALPHA[s.c] * 100}%, var(--block))` }} />
            <span className="c-variant">{CAT_NAME[s.c]}</span>
            <span className="w-600 num">{formatBytes(s.b)}</span>
          </span>
        ))}
        {segs.length === 0 && <span className="t-caption c-variant">暂无文件 · {formatDate(Date.now())}</span>}
      </div>
    </div>
  );
}
