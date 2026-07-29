'use client';

import React, { useState, useEffect, useRef } from 'react';
import { PDFDocument, rgb } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import { FileText, Download, Loader2, ScanText, CheckCircle2, Languages, Type } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createWorker } from 'tesseract.js';

type OcrLanguage = 'eng' | 'spa' | 'fra' | 'deu' | 'ita' | 'por';

interface LanguageOption {
  code: OcrLanguage;
  name: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'spa', name: 'Spanish' },
  { code: 'eng', name: 'English' },
  { code: 'fra', name: 'French' },
  { code: 'deu', name: 'German' },
  { code: 'ita', name: 'Italian' },
  { code: 'por', name: 'Portuguese' },
];

export default function OcrPage() {
  const [file, setFile] = useState<File | null>(null);
  const [selectedLang, setSelectedLang] = useState<OcrLanguage>('spa');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  
  const [resultPdf, setResultPdf] = useState<Blob | null>(null);
  const [extractedText, setExtractedText] = useState<string>('');

  useEffect(() => {
    import('pdfjs-dist').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${mod.version}/pdf.worker.min.mjs`;
    });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResultPdf(null);
      setExtractedText('');
    }
  };

  const processOcr = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProgressPercent(2);
    setProgressMsg('Initializing OCR Engine...');

    try {
      const worker = await createWorker(selectedLang, 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            // we will update progress inside our page loop, but can use this for minor updates
          }
        },
      });

      setProgressPercent(10);
      setProgressMsg('Reading PDF document...');

      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = await import('pdfjs-dist');
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdfDoc.numPages;

      // Create new PDF for the searchable output
      const newPdfDoc = await PDFDocument.create();
      
      let fullExtractedText = '';

      for (let i = 1; i <= numPages; i++) {
        setProgressPercent(10 + ((i - 1) / numPages) * 80);
        setProgressMsg(`Processing page ${i} of ${numPages}...`);

        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas,
        }).promise;

        const dataUrl = canvas.toDataURL('image/png');

        // Run OCR on this page image
        const { data } = await worker.recognize(dataUrl);
        const text = data.text;
        const words = (data as any).words || [];
        fullExtractedText += `--- Page ${i} ---\n${text}\n\n`;

        // Add page to new searchable PDF
        const pdfImage = await newPdfDoc.embedPng(dataUrl);
        const { width, height } = pdfImage.scale(0.5); // scale back down by 2.0
        
        const newPage = newPdfDoc.addPage([width, height]);
        newPage.drawImage(pdfImage, {
          x: 0,
          y: 0,
          width,
          height,
        });

        // Overlay transparent text for searching
        for (const word of words) {
          const { text: wordText, bbox } = word;
          // bbox coordinates are based on the canvas size (scale 2.0)
          // We must scale them back to PDF points
          const x = bbox.x0 / 2.0;
          const y = height - (bbox.y1 / 2.0); // PDF y-axis is bottom-up
          const wordWidth = (bbox.x1 - bbox.x0) / 2.0;
          const wordHeight = (bbox.y1 - bbox.y0) / 2.0;

          // Estimate font size based on bounding box height
          const fontSize = wordHeight * 0.8;

          try {
            newPage.drawText(wordText, {
              x,
              y,
              size: fontSize,
              opacity: 0, // Transparent text!
              color: rgb(0, 0, 0),
            });
          } catch (e) {
            // Ignore characters that might not exist in standard fonts
          }
        }
      }

      setProgressMsg('Finalizing document...');
      setProgressPercent(95);

      await worker.terminate();

      const pdfBytes = (await newPdfDoc.save()).slice();
      const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      
      setResultPdf(pdfBlob);
      setExtractedText(fullExtractedText);
      
      setProgressPercent(100);
      setProgressMsg('Completed!');

    } catch (error) {
      console.error('Error processing OCR:', error);
      alert('An error occurred while processing the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!resultPdf || !file) return;
    const url = URL.createObjectURL(resultPdf);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace('.pdf', '_searchable.pdf');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadText = () => {
    if (!extractedText || !file) return;
    const blob = new Blob([extractedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace('.pdf', '_extracted.txt');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyToClipboard = () => {
    if (!extractedText) return;
    navigator.clipboard.writeText(extractedText);
    alert('Text copied to clipboard!');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-100 text-orange-600 mb-4 shadow-sm">
            <ScanText className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-semibold text-gray-900 mb-3 tracking-tight">OCR PDF</h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Extract text from scanned PDFs or make them searchable.
            Processed locally in your browser for total privacy.
          </p>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          {!resultPdf ? (
            <div className="p-8 sm:p-12">
              <div className="max-w-xl mx-auto space-y-8">
                
                {/* File Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Select PDF Document</label>
                  <div className="relative group">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleFileChange}
                      className="hidden"
                      id="file-upload"
                      disabled={isProcessing}
                    />
                    <label
                      htmlFor="file-upload"
                      className={cn(
                        "flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl cursor-pointer transition-all",
                        file 
                          ? "border-orange-500 bg-orange-50/50" 
                          : "border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-orange-400"
                      )}
                    >
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <FileText className={cn("w-8 h-8 mb-3", file ? "text-orange-600" : "text-gray-400")} />
                        <p className="text-sm font-medium text-gray-700">
                          {file ? file.name : "Click to upload or drag and drop"}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {file ? "Click to change file" : "PDF files only"}
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Language Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    2. Select Document Language
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => setSelectedLang(lang.code)}
                        disabled={isProcessing}
                        className={cn(
                          "flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all",
                          selectedLang === lang.code
                            ? "border-orange-500 bg-orange-50 text-orange-700"
                            : "border-gray-200 bg-white text-gray-600 hover:border-orange-200 hover:bg-gray-50"
                        )}
                      >
                        <Languages className="w-4 h-4" />
                        {lang.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Action Button & Progress */}
                <div className="pt-4">
                  <button
                    onClick={processOcr}
                    disabled={!file || isProcessing}
                    className="w-full py-4 px-6 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-medium text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <ScanText className="w-5 h-5" />
                        Start OCR Processing
                      </>
                    )}
                  </button>

                  {isProcessing && (
                    <div className="mt-6 space-y-2">
                      <div className="flex justify-between text-sm font-medium text-gray-600">
                        <span>{progressMsg}</span>
                        <span>{Math.round(progressPercent)}%</span>
                      </div>
                      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-orange-500 transition-all duration-300 ease-out rounded-full"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <p className="text-xs text-center text-orange-600 mt-2 font-medium">
                        Please do not close this tab. Processing may take a few minutes.
                      </p>
                    </div>
                  )}
                </div>

              </div>
            </div>
          ) : (
            <div className="p-8 sm:p-12">
              <div className="max-w-2xl mx-auto">
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mx-auto mb-6">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-semibold text-center text-gray-900 mb-2">
                  OCR Completed Successfully!
                </h2>
                <p className="text-gray-500 text-center mb-10">
                  Your document has been processed. You can download the searchable PDF or extract the raw text.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <button
                    onClick={handleDownloadPdf}
                    className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 rounded-2xl transition-colors group"
                  >
                    <div className="p-3 bg-white rounded-xl shadow-sm text-orange-600 group-hover:scale-110 transition-transform">
                      <Download className="w-6 h-6" />
                    </div>
                    <div className="text-center">
                      <span className="block font-semibold text-orange-900 mb-1">Searchable PDF</span>
                      <span className="text-xs text-orange-700 opacity-80">Download the PDF with selectable text</span>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadText}
                    className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-2xl transition-colors group"
                  >
                    <div className="p-3 bg-white rounded-xl shadow-sm text-blue-600 group-hover:scale-110 transition-transform">
                      <Type className="w-6 h-6" />
                    </div>
                    <div className="text-center">
                      <span className="block font-semibold text-blue-900 mb-1">Plain Text (.txt)</span>
                      <span className="text-xs text-blue-700 opacity-80">Download the extracted text</span>
                    </div>
                  </button>
                </div>

                <div className="bg-gray-50 rounded-2xl border border-gray-200 p-6 mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-gray-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-500" />
                      Extracted Text Preview
                    </h3>
                    <button
                      onClick={handleCopyToClipboard}
                      className="text-sm text-orange-600 hover:text-orange-700 font-medium"
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4 h-64 overflow-y-auto">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans">
                      {extractedText}
                    </pre>
                  </div>
                </div>

                <div className="text-center">
                  <button
                    onClick={() => {
                      setFile(null);
                      setResultPdf(null);
                      setExtractedText('');
                      setProgressPercent(0);
                    }}
                    className="text-gray-500 hover:text-gray-700 font-medium text-sm transition-colors"
                  >
                    Process another document
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
