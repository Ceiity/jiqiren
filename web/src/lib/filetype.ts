import type { Category } from './types';

const MAP: Record<string, Category> = {};
const add = (c: Category, exts: string) => exts.split(' ').forEach((e) => (MAP[e] = c));
add('image', 'jpg jpeg png gif webp avif bmp ico svg heic heif tif tiff');
add('video', 'mp4 webm ogv mov m4v mkv avi wmv flv 3gp ts');
add('audio', 'mp3 m4a aac ogg oga wav flac opus weba wma mid midi');
add('document', 'pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt md markdown csv tsv json xml yaml yml toml ini log epub pages numbers key html htm css js ts tsx jsx py java c cpp h go rs sh sql');
add('archive', 'zip rar 7z tar gz tgz bz2 xz zst iso dmg');

export function detectCategory(name: string): Category {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return MAP[ext] ?? 'other';
}
