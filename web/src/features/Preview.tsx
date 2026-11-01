import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Download, Link2, Music2, Pause, Play, RotateCw, X, ZoomIn, ZoomOut, Maximize2, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { browserDownload } from '../lib/api';
import { formatBytes, formatClock, formatDateTime } from '../lib/format';
import { iconFor, previewKind, typeLabel } from '../lib/fileIcons';
import type { FsItem } from '../lib/types';
import { springSoft } from '../ui/motion';
import { useEvent } from '../lib/hooks';

export type PreviewSource = { kind: 'owner' } | { kind: 'share'; token: string; allowDownload: boolean };

export function fileUrls(src: PreviewSource, id: string) {
  const base = src.kind === 'owner' ? `/api/fs/files/${id}` : `/api/public/s/${src.token}/files/${id}`;
  return { content: `${base}/content`, download: `${base}/content?download=1`, thumb: (s = 256) => `${base}/thumb?s=${s}` };
}

interface Props {
  files: FsItem[];
  index: number;
  source: PreviewSource;
  onClose: () => void;
  onShare?: (f: FsItem) => void;
}

export function Preview({ files, index: start, source, onClose, onShare }: Props) {
  const [index, setIndex] = useState(start);
  const [dir, setDir] = useState(0);
  const file = files[index];
  const canDownload = source.kind === 'owner' || source.allowDownload;
  const go = (d: number) => {
    const n = index + d;
    if (n < 0 || n >= files.length) return;
    setDir(d);
    setIndex(n);
  };

  const onKey = useEvent((e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [onKey]);

  if (!file) return null;
  const urls = fileUrls(source, file.id);
  const kind = previewKind(file);
  const Icon = iconFor(file);

  return createPortal(
    <motion.div className="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} role="dialog" aria-modal="true" aria-label={`预览 ${file.name}`}>
      <div className="preview-bar">
        <span className="glyph-well">
          <Icon size={18} />
        </span>
        <div className="grow">
          <div className="t-subhead w-600 ellipsis">{file.name}</div>
          <div className="t-caption num" style={{ opacity: 0.7 }}>
            {formatBytes(file.size)} · {typeLabel(file)}
            {files.length > 1 ? ` · ${index + 1} / ${files.length}` : ''}
          </div>
        </div>
        {onShare && (
          <button className="icon-btn" title="分享" aria-label="分享" onClick={() => onShare(file)}>
            <Link2 />
          </button>
        )}
        {canDownload && (
          <button className="icon-btn" title="下载" aria-label="下载" onClick={() => browserDownload(urls.download)}>
            <Download />
          </button>
        )}
        <button className="icon-btn" title="关闭" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
      </div>

      <div className="preview-stage">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={file.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.26, ease: [0.2, 0, 0, 1] }}
            style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}
          >
            {kind === 'image' && <ImageView src={urls.content} onSwipe={go} />}
            {kind === 'video' && <video src={urls.content} controls autoPlay playsInline preload="metadata" poster={file.hasThumb ? urls.thumb(1024) : undefined} />}
            {kind === 'audio' && <AudioPlayer src={urls.content} name={file.name} onPrev={index > 0 ? () => go(-1) : undefined} onNext={index < files.length - 1 ? () => go(1) : undefined} />}
            {kind === 'pdf' && <PdfView src={urls.content} />}
            {kind === 'text' && <TextView src={urls.content} md={file.ext === 'md' || file.ext === 'markdown'} />}
            {kind === 'none' && (
              <div className="preview-info">
                <span className="glyph-well" style={{ width: 72, height: 72, borderRadius: 22, background: 'rgb(255 255 255 / 0.08)', color: '#fff' }}>
                  <Icon size={34} />
                </span>
                <div className="t-headline" style={{ wordBreak: 'break-all' }}>
                  {file.name}
                </div>
                <div className="t-footnote" style={{ opacity: 0.7 }}>
                  {formatBytes(file.size)} · {typeLabel(file)} · {formatDateTime(file.updatedAt)}
                </div>
                <div className="t-footnote" style={{ opacity: 0.7 }}>
                  该文件类型暂不支持在线预览
                </div>
                {canDownload && (
                  <button className="btn btn-filled" style={{ marginTop: 8 }} onClick={() => browserDownload(urls.download)}>
                    <Download /> 下载文件
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        {index > 0 && (
          <button className="icon-btn preview-nav prev" onClick={() => go(-1)} aria-label="上一个">
            <ChevronLeft />
          </button>
        )}
        {index < files.length - 1 && (
          <button className="icon-btn preview-nav next" onClick={() => go(1)} aria-label="下一个">
            <ChevronRight />
          </button>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}

/* ---------- image with zoom / pan / rotate ---------- */
function ImageView({ src, onSwipe }: { src: string; onSwipe: (d: number) => void }) {
  const [scale, setScale] = useState(1);
  const [rot, setRot] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number; t: number } | null>(null);
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const zoom = (f: number) => setScale((s) => Math.min(8, Math.max(0.5, +(s * f).toFixed(3))));
  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
    setRot(0);
  };
  useEffect(() => {
    if (scale <= 1) setPos({ x: 0, y: 0 });
  }, [scale]);

  return (
    <>
      <div
        style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden', padding: 12 }}
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12)}
        onDoubleClick={() => (scale > 1 ? reset() : setScale(2))}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale };
          } else drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, t: Date.now() };
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            setScale(Math.min(8, Math.max(0.5, pinch.current.s * (d / pinch.current.d))));
          } else if (drag.current && scale > 1) {
            setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          const d = drag.current;
          drag.current = null;
          if (d && scale <= 1) {
            const dx = e.clientX - d.x;
            if (Math.abs(dx) > 60 && Date.now() - d.t < 600) onSwipe(dx < 0 ? 1 : -1);
          }
        }}
      >
        {!loaded && <span className="spinner" style={{ position: 'absolute', color: '#fff' }} />}
        <img
          className="preview-img"
          src={src}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale}) rotate(${rot}deg)`,
            transition: drag.current || pinch.current ? 'none' : 'transform 260ms cubic-bezier(.2,0,0,1), opacity 300ms',
            opacity: loaded ? 1 : 0,
            cursor: scale > 1 ? 'grab' : 'zoom-in',
          }}
        />
      </div>
      <div className="preview-tools" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
        <div className="pill">
          <button className="icon-btn" onClick={() => zoom(1 / 1.25)} aria-label="缩小">
            <ZoomOut />
          </button>
          <span className="zoom">{Math.round(scale * 100)}%</span>
          <button className="icon-btn" onClick={() => zoom(1.25)} aria-label="放大">
            <ZoomIn />
          </button>
          <button className="icon-btn" onClick={() => setRot((r) => r + 90)} aria-label="旋转">
            <RotateCw />
          </button>
          <button className="icon-btn" onClick={reset} aria-label="还原">
            <Maximize2 />
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------- audio ---------- */
function AudioPlayer({ src, name, onPrev, onNext }: { src: string; name: string; onPrev?: () => void; onNext?: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };
  return (
    <motion.div className="audio-player" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springSoft}>
      <audio ref={ref} src={src} autoPlay preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onEnded={() => onNext?.()} />
      <div className={`audio-art${playing ? ' playing' : ''}`}>
        <Music2 />
      </div>
      <div className="t-headline ellipsis" style={{ maxWidth: '100%' }}>
        {name}
      </div>
      <input
        className="seek"
        type="range"
        min={0}
        max={dur || 0}
        step={0.1}
        value={t}
        style={{ ['--p' as string]: `${dur ? (t / dur) * 100 : 0}%` }}
        onChange={(e) => {
          if (ref.current) ref.current.currentTime = Number(e.target.value);
        }}
        aria-label="播放进度"
      />
      <div className="row num t-caption" style={{ width: '100%', opacity: 0.7 }}>
        <span>{formatClock(t)}</span>
        <span className="spacer" />
        <span>{formatClock(dur)}</span>
      </div>
      <div className="audio-controls">
        <button className="icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="上一首">
          <SkipBack />
        </button>
        <button className="icon-btn play" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="icon-btn" onClick={onNext} disabled={!onNext} aria-label="下一首">
          <SkipForward />
        </button>
      </div>
    </motion.div>
  );
}

/* ---------- text / markdown (first 2 MB) ---------- */
function TextView({ src, md }: { src: string; md: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(src, { headers: { Range: 'bytes=0-2097151' }, signal: ctrl.signal, credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok && r.status !== 206) throw new Error(r.status === 403 ? '分享者未允许预览' : '加载失败');
        setTruncated(r.status === 206 && /\/(\d+)$/.test(r.headers.get('content-range') ?? '') && Number(RegExp.$1) > 2097152);
        setText(await r.text());
      })
      .catch((e) => e.name !== 'AbortError' && setErr(e.message));
    return () => ctrl.abort();
  }, [src]);
  if (err) return <div className="preview-info">{err}</div>;
  if (text === null) return <span className="spinner" style={{ color: '#fff' }} />;
  return (
    <div className="preview-doc">
      {md ? <article className="preview-md" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { FORBID_TAGS: ['style', 'form', 'iframe'], FORBID_ATTR: ['style'] }) }} /> : <pre className="preview-text">{text}</pre>}
      {truncated && (
        <div className="t-footnote" style={{ textAlign: 'center', opacity: 0.7, marginTop: 12 }}>
          文件较大，仅显示前 2 MB 内容
        </div>
      )}
    </div>
  );
}

/* ---------- PDF via pdf.js (rendered to canvas; never executes document scripts) ---------- */
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<unknown> };

function PdfView({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const taskRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const [state, setState] = useState<{ pages: number; err?: string }>({ pages: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const task = pdfjs.getDocument({ url: src, enableXfa: false });
        taskRef.current = task as unknown as { destroy: () => Promise<void> };
        const doc = (await task.promise) as unknown as PdfDoc;
        if (cancelled) return;
        docRef.current = doc;
        setState({ pages: doc.numPages });
      } catch (e) {
        if (!cancelled) setState({ pages: 0, err: String((e as Error).message).includes('403') ? '分享者未允许预览' : 'PDF 加载失败' });
      }
    })();
    return () => {
      cancelled = true;
      taskRef.current?.destroy().catch(() => {});
      taskRef.current = null;
      docRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !state.pages || !box.current) return;
    const width = Math.min(box.current.clientWidth, 980) - 32;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const canvas = e.target as HTMLCanvasElement;
          observer.unobserve(canvas);
          void doc.getPage(Number(canvas.dataset.page)).then((page) => {
            const p = page as { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } };
            const base = p.getViewport({ scale: 1 });
            const ratio = window.devicePixelRatio || 1;
            const vp = p.getViewport({ scale: (width / base.width) * ratio });
            canvas.width = vp.width;
            canvas.height = vp.height;
            canvas.style.aspectRatio = `${vp.width} / ${vp.height}`;
            return p.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
          });
        }
      },
      { root: box.current, rootMargin: '800px 0px' },
    );
    box.current.querySelectorAll('canvas').forEach((c) => {
      (c as HTMLCanvasElement).style.width = `${width}px`;
      observer.observe(c);
    });
    return () => observer.disconnect();
  }, [state.pages]);

  return (
    <div className="preview-doc" ref={box}>
      {state.err && <div className="preview-info">{state.err}</div>}
      {!state.err && state.pages === 0 && <span className="spinner" style={{ color: '#fff', margin: '40px auto', display: 'block' }} />}
      {Array.from({ length: state.pages }).map((_, i) => (
        <canvas key={i} className="pdf-page" data-page={i + 1} style={{ aspectRatio: '0.7071' }} />
      ))}
    </div>
  );
}
