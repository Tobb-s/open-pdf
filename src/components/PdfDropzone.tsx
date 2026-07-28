'use client';

import { DragEvent, KeyboardEvent, ReactNode, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface PdfDropzoneProps {
  children: ReactNode;
  className: string;
  inputId: string;
  multiple?: boolean;
  onFilesSelected: (files: File[]) => void;
}

export default function PdfDropzone({
  children,
  className,
  inputId,
  multiple = false,
  onFilesSelected,
}: PdfDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');

  const selectFiles = (files: File[]) => {
    const pdfFiles = files.filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );

    if (pdfFiles.length === 0) {
      setError('Please choose a PDF file.');
      return;
    }

    setError(pdfFiles.length !== files.length ? 'Only PDF files were added.' : '');
    onFilesSelected(multiple ? pdfFiles : [pdfFiles[0]]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    selectFiles(Array.from(event.dataTransfer.files));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div
      className={cn(className, isDragging && 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-200')}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={handleKeyDown}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".pdf,application/pdf"
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          selectFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
      {children}
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
