import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, CircleAlert, Pause, Play, RotateCw, X, Trash2, CloudUpload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes, formatDuration } from '../lib/format';
import { iconFor } from '../lib/fileIcons';
import { detectCategory } from '../lib/filetype';
import { uploadStore, uploadSummary, useUploads, type UploadTask } from '../lib/uploads';
import { Progress, Ring } from '../ui/controls';
import { springSoft } from '../ui/motion';

const STATUS_TEXT: Record<UploadTask['status'], string> = {
  queued: '等待中',
  uploading: '上传中',
  paused: '已暂停',
  completing: '校验中',
  done: '已完成',
  error: '失败',
  canceled: '已取消',
};

export function UploadItem({ t, compact }: { t: UploadTask; compact?: boolean }) {
  const pct = t.size ? t.uploaded / t.size : t.status === 'done' ? 1 : 0;
  const Icon = iconFor({ kind: 'file', category: detectCategory(t.name), ext: t.name.split('.').pop()?.toLowerCase() ?? '' });
  const state = t.status === 'done' ? 'success' : t.status === 'error' ? 'error' : t.status === 'paused' || t.status === 'queued' ? 'paused' : undefined;
  let sub: string;
  if (t.status === 'uploading') sub = `${formatBytes(t.uploaded)} / ${formatBytes(t.size)} · ${formatBytes(t.speed)}/s · 剩余 ${formatDuration(t.eta)}`;
  else if (t.status === 'error') sub = t.error ?? '上传失败';
  else if (t.status === 'done') sub = `${formatBytes(t.size)} · ${t.resumed ? '断点续传完成' : '已完成'}`;
  else sub = `${formatBytes(t.uploaded)} / ${formatBytes(t.size)} · ${STATUS_TEXT[t.status]}`;
  if (t.status === 'uploading' && t.error) sub = t.error;
  return (
    <motion.div layout="position" className="upload-item" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}>
      <span className="glyph-well">
        {t.status === 'done' ? <Check className="c-success" /> : t.status === 'error' ? <CircleAlert className="c-error" /> : <Icon />}
      </span>
      <div className="grow">
        <div className="row">
          <span className="t-footnote w-600 ellipsis grow" title={t.relativePath || t.name}>
            {t.name}
          </span>
          <span className="t-caption num c-variant">{Math.floor(pct * 100)}%</span>
        </div>
        <Progress value={pct} state={state} indeterminate={t.status === 'completing'} />
        <div className={`t-caption ellipsis ${t.status === 'error' ? 'c-error' : 'c-variant'} num`}>{sub}</div>
      </div>
      {!compact && (
        <div className="row" style={{ gap: 0 }}>
          {(t.status === 'uploading' || t.status === 'queued') && (
            <button className="icon-btn sm" onClick={() => uploadStore.pause(t.id)} title="暂停" aria-label="暂停">
              <Pause />
            </button>
          )}
          {t.status === 'paused' && (
            <button className="icon-btn sm" onClick={() => uploadStore.resume(t.id)} title="继续" aria-label="继续">
              <Play />
            </button>
          )}
          {t.status === 'error' && (
            <button className="icon-btn sm" onClick={() => uploadStore.resume(t.id)} title="重试" aria-label="重试">
              <RotateCw />
            </button>
          )}
          {t.status !== 'done' && t.status !== 'canceled' ? (
            <button className="icon-btn sm" onClick={() => uploadStore.cancel(t.id)} title="取消" aria-label="取消">
              <X />
            </button>
          ) : (
            <button className="icon-btn sm" onClick={() => uploadStore.remove(t.id)} title="移除" aria-label="移除">
              <X />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function UploadPanel() {
  const list = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const s = uploadSummary(list);
  const visible = list.filter((t) => t.status !== 'canceled');

  useEffect(() => {
    if (s.activeCount > 0) setHidden(false);
  }, [s.activeCount]);

  const title =
    s.activeCount > 0
      ? s.runningCount
        ? `正在上传 ${s.activeCount} 个文件`
        : s.errorCount
          ? `${s.errorCount} 个文件上传失败`
          : `${s.activeCount} 个任务已暂停`
      : `${s.doneCount} 个文件上传完成`;

  return (
    <AnimatePresence>
      {visible.length > 0 && !hidden && (
        <motion.section
          className="upload-panel"
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.96, transition: { duration: 0.18 } }}
          transition={springSoft}
          aria-label="上传任务"
        >
          <div className="upload-head" onClick={() => setCollapsed((c) => !c)}>
            <Ring value={s.progress} size={36} stroke={4} track="var(--float-block)" color={s.errorCount ? 'var(--error)' : s.activeCount ? 'var(--primary)' : 'var(--success)'}>
              {s.activeCount ? <CloudUpload size={15} className="c-primary" /> : <Check size={16} className="c-success" />}
            </Ring>
            <div className="grow">
              <div className="t-subhead w-600 ellipsis">{title}</div>
              <div className="t-caption c-variant num">
                {s.activeCount > 0 && s.speed > 0 ? `${formatBytes(s.speed)}/s · 剩余约 ${formatDuration(s.eta)}` : s.activeCount ? `${Math.round(s.progress * 100)}%` : '全部完成'}
              </div>
            </div>
            <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={springSoft} className="icon-btn sm" aria-label={collapsed ? '展开' : '收起'}>
              <ChevronDown />
            </motion.span>
            {s.activeCount === 0 && (
              <button
                className="icon-btn sm"
                aria-label="关闭"
                onClick={(e) => {
                  e.stopPropagation();
                  uploadStore.clearFinished();
                  setHidden(true);
                }}
              >
                <X />
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.26, ease: [0.2, 0, 0, 1] }} style={{ overflow: 'hidden' }}>
                <div className="upload-list">
                  <AnimatePresence initial={false}>
                    {visible.map((t) => (
                      <UploadItem key={t.id} t={t} />
                    ))}
                  </AnimatePresence>
                </div>
                <div className="upload-foot">
                  {s.runningCount > 0 && (
                    <button className="btn btn-sm btn-text" onClick={() => uploadStore.pauseAll()}>
                      <Pause /> 全部暂停
                    </button>
                  )}
                  {list.some((t) => t.status === 'paused' || t.status === 'error') && (
                    <button className="btn btn-sm btn-text" onClick={() => uploadStore.resumeAll()}>
                      <Play /> 全部继续
                    </button>
                  )}
                  <span className="spacer" />
                  {s.doneCount > 0 && (
                    <button className="btn btn-sm btn-text" onClick={() => uploadStore.clearFinished()}>
                      <Trash2 /> 清除已完成
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
