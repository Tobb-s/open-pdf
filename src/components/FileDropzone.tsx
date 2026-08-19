'use client';

import { DragEvent, KeyboardEvent, ReactNode, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';

export interface FileKind {
  /** Value for the input's `accept` attribute. */
  accept: string;
  /** Lower-case extensions, including the dot. */
  extensions: string[];
  /** Accepted MIME types or prefixes, e.g. `image/`. */
  mimePrefixes: string[];
  /** Key into the dictionary for the name of this kind of file. */
  labelKey: 'kindPdf' | 'kindImage';
}

export const PDF_FILES: FileKind = {
  accept: '.pdf,application/pdf',
  extensions: ['.pdf'],
  mimePrefixes: ['application/pdf'],
  labelKey: 'kindPdf',
};

export const IMAGE_FILES: FileKind = {
  accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
  extensions: ['.jpg', '.jpeg', '.png', '.webp'],
  mimePrefixes: ['image/jpeg', 'image/png', 'image/webp'],
  labelKey: 'kindImage',
};

interface FileDropzoneProps {
  children: ReactNode;
  className: string;
  inputId: string;
  kind: FileKind;
  multiple?: boolean;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
}

function matches(file: File, kind: FileKind): boolean {
  if (kind.mimePrefixes.some((prefix) => file.type === prefix)) return true;
  const name = file.name.toLowerCase();
  return kind.extensions.some((extension) => name.endsWith(extension));
}

/**
 * A click-or-drop file picker. Every tool uses this one component, so dragging a
 * file works everywhere the interface says it does.
 */
export default function FileDropzone({
  children,
  className,
  inputId,
  kind,
  multiple = false,
  disabled = false,
  onFilesSelected,
}: FileDropzoneProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const kindLabel = t.dropzone[kind.labelKey];

  const selectFiles = (files: File[]) => {
    if (files.length === 0) return;

    const accepted = files.filter((file) => matches(file, kind));

    if (accepted.length === 0) {
      const names = files.map((file) => file.name).join(', ');
      setNotice(t.dropzone.notSupported(names, kindLabel));
      return;
    }

    const rejected = files.length - accepted.length;
    setNotice(rejected > 0 ? t.dropzone.skipped(accepted.length, kindLabel, rejected) : '');
    onFilesSelected(multiple ? accepted : [accepted[0]]);
  };

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    selectFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className={cn(
        className,
        isDragging && 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-200',
        disabled && 'pointer-events-none opacity-60'
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={open}
      onKeyDown={handleKeyDown}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={kind.accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(event) => {
          selectFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
      {children}
      {notice && (
        <p className="mt-3 text-sm text-amber-700" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
