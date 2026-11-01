import { AnimatePresence, motion } from 'framer-motion';
import { CloudUpload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { invalidateFs } from '../lib/queryClient';
import { usePrefs } from '../lib/session';
import { collectDropped, filesFromInput, uploadStore } from '../lib/uploads';
import { browsingFolder, registerPicker } from '../lib/uploadTarget';
import { Scallop } from '../ui/controls';
import { springDialog } from '../ui/motion';
import { toast } from '../ui/Toast';

/** Hidden pickers + window-wide drag-and-drop upload target. */
export function Uploader() {
  const [prefs] = usePrefs();
  const filesRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    uploadStore.configure({ concurrency: prefs.uploadConcurrency, chunkSize: prefs.chunkSizeMB * 1024 * 1024, retries: prefs.uploadRetries });
  }, [prefs.uploadConcurrency, prefs.chunkSizeMB, prefs.uploadRetries]);

  useEffect(() => {
    let timer: number | undefined;
    return uploadStore.onComplete(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(invalidateFs, 250);
    });
  }, []);

  const resolveTarget = (explicit?: string | null) => (explicit !== undefined ? explicit : (browsingFolder() ?? prefs.defaultUploadFolderId ?? null));

  useEffect(() => {
    registerPicker((kind, folderId) => {
      target.current = resolveTarget(folderId);
      (kind === 'folder' ? dirRef : filesRef).current?.click();
    });
  });

  const start = (items: { file: File; relativePath?: string }[], folderId: string | null) => {
    if (!items.length) return;
    uploadStore.add(items, folderId);
    toast(`已添加 ${items.length} 个文件到上传队列`);
  };

  const handlers = useRef<Record<string, (e: DragEvent) => void>>({});
  {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      // a folder card under the cursor may override the destination
      const el = (e.target as HTMLElement | null)?.closest?.('[data-drop-folder]') as HTMLElement | null;
      const dest = el ? el.dataset.dropFolder || null : resolveTarget();
      start(await collectDropped(e.dataTransfer!), dest === 'root' ? null : dest);
    };
    handlers.current = { dragenter: enter, dragover: over, dragleave: leave, drop: (e) => void drop(e) };
  }
  useEffect(() => {
    const types = ['dragenter', 'dragover', 'dragleave', 'drop'] as const;
    const fns = types.map((t) => [t, (e: DragEvent) => handlers.current[t]?.(e)] as const);
    for (const [t, fn] of fns) window.addEventListener(t, fn);
    return () => {
      for (const [t, fn] of fns) window.removeEventListener(t, fn);
    };
  }, []);

  return (
    <>
      <input
        ref={filesRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          start(filesFromInput(e.target.files), target.current);
          e.target.value = '';
        }}
      />
      <input
        ref={dirRef}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          start(filesFromInput(e.target.files), target.current);
          e.target.value = '';
        }}
      />
      <AnimatePresence>
        {dragging && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <motion.div className="drop-card" initial={{ scale: 0.88, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94 }} transition={springDialog}>
              <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}>
                <Scallop size={84}>
                  <CloudUpload />
                </Scallop>
              </motion.div>
              <div className="t-title3">松开即可上传</div>
              <div className="t-footnote c-variant">支持文件与文件夹，大文件自动分片、断点续传</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
