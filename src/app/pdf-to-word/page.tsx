'use client';

import React, { useState, useEffect } from 'react';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import Navbar from '@/components/Navbar';
import { Upload, FileText, X, Download, Loader2 } from 'lucide-react';

export default function PdfToWordPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultReady, setResultReady] = useState(false);

  useEffect(() => {
    import('pdfjs-dist').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${mod.version}/pdf.worker.min.mjs`;
    });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const convertToWord = async () => {
    if (!file) return;
    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const mod = await import('pdfjs-dist');
      const pdf = await mod.getDocument({ data: arrayBuffer }).promise;
      const paragraphs: Paragraph[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        let currentText = '';

        const items = textContent.items;
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          if ('str' in item) {
            currentText += item.str;
            const nextItem = items[j + 1];
            if (nextItem && 'transform' in nextItem && 'transform' in item) {
              const currentY = item.transform[5];
              const nextY = nextItem.transform[5];
              if (Math.abs(nextY - currentY) > viewport.height * 0.02) {
                paragraphs.push(new Paragraph({ children: [new TextRun({ text: currentText })] }));
                currentText = '';
              }
            }
          }
        }
        if (currentText.trim()) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: currentText })] }));
        }
        if (i < pdf.numPages) {
          paragraphs.push(new Paragraph({ children: [] }));
        }
      }

      const doc = new Document({
        title: file.name.replace('.pdf', ''),
        sections: [{ children: paragraphs }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace('.pdf', '.docx');
      a.click();
      URL.revokeObjectURL(url);
      setResultReady(true);
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred while converting the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">PDF to Word</h1>
          <p className="text-gray-600">Convert PDF files to editable Word documents.</p>
        </div>

        {!resultReady ? (
          <div className="space-y-8">
            {!file ? (
              <div
                className="border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer bg-white border-gray-300 hover:border-red-400 transition-all"
                onClick={() => document.getElementById('fileInput')?.click()}
              >
                <input id="fileInput" type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                    <Upload className="w-8 h-8" />
                  </div>
                  <p className="text-lg font-semibold">Choose PDF file</p>
                  <p className="text-sm text-gray-500">Your text will be extracted and converted to .docx</p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-white border rounded-2xl">
                  <div className="flex items-center gap-3">
                    <FileText className="w-6 h-6 text-blue-500 shrink-0" />
                    <span className="font-medium truncate">{file.name}</span>
                  </div>
                  <button
                    onClick={() => { setFile(null); setResultReady(false); }}
                    className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex justify-center pt-4">
                  <button
                    onClick={convertToWord}
                    disabled={isProcessing}
                    className="px-8 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-blue-200"
                  >
                    {isProcessing ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Converting...</>
                    ) : 'Convert to Word'}
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
            <h2 className="text-2xl font-bold mb-2">Word Document Ready!</h2>
            <p className="text-gray-600 mb-8">The download should start automatically.</p>
            <button
              onClick={() => { setResultReady(false); setFile(null); }}
              className="px-8 py-4 bg-gray-100 text-gray-700 rounded-full font-bold text-lg hover:bg-gray-200"
            >
              Convert another file
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
