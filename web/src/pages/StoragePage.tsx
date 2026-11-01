import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FileArchive, FileAudio2, FileImage, FileText, FileVideo2, File as FileIcon, HardDrive, Trash2, TrendingUp, ArrowUpWideNarrow } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../lib/api';
import { formatBytes, formatCount, formatDate } from '../lib/format';
import { iconFor } from '../lib/fileIcons';
import type { FsItem } from '../lib/types';
import { Page } from '../layout/Page';
import { Progress, Ring } from '../ui/controls';
import { cardIn, listStagger } from '../ui/motion';
import { Sparkline, lastNDays } from '../ui/Sparkline';
import { Preview } from '../features/Preview';
import { Thumb } from '../features/browser/FileBrowser';

interface StorageStats {
  usedBytes: number;
  quotaBytes: number;
  categories: { category: string; count: number; bytes: number }[];
  trash: { count: number; bytes: number };
  largest: FsItem[];
  growth: { day: string; c: number; b: number }[];
}

const CAT: Record<string, [string, typeof FileImage]> = {
  image: ['图片', FileImage],
  video: ['视频', FileVideo2],
  audio: ['音频', FileAudio2],
  document: ['文档', FileText],
  archive: ['压缩包', FileArchive],
  other: ['其他', FileIcon],
};

export function StoragePage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['stats', 'storage'], queryFn: () => get<StorageStats>('/api/stats/storage') });
  const [preview, setPreview] = useState<number | null>(null);
  const d = q.data;
  const pct = d && d.quotaBytes ? d.usedBytes / d.quotaBytes : 0;
  const days = lastNDays(30);
  let acc = 0;
  const growth = days.map((day) => (acc += d?.growth.find((g) => g.day === day)?.b ?? 0));
  const maxCat = Math.max(1, ...(d?.categories.map((c) => c.bytes) ?? [1]));

  return (
    <Page title="存储空间">
      <motion.div className="dash" variants={listStagger} initial="hidden" animate="show">
        <motion.section variants={cardIn} className="card span-6">
          <div className="card-header">
            <HardDrive /> 空间使用
          </div>
          <div className="storage-hero">
            <Ring value={d?.quotaBytes ? pct : d ? 1 : 0} size={148} stroke={14} color={!d?.quotaBytes ? 'color-mix(in srgb, var(--primary) 28%, var(--block))' : pct > 0.9 ? 'var(--error)' : 'var(--primary)'}>
              <div>
                <div className="t-title1 num">{d?.quotaBytes ? `${Math.round(pct * 100)}%` : '∞'}</div>
                <div className="t-caption c-variant">{d?.quotaBytes ? '已使用' : '不限容量'}</div>
              </div>
            </Ring>
            <div className="col grow" style={{ gap: 10 }}>
              <div>
                <div className="t-caption c-variant">已使用</div>
                <div className="t-title2 num">{d ? formatBytes(d.usedBytes) : '–'}</div>
              </div>
              <div className="row" style={{ gap: 24 }}>
                <div>
                  <div className="t-caption c-variant">总空间</div>
                  <div className="t-headline num">{d ? (d.quotaBytes ? formatBytes(d.quotaBytes) : '不限') : '–'}</div>
                </div>
                <div>
                  <div className="t-caption c-variant">剩余</div>
                  <div className="t-headline num">{d ? (d.quotaBytes ? formatBytes(Math.max(0, d.quotaBytes - d.usedBytes)) : '不限') : '–'}</div>
                </div>
              </div>
              {d && d.trash.bytes > 0 && (
                <button className="well row" style={{ padding: '10px 12px', gap: 10, textAlign: 'left' }} onClick={() => nav('/trash')}>
                  <Trash2 size={17} className="c-variant" />
                  <span className="t-footnote grow">回收站占用 {formatBytes(d.trash.bytes)}</span>
                  <span className="t-footnote c-primary w-600">清理</span>
                </button>
              )}
            </div>
          </div>
        </motion.section>

        <motion.section variants={cardIn} className="card span-6 trend-card">
          <div className="card-header">
            <TrendingUp /> 近 30 天新增
          </div>
          <div className="big-num">
            {formatBytes(acc).split(' ')[0]}
            <small>{formatBytes(acc).split(' ')[1]}</small>
          </div>
          <div className="t-caption c-variant num">共 {formatCount(d?.growth.reduce((a, g) => a + g.c, 0) ?? 0)} 个文件</div>
          <div className="trend-chart">
            <Sparkline data={growth} height={110} />
          </div>
        </motion.section>

        <motion.section variants={cardIn} className="card span-6">
          <div className="card-header">分类占用</div>
          <div className="cat-rows">
            {(d?.categories.length ? d.categories : []).map((c) => {
              const [name, Icon] = CAT[c.category] ?? CAT.other;
              return (
                <div key={c.category} className="cat-row">
                  <span className="glyph-well">
                    <Icon />
                  </span>
                  <div className="col" style={{ gap: 6 }}>
                    <div className="row t-footnote">
                      <span className="w-600">{name}</span>
                      <span className="c-variant num">{formatCount(c.count)} 个</span>
                    </div>
                    <Progress value={c.bytes / maxCat} />
                  </div>
                  <span className="t-footnote w-600 num">{formatBytes(c.bytes)}</span>
                </div>
              );
            })}
            {d && d.categories.length === 0 && <div className="t-footnote c-variant">暂无文件</div>}
          </div>
        </motion.section>

        <motion.section variants={cardIn} className="card span-6">
          <div className="card-header">
            <ArrowUpWideNarrow /> 大文件
          </div>
          <div className="recent-table">
            {d?.largest.slice(0, 8).map((f, i) => {
              const Icon = iconFor(f);
              return (
                <button key={f.id} className="table-row recent-cols" onClick={() => setPreview(i)} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <span className="row" style={{ gap: 10 }}>
                    <span className="recent-icon">{f.hasThumb ? <Thumb item={f} size={128} /> : <Icon />}</span>
                    <span className="col" style={{ minWidth: 0 }}>
                      <span className="ellipsis w-500">{f.name}</span>
                      <span className="t-caption c-variant">{formatDate(f.updatedAt)}</span>
                    </span>
                  </span>
                  <span className="num t-footnote w-600">{formatBytes(f.size)}</span>
                </button>
              );
            })}
            {d && d.largest.length === 0 && <div className="t-footnote c-variant" style={{ padding: '0 6px' }}>暂无文件</div>}
          </div>
        </motion.section>
      </motion.div>
      {preview !== null && d && <Preview files={d.largest} index={preview} source={{ kind: 'owner' }} onClose={() => setPreview(null)} />}
    </Page>
  );
}
