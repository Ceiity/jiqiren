/** Where "upload" buttons outside the file browser put files: the folder being browsed. */
let current: string | null = null;
export const setBrowsingFolder = (id: string | null) => {
  current = id;
};
export const browsingFolder = () => current;

type Picker = (kind: 'files' | 'folder', folderId?: string | null) => void;
let picker: Picker = () => {};
export const registerPicker = (p: Picker) => {
  picker = p;
};
export const pickUpload = (kind: 'files' | 'folder' = 'files', folderId?: string | null) => picker(kind, folderId);
