'use client';

import React, { useState, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import PdfDropzone from '@/components/PdfDropzone';
import { FileText, X, Download, Loader2, Minimize2, CheckCircle2, Zap, SlidersHorizontal, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type CompressionLevel = 'extreme' | 'recommended' | 'low';

interface CompressionPreset {
  id: CompressionLevel;
  title: string;
  description: string;
  badge?: string;
  scale: number;
  quality: number;
  color: string;
  border: string;
  bg: string;
}

const PRESETS: CompressionPreset[] = [
  {
    id: 'extreme',
    title: 'Extreme Compression',
    description: 'Less quality, high compression. Maximum space saving.',
    scale: 0.8,
    quality: 0.4,
    color: 'text-amber-600',
    border: 'border-amber-200 hover:border-amber-400',
    bg: 'bg-amber-50/50',
  },
  {
    id: 'recommended',
    title: 'Recommended Compression',
    description: 'Good quality, good compression. Optimal balance.',
    badge: 'Popular',
    scale: 1.1,
    quality: 0.65,
    color: 'text-blue-600',
    border: 'border-blue-300 ring-2 ring-blue-500/20',
    bg: 'bg-blue-50/50',
  },
  {
    id: 'low',
    title: 'Low Compression',
    description: 'High quality, low compression. Best visual clarity.',
    scale: 1.5,
    quality: 0.85,
    color: 'text-emerald-600',
    border: 'border-emerald-200 hover:border-emerald-400',
    bg: 'bg-emerald-50/50',
  },
];

export default function CompressPage() {
  const [file, setFile] = useState<File | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<CompressionLevel>('recommended');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [resultPdf, setResultPdf] = useState<{ blob: Blob; size: number } | null>(null);

  useEffect(() => {
    import('pdfjs-dist').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${mod.version}/pdf.worker.min.mjs`;
    });
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const selectFile = (selectedFile: File) => {
    setFile(selectedFile);
    setResultPdf(null);
  };

  const compressPdf = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProgressPercent(5);
    setProgressMsg('Reading PDF document...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = await import('pdfjs-dist');
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdfDoc.numPages;

      const preset = PRESETS.find((p) => p.id === selectedLevel) || PRESETS[1];
      const newPdfDoc = await PDFDocument.create();

      for (let i = 1; i <= numPages; i++) {
        const percent = Math.round((i / numPages) * 90);
        setProgressPercent(percent);
        setProgressMsg(`Compressing page ${i} of ${numPages}...`);

        const page = await pdfDoc.getPage(i);
        const originalViewport = page.getViewport({ scale: 1 });
        const renderViewport = page.getViewport({ scale: preset.scale });

        const canvas = document.createElement('canvas');
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) continue;

        // Render page onto canvas
        await page.render({
          canvasContext: ctx,
          viewport: renderViewport,
          canvas: canvas,
        }).promise;

        // Convert canvas to JPEG blob with chosen quality
        const jpegDataUrl = canvas.toDataURL('image/jpeg', preset.quality);
        const jpegImageBytes = await fetch(jpegDataUrl).then((res) => res.arrayBuffer());

        // Embed image in pdf-lib document page preserving original dimensions
        const embeddedImage = await newPdfDoc.embedJpg(jpegImageBytes);
        const newPage = newPdfDoc.addPage([originalViewport.width, originalViewport.height]);

        newPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: originalViewport.width,
          height: originalViewport.height,
        });
      }

      setProgressPercent(95);
      setProgressMsg('Finalizing compressed PDF...');

      const compressedBytes = (await newPdfDoc.save()).slice();
      const compressedBlob = new Blob([compressedBytes], { type: 'application/pdf' });

      setResultPdf({
        blob: compressedBlob,
        size: compressedBytes.length,
      });

      setProgressPercent(100);
    } catch (error) {
      console.error('Error compressing PDF:', error);
      alert('An error occurred while compressing the PDF document.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPdf = () => {
    if (!resultPdf || !file) return;
    const url = URL.createObjectURL(resultPdf.blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = file.name.replace(/\.pdf$/i, '');
    a.download = `${baseName}_compressed.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const calculateSavedPercentage = () => {
    if (!file || !resultPdf) return 0;
    const diff = file.size - resultPdf.size;
    if (diff <= 0) return 0;
    return Math.round((diff / file.size) * 100);
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100/70 text-blue-700 text-xs font-semibold rounded-full mb-3">
            <Zap className="w-3.5 h-3.5 fill-blue-600 text-blue-600" />
            100% In-Browser Privacy
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
            Compress PDF File
          </h1>
          <p className="text-lg text-gray-600 max-w-xl mx-auto">
            Reduce PDF file size while optimizing for maximal visual quality. Zero server uploads.
          </p>
        </div>

        {!resultPdf ? (
          <div className="space-y-8">
            {!file ? (
              <PdfDropzone
                inputId="compress-file-input"
                className="border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer bg-white border-gray-300 hover:border-blue-500 hover:shadow-xl transition-all group"
                onFilesSelected={([selectedFile]) => selectFile(selectedFile)}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Minimize2 className="w-10 h-10" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900 mb-1">Select PDF file</p>
                    <p className="text-sm text-gray-500">or drag and drop your document here</p>
                  </div>
                </div>
              </PdfDropzone>
            ) : (
              <div className="space-y-8">
                {/* File Header */}
                <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-2xl shadow-sm">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="truncate">
                      <p className="font-semibold text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setFile(null)}
                    className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Compression Presets */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                    <h3 className="font-bold text-gray-900 text-lg">Choose Compression Level</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {PRESETS.map((preset) => (
                      <div
                        key={preset.id}
                        onClick={() => setSelectedLevel(preset.id)}
                        className={cn(
                          'relative border rounded-2xl p-5 cursor-pointer transition-all bg-white flex flex-col justify-between',
                          selectedLevel === preset.id
                            ? preset.border + ' shadow-md scale-[1.02]'
                            : 'border-gray-200 hover:border-gray-300 opacity-80 hover:opacity-100'
                        )}
                      >
                        {preset.badge && (
                          <span className="absolute -top-3 right-4 px-2.5 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wider shadow-sm">
                            {preset.badge}
                          </span>
                        )}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className={cn('font-bold text-base', preset.color)}>
                              {preset.title}
                            </span>
                            <input
                              type="radio"
                              name="compressionLevel"
                              checked={selectedLevel === preset.id}
                              onChange={() => setSelectedLevel(preset.id)}
                              className="w-4 h-4 text-blue-600 accent-blue-600"
                            />
                          </div>
                          <p className="text-xs text-gray-500 leading-relaxed">
                            {preset.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Processing status */}
                {isProcessing && (
                  <div className="bg-white border border-blue-100 p-6 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between text-sm font-semibold text-gray-700">
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                        {progressMsg}
                      </span>
                      <span className="text-blue-600">{progressPercent}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Compress Button */}
                <div className="flex justify-center pt-2">
                  <button
                    onClick={compressPdf}
                    disabled={isProcessing}
                    className="px-10 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-3 shadow-xl shadow-blue-200"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Compressing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        Compress PDF
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Result Ready Dashboard */
          <div className="bg-white border border-gray-200 rounded-3xl p-8 sm:p-12 shadow-sm text-center">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 className="text-3xl font-extrabold text-gray-900 mb-2">
              PDF Compressed Successfully!
            </h2>
            <p className="text-gray-500 mb-8">
              Your document is ready to download with reduced file size.
            </p>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl mx-auto mb-10 bg-slate-50 p-6 rounded-2xl border border-gray-100">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Original Size</span>
                <span className="text-lg font-bold text-gray-700">{formatSize(file?.size || 0)}</span>
              </div>
              <div className="flex flex-col border-y sm:border-y-0 sm:border-x border-gray-200 py-3 sm:py-0">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Compressed Size</span>
                <span className="text-lg font-bold text-blue-600">{formatSize(resultPdf.size)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Saved Space</span>
                <span className="text-lg font-extrabold text-emerald-600">
                  {calculateSavedPercentage()}% OFF
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={downloadPdf}
                className="w-full sm:w-auto px-9 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-200"
              >
                <Download className="w-5 h-5" />
                Download Compressed PDF
              </button>
              <button
                onClick={() => {
                  setResultPdf(null);
                  setFile(null);
                }}
                className="w-full sm:w-auto px-8 py-4 bg-gray-100 text-gray-700 rounded-full font-bold text-lg hover:bg-gray-200 transition-all"
              >
                Compress Another PDF
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
