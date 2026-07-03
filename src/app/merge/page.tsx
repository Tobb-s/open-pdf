'use client';

import React, { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import { Upload, FileText, X, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function MergePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultPdf, setResultPdf] = useState<Blob | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const mergePdfs = async () => {
    if (files.length < 2) {
      alert('Please upload at least two PDF files to merge.');
      return;
    }

    setIsProcessing(true);
    try {
      const mergedPdf = await PDFDocument.create();
      
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await PDFDocument.load(arrayBuffer);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const pdfBytes = await mergedPdf.save();
      setResultPdf(new Blob([pdfBytes], { type: 'application/pdf' }));
    } catch (error) {
      console.error('Error merging PDFs:', error);
      alert('An error occurred while merging the PDFs.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPdf = () => {
    if (!resultPdf) return;
    const url = URL.createObjectURL(resultPdf);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged_document.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Merge PDF files</h1>
          <p className="text-gray-600">Combine multiple PDF documents into one single PDF file.</p>
        </div>

        {!resultPdf ? (
          <div className="space-y-8">
            <div 
              className={cn(
                "border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer bg-white",
                files.length > 0 ? "border-red-300" : "border-gray-300 hover:border-red-400"
              )}
              onClick={() => document.getElementById('fileInput')?.click()}
            >
              <input 
                id="fileInput" 
                type="file" 
                multiple 
                accept=".pdf" 
                className="hidden" 
                onChange={handleFileChange} 
              />
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                  <Upload className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-lg font-semibold">Choose PDF files</p>
                  <p className="text-sm text-gray-500">or drag and drop them here</p>
                </div>
              </div>
            </div>

            {files.length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium text-gray-700">{files.length} files selected</h3>
                  <button 
                    onClick={() => setFiles([])}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Clear all
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-white border rounded-xl">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                        <span className="text-sm truncate">{file.name}</span>
                      </div>
                      <button 
                        onClick={() => removeFile(index)}
                        className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center pt-6">
                  <button 
                    onClick={mergePdfs}
                    disabled={files.length < 2 || isProcessing}
                    className="px-8 py-4 bg-red-600 text-white rounded-full font-bold text-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-red-200"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Merge PDF'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center p-12 bg-white border rounded-3xl shadow-sm">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileText className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold mb-2">PDFs Merged Successfully!</h2>
            <p className="text-gray-600 mb-8">Your combined document is ready for download.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button 
                onClick={downloadPdf}
                className="px-8 py-4 bg-red-600 text-white rounded-full font-bold text-lg hover:bg-red-700 transition-all flex items-center gap-2 shadow-lg shadow-red-200"
              >
                <Download className="w-5 h-5" />
                Download PDF
              </button>
              <button 
                onClick={() => setResultPdf(null)}
                className="px-8 py-4 bg-gray-100 text-gray-700 rounded-full font-bold text-lg hover:bg-gray-200 transition-all"
              >
                Merge more files
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
