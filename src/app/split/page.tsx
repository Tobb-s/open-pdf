'use client';

import React, { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import { Upload, FileText, X, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SplitPage() {
  const [file, setFile] = useState<File | null>(null);
  const [range, setRange] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultPdf, setResultPdf] = useState<Blob | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      
      try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const pdf = await PDFDocument.load(arrayBuffer);
        setPageCount(pdf.getPageCount());
      } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Invalid PDF file.');
        setFile(null);
      }
    }
  };

  const parseRange = (rangeStr: string, maxPages: number) => {
    const pages: number[] = [];
    const parts = rangeStr.split(',');

    for (let part of parts) {
      part = part.trim();
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
            pages.push(i);
          }
        }
      } else {
        const page = Number(part);
        if (!isNaN(page) && page >= 1 && page <= maxPages) {
          pages.push(page);
        }
      }
    }
    return [...new Set(pages)].sort((a, b) => a - b);
  };

  const splitPdf = async () => {
    if (!file || !range) {
      alert('Please upload a PDF and specify the page range.');
      return;
    }

    if (!pageCount) return;

    const targetPages = parseRange(range, pageCount);
    if (targetPages.length === 0) {
      alert('Please enter a valid page range.');
      return;
    }

    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(arrayBuffer);
      const newPdf = await PDFDocument.create();
      
      const copiedPages = await newPdf.copyPages(pdf, targetPages.map(p => p - 1));
      copiedPages.forEach(page => newPdf.addPage(page));

      const pdfBytes = (await newPdf.save()).slice();
      setResultPdf(new Blob([pdfBytes], { type: 'application/pdf' }));
    } catch (error) {
      console.error('Error splitting PDF:', error);
      alert('An error occurred while splitting the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPdf = () => {
    if (!resultPdf) return;
    const url = URL.createObjectURL(resultPdf);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'split_document.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Split PDF file</h1>
          <p className="text-gray-600">Extract specific pages or ranges from your PDF document.</p>
        </div>

        {!resultPdf ? (
          <div className="space-y-8">
            {!file ? (
              <div 
                className="border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer bg-white border-gray-300 hover:border-blue-400"
                onClick={() => document.getElementById('fileInput')?.click()}
              >
                <input 
                  id="fileInput" 
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
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-white border rounded-2xl">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <FileText className="w-6 h-6 text-blue-500 shrink-0" />
                    <span className="font-medium truncate">{file.name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                      {pageCount} pages
                    </span>
                  </div>
                  <button 
                    onClick={() => { setFile(null); setRange(''); setResultPdf(null); }}
                    className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-blue-500 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-white border rounded-3xl p-6 shadow-sm space-y-4">
                  <label className="block text-sm font-medium text-gray-700">
                    Page Range
                  </label>
                  <div className="flex gap-4">
                    <input 
                      type="text" 
                      value={range}
                      onChange={(e) => setRange(e.target.value)}
                      placeholder="e.g. 1-3, 5, 8-10"
                      className="flex-1 px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    />
                    <button 
                      onClick={splitPdf}
                      disabled={!range || isProcessing}
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Splitting...
                        </>
                      ) : (
                        'Extract Pages'
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Tip: Use commas to separate ranges or single pages. Example: 1-2, 5, 7-10
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center p-12 bg-white border rounded-3xl shadow-sm">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileText className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold mb-2">PDF Split Successfully!</h2>
            <p className="text-gray-600 mb-8">Your extracted pages are ready for download.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button 
                onClick={downloadPdf}
                className="px-8 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-200"
              >
                <Download className="w-5 h-5" />
                Download PDF
              </button>
              <button 
                onClick={() => { setResultPdf(null); setFile(null); setRange(''); }}
                className="px-8 py-4 bg-gray-100 text-gray-700 rounded-full font-bold text-lg hover:bg-gray-200 transition-all"
              >
                Split another file
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
