'use client';

import React, { useEffect, useState } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  GripVertical,
  Loader2,
  RotateCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

interface OrganizedPage {
  id: string;
  pageIndex: number;
  pageNumber: number;
  thumbnail: string;
  rotation: number;
}

export default function OrganizePage() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<OrganizedPage[]>([]);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultPdf, setResultPdf] = useState<Blob | null>(null);

  useEffect(() => {
    import('pdfjs-dist').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${mod.version}/pdf.worker.min.mjs`;
    });
  }, []);

  const resetFile = () => {
    setFile(null);
    setPdfData(null);
    setPages([]);
    setDraggedPageId(null);
    setResultPdf(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;

    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setResultPdf(null);
    setIsLoadingPages(true);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      setPdfData(arrayBuffer);

      const pdfjs = await import('pdfjs-dist');
      const pdf = await pdfjs.getDocument({ data: arrayBuffer.slice(0) }).promise;
      const renderedPages: OrganizedPage[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.22 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvas, viewport }).promise;

        renderedPages.push({
          id: `${selectedFile.name}-${i}-${Date.now()}`,
          pageIndex: i - 1,
          pageNumber: i,
          thumbnail: canvas.toDataURL('image/png'),
          rotation: 0,
        });
      }

      setPages(renderedPages);
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Invalid PDF file.');
      resetFile();
    } finally {
      setIsLoadingPages(false);
      e.target.value = '';
    }
  };

  const movePage = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;

    setPages((prev) => {
      const sourceIndex = prev.findIndex((page) => page.id === sourceId);
      const targetIndex = prev.findIndex((page) => page.id === targetId);

      if (sourceIndex === -1 || targetIndex === -1) return prev;

      const next = [...prev];
      const [movedPage] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, movedPage);
      return next;
    });
  };

  const movePageByIndex = (index: number, direction: -1 | 1) => {
    setPages((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = [...prev];
      const [movedPage] = next.splice(index, 1);
      next.splice(targetIndex, 0, movedPage);
      return next;
    });
  };

  const rotatePage = (id: string) => {
    setPages((prev) =>
      prev.map((page) =>
        page.id === id ? { ...page, rotation: (page.rotation + 90) % 360 } : page
      )
    );
  };

  const removePage = (id: string) => {
    setPages((prev) => prev.filter((page) => page.id !== id));
  };

  const organizePdf = async () => {
    if (!pdfData || pages.length === 0) {
      alert('Please keep at least one page in the document.');
      return;
    }

    setIsProcessing(true);

    try {
      const sourcePdf = await PDFDocument.load(pdfData);
      const organizedPdf = await PDFDocument.create();

      for (const page of pages) {
        const [copiedPage] = await organizedPdf.copyPages(sourcePdf, [page.pageIndex]);
        const currentAngle = copiedPage.getRotation().angle;
        copiedPage.setRotation(degrees((currentAngle + page.rotation) % 360));
        organizedPdf.addPage(copiedPage);
      }

      const pdfBytes = (await organizedPdf.save()).slice();
      setResultPdf(new Blob([pdfBytes], { type: 'application/pdf' }));
    } catch (error) {
      console.error('Error organizing PDF:', error);
      alert('An error occurred while organizing the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPdf = () => {
    if (!resultPdf) return;

    const url = URL.createObjectURL(resultPdf);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'organized_document.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Organize PDF pages</h1>
          <p className="text-gray-600">
            Reorder, rotate, and remove pages from your PDF before downloading it.
          </p>
        </div>

        {!file ? (
          <div
            className="border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer bg-white border-gray-300 hover:border-blue-400"
            onClick={() => document.getElementById('organizeFileInput')?.click()}
          >
            <input
              id="organizeFileInput"
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                <Upload className="w-8 h-8" />
              </div>
              <div>
                <p className="text-lg font-semibold">Choose PDF file</p>
                <p className="text-sm text-gray-500">or drag and drop it here</p>
              </div>
            </div>
          </div>
        ) : resultPdf ? (
          <div className="text-center p-12 bg-white border rounded-3xl shadow-sm">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileText className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold mb-2">PDF Organized Successfully!</h2>
            <p className="text-gray-600 mb-8">Your updated document is ready for download.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={downloadPdf}
                className="px-8 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-200"
              >
                <Download className="w-5 h-5" />
                Download PDF
              </button>
              <button
                onClick={resetFile}
                className="px-8 py-4 bg-gray-100 text-gray-700 rounded-full font-bold text-lg hover:bg-gray-200 transition-all"
              >
                Organize another file
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-white border rounded-2xl">
              <div className="flex items-center gap-3 overflow-hidden">
                <FileText className="w-6 h-6 text-blue-500 shrink-0" />
                <span className="font-medium truncate">{file.name}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                  {pages.length} pages
                </span>
              </div>
              <button
                onClick={resetFile}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-blue-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isLoadingPages ? (
              <div className="p-12 bg-white border rounded-3xl text-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
                <p className="font-medium text-gray-700">Preparing page previews...</p>
              </div>
            ) : (
              <>
                <div className="bg-white border rounded-3xl p-5 shadow-sm">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {pages.map((page, index) => (
                      <div
                        key={page.id}
                        draggable
                        onDragStart={() => setDraggedPageId(page.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggedPageId) movePage(draggedPageId, page.id);
                          setDraggedPageId(null);
                        }}
                        onDragEnd={() => setDraggedPageId(null)}
                        className="group border rounded-2xl bg-gray-50 p-3 transition-all hover:border-blue-200 hover:bg-blue-50"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-gray-500">
                            Page {page.pageNumber}
                          </span>
                          <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-blue-400 cursor-grab" />
                        </div>

                        <div className="aspect-[3/4] bg-white border rounded-xl flex items-center justify-center overflow-hidden mb-3">
                          <div
                            aria-label={`Page ${page.pageNumber}`}
                            className="w-full h-full bg-contain bg-center bg-no-repeat transition-transform"
                            role="img"
                            style={{
                              backgroundImage: `url(${page.thumbnail})`,
                              transform: `rotate(${page.rotation}deg)`,
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-4 gap-1">
                          <button
                            onClick={() => movePageByIndex(index, -1)}
                            disabled={index === 0}
                            className="p-2 rounded-lg bg-white border text-gray-500 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Move left"
                          >
                            <ArrowLeft className="w-4 h-4 mx-auto" />
                          </button>
                          <button
                            onClick={() => movePageByIndex(index, 1)}
                            disabled={index === pages.length - 1}
                            className="p-2 rounded-lg bg-white border text-gray-500 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Move right"
                          >
                            <ArrowRight className="w-4 h-4 mx-auto" />
                          </button>
                          <button
                            onClick={() => rotatePage(page.id)}
                            className="p-2 rounded-lg bg-white border text-gray-500 hover:text-blue-600 transition-colors"
                            title="Rotate page"
                          >
                            <RotateCw className="w-4 h-4 mx-auto" />
                          </button>
                          <button
                            onClick={() => removePage(page.id)}
                            disabled={pages.length === 1}
                            className="p-2 rounded-lg bg-white border text-gray-500 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Remove page"
                          >
                            <Trash2 className="w-4 h-4 mx-auto" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <p className="text-sm text-gray-500">
                    Drag pages to reorder them, or use the buttons under each preview.
                  </p>
                  <button
                    onClick={organizePdf}
                    disabled={pages.length === 0 || isProcessing}
                    className="px-8 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-blue-200"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Organizing...
                      </>
                    ) : (
                      'Organize PDF'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
