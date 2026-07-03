'use client';

import React, { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import { Upload, FileText, X, Download, Loader2, Plus, MousePointerClick, Trash2 } from 'lucide-react';

interface Annotation {
  id: number;
  x: number;
  y: number;
  text: string;
  pageIndex: number;
}

export default function EditPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [nextId, setNextId] = useState(1);
  const [isPlacingText, setIsPlacingText] = useState(false);
  const [resultPdf, setResultPdf] = useState<Blob | null>(null);
  const [renderedPages, setRenderedPages] = useState<Record<number, string>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    import('pdfjs-dist').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${mod.version}/pdf.worker.min.mjs`;
    });
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      const arrayBuffer = await selectedFile.arrayBuffer();
      setPdfData(arrayBuffer);
      
      const mod = await import('pdfjs-dist');
      const pdf = await mod.getDocument({ data: arrayBuffer }).promise;
      setNumPages(pdf.numPages);
      setCurrentPage(1);
      setAnnotations([]);
      setResultPdf(null);

      const pages: Record<number, string> = {};
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.7 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvas, viewport }).promise;
        pages[i] = canvas.toDataURL();
      }
      setRenderedPages(pages);
    }
  };

  const currentScale = 0.7;

  const getPdfCoords = (canvasX: number, canvasY: number) => {
    if (!pdfData) return { x: 0, y: 0 };
    const canvasEl = canvasRef.current;
    if (!canvasEl) return { x: 0, y: 0 };
    const rect = canvasEl.getBoundingClientRect();
    const relX = canvasX - rect.left;
    const relY = canvasY - rect.top;
    const pdfX = relX / currentScale;
    const pdfY = (canvasEl.height / currentScale - relY / currentScale);
    return { x: pdfX, y: pdfY };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPlacingText || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setAnnotations(prev => [...prev, { id: nextId, x, y, text: '', pageIndex: currentPage - 1 }]);
    setNextId(n => n + 1);
    setIsPlacingText(false);
  };

  const updateAnnotationText = (id: number, text: string) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, text } : a));
  };

  const removeAnnotation = (id: number) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  };

  const savePdf = async () => {
    if (!pdfData) return;
    setIsProcessing(true);
    try {
      const pdfDoc = await PDFDocument.load(pdfData);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontSize = 12;

      for (const ann of annotations) {
        if (!ann.text.trim()) continue;
        const page = pdfDoc.getPages()[ann.pageIndex];
        if (!page) continue;
        const { width, height } = page.getSize();
        const canvasEl = canvasRef.current;
        if (!canvasEl) continue;
        const canvasW = canvasEl.width;
        const canvasH = canvasEl.height;
        const pdfX = (ann.x / canvasW) * width;
        const pdfY = height - (ann.y / canvasH) * height - fontSize;
        page.drawText(ann.text, { x: pdfX, y: pdfY, size: fontSize, font, color: rgb(0, 0, 0) });
      }

      const pdfBytes = (await pdfDoc.save()).slice();
      setResultPdf(new Blob([pdfBytes], { type: 'application/pdf' }));
    } catch (error) {
      console.error('Error saving PDF:', error);
      alert('An error occurred while saving the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPdf = () => {
    if (!resultPdf) return;
    const url = URL.createObjectURL(resultPdf);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'edited_document.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const pageAnns = annotations.filter(a => a.pageIndex === currentPage - 1);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Edit PDF</h1>
          <p className="text-gray-600">Add text annotations to your PDF pages.</p>
        </div>

        {!file ? (
          <div className="border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer bg-white border-gray-300 hover:border-red-400 transition-all"
            onClick={() => document.getElementById('fileInput')?.click()}>
            <input id="fileInput" type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                <Upload className="w-8 h-8" />
              </div>
              <p className="text-lg font-semibold">Choose PDF file</p>
              <p className="text-sm text-gray-500">to add text annotations</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-white border rounded-2xl">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-purple-500 shrink-0" />
                <span className="font-medium truncate">{file.name}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">{numPages} pages</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setIsPlacingText(v => !v)}
                  className={`px-4 py-2 ${isPlacingText ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'} rounded-xl font-medium text-sm flex items-center gap-2 hover:bg-blue-500 hover:text-white transition-all`}>
                  <MousePointerClick className="w-4 h-4" />
                  {isPlacingText ? 'Placing text...' : 'Add Text'}
                </button>
                <button onClick={() => { setFile(null); setPdfData(null); setAnnotations([]); }}
                  className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {numPages > 1 && (
              <div className="flex justify-center items-center gap-4">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                  className="px-4 py-2 bg-white border rounded-xl disabled:opacity-30 hover:bg-white">Previous</button>
                <span className="font-medium">Page {currentPage} of {numPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} disabled={currentPage === numPages}
                  className="px-4 py-2 bg-white border rounded-xl disabled:opacity-30 hover:bg-white">Next</button>
              </div>
            )}

            <div ref={containerRef} className="relative bg-white border rounded-3xl p-4 shadow-sm flex justify-center overflow-hidden">
              {renderedPages[currentPage] && (
                <canvas
                  ref={canvasRef}
                  className="max-w-full"
                  onClick={handleCanvasClick}
                  style={{ cursor: isPlacingText ? 'crosshair' : 'default' }}
                />
              )}
              {pageAnns.map(ann => (
                <div
                  key={ann.id}
                  className="absolute"
                  style={{ left: ann.x, top: ann.y - 6 }}
                >
                  <div className="flex items-center gap-1 bg-white border border-purple-300 rounded-lg shadow-sm">
                    <input
                      type="text"
                      value={ann.text}
                      onChange={(e) => updateAnnotationText(ann.id, e.target.value)}
                      placeholder="Type here..."
                      className="w-40 px-2 py-1 text-sm border-0 outline-none rounded-l-lg"
                      autoFocus
                    />
                    <button onClick={() => removeAnnotation(ann.id)}
                      className="p-1 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {isPlacingText && (
              <p className="text-center text-sm text-purple-600 font-medium animate-pulse">
                Click anywhere on the page to place a text box
              </p>
            )}

            <div className="flex justify-center pt-2">
              <button onClick={savePdf} disabled={isProcessing || annotations.length === 0}
                className="px-8 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-blue-200">
                {isProcessing ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving...</> : 'Save PDF'}
              </button>
            </div>
          </div>
        )}

        {resultPdf && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="text-center p-12 bg-white border rounded-3xl shadow-xl max-w-md mx-4">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <FileText className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold mb-2">PDF Edited Successfully!</h2>
              <p className="text-gray-600 mb-8">Your edited document is ready for download.</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={downloadPdf}
                  className="px-8 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 flex items-center gap-2">
                  <Download className="w-5 h-5" /> Download PDF
                </button>
                <button onClick={() => setResultPdf(null)}
                  className="px-8 py-4 bg-gray-100 text-gray-700 rounded-full font-bold text-lg hover:bg-gray-200">
                  Continue editing
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
