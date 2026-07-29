'use client';

import React, { useState, useEffect, useRef } from 'react';
import Navbar from '@/components/Navbar';
import { cn } from '@/lib/utils';
import { 
  FileImage, 
  Image as ImageIcon, 
  ArrowRight, 
  Download, 
  Loader2, 
  CheckCircle2, 
  UploadCloud,
  Settings,
  Trash2,
  X,
  FileText
} from 'lucide-react';
import { PDFDocument, PageSizes, degrees } from 'pdf-lib';
import JSZip from 'jszip';

type Mode = 'select' | 'pdf-to-jpg' | 'jpg-to-pdf';

export default function ImagePdfPage() {
  const [mode, setMode] = useState<Mode>('select');
  
  // Shared state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);

  // PDF to JPG state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfToJpgResult, setPdfToJpgResult] = useState<Blob | null>(null);
  
  // JPG to PDF state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [jpgToPdfResult, setJpgToPdfResult] = useState<Blob | null>(null);
  const [margin, setMargin] = useState<'none' | 'small' | 'big'>('none');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Pre-load pdfjs-dist worker for PDF to JPG
    import('pdfjs-dist').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${mod.version}/pdf.worker.min.mjs`;
    });
  }, []);

  const handlePdfFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPdfFile(e.target.files[0]);
      setPdfToJpgResult(null);
    }
  };

  const handleImageFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setImageFiles(prev => [...prev, ...Array.from(e.target.files!)]);
      setJpgToPdfResult(null);
    }
  };

  const removeImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
  };

  const processPdfToJpg = async () => {
    if (!pdfFile) return;
    
    setIsProcessing(true);
    setProgressPercent(5);
    setProgressMsg('Reading PDF document...');
    
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfjsLib = await import('pdfjs-dist');
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdfDoc.numPages;
      
      const zip = new JSZip();
      
      for (let i = 1; i <= numPages; i++) {
        const percent = Math.round((i / numPages) * 90);
        setProgressPercent(percent);
        setProgressMsg(`Converting page ${i} of ${numPages}...`);
        
        const page = await pdfDoc.getPage(i);
        // Use a higher scale for better quality
        const viewport = page.getViewport({ scale: 2.0 });
        
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) continue;
        
        await page.render({
          canvasContext: ctx,
          viewport: viewport,
          canvas: canvas
        }).promise;
        
        // Convert to blob
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', 0.95);
        });
        
        if (blob) {
          // Zero-pad the page number for neat sorting
          const pageNum = i.toString().padStart(numPages.toString().length, '0');
          zip.file(`page_${pageNum}.jpg`, blob);
        }
      }
      
      setProgressPercent(95);
      setProgressMsg('Generating ZIP file...');
      
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      setPdfToJpgResult(zipBlob);
      setProgressPercent(100);
      
    } catch (error) {
      console.error('Error processing PDF to JPG:', error);
      alert('An error occurred while converting the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const processJpgToPdf = async () => {
    if (imageFiles.length === 0) return;
    
    setIsProcessing(true);
    setProgressPercent(10);
    setProgressMsg('Preparing PDF...');
    
    try {
      const pdfDoc = await PDFDocument.create();
      
      // Margin settings in points (1 pt = 1/72 inch)
      const marginPx = margin === 'none' ? 0 : (margin === 'small' ? 20 : 50);
      
      for (let i = 0; i < imageFiles.length; i++) {
        const percent = 10 + Math.round((i / imageFiles.length) * 80);
        setProgressPercent(percent);
        setProgressMsg(`Adding image ${i + 1} of ${imageFiles.length}...`);
        
        const file = imageFiles[i];
        const arrayBuffer = await file.arrayBuffer();
        
        let embeddedImage;
        if (file.type === 'image/png') {
          embeddedImage = await pdfDoc.embedPng(arrayBuffer);
        } else {
          embeddedImage = await pdfDoc.embedJpg(arrayBuffer);
        }
        
        // Define page dimensions (A4)
        const a4Width = orientation === 'portrait' ? PageSizes.A4[0] : PageSizes.A4[1];
        const a4Height = orientation === 'portrait' ? PageSizes.A4[1] : PageSizes.A4[0];
        
        const page = pdfDoc.addPage([a4Width, a4Height]);
        
        // Calculate dimensions to fit the image within the page with margins
        const maxImgWidth = a4Width - (marginPx * 2);
        const maxImgHeight = a4Height - (marginPx * 2);
        
        const imgDims = embeddedImage.scaleToFit(maxImgWidth, maxImgHeight);
        
        // Center the image on the page
        page.drawImage(embeddedImage, {
          x: (a4Width - imgDims.width) / 2,
          y: (a4Height - imgDims.height) / 2,
          width: imgDims.width,
          height: imgDims.height,
        });
      }
      
      setProgressPercent(95);
      setProgressMsg('Finalizing PDF...');
      
      const pdfBytes = (await pdfDoc.save()).slice();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      setJpgToPdfResult(blob);
      setProgressPercent(100);
      
    } catch (error) {
      console.error('Error creating PDF:', error);
      alert('An error occurred while creating the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadPdfToJpg = () => {
    if (!pdfToJpgResult || !pdfFile) return;
    const url = URL.createObjectURL(pdfToJpgResult);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdfFile.name.replace('.pdf', '')}_images.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const handleDownloadJpgToPdf = () => {
    if (!jpgToPdfResult) return;
    const url = URL.createObjectURL(jpgToPdfResult);
    const a = document.createElement('a');
    a.href = url;
    a.download = `images_converted.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderSelectMode = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
      <button
        onClick={() => setMode('pdf-to-jpg')}
        className="group relative bg-white border-2 border-orange-100 hover:border-orange-500 rounded-3xl p-10 text-left transition-all shadow-sm hover:shadow-xl hover:-translate-y-1 overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-orange-50 rounded-bl-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
        <div className="relative">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-4 bg-orange-100 text-orange-600 rounded-2xl">
              <FileText className="w-8 h-8" />
            </div>
            <ArrowRight className="w-6 h-6 text-gray-300 group-hover:text-orange-500 transition-colors" />
            <div className="p-4 bg-yellow-100 text-yellow-600 rounded-2xl">
              <ImageIcon className="w-8 h-8" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">PDF a JPG</h3>
          <p className="text-gray-500 leading-relaxed">
            Extrae todas las imágenes que están dentro de un PDF o convierte cada página en una imagen JPG.
          </p>
        </div>
      </button>

      <button
        onClick={() => setMode('jpg-to-pdf')}
        className="group relative bg-white border-2 border-yellow-100 hover:border-yellow-500 rounded-3xl p-10 text-left transition-all shadow-sm hover:shadow-xl hover:-translate-y-1 overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-50 rounded-bl-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
        <div className="relative">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-4 bg-yellow-100 text-yellow-600 rounded-2xl">
              <ImageIcon className="w-8 h-8" />
            </div>
            <ArrowRight className="w-6 h-6 text-gray-300 group-hover:text-yellow-500 transition-colors" />
            <div className="p-4 bg-orange-100 text-orange-600 rounded-2xl">
              <FileText className="w-8 h-8" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">JPG a PDF</h3>
          <p className="text-gray-500 leading-relaxed">
            Convierte tus imágenes JPG o PNG a PDF. Ajusta la orientación y los márgenes fácilmente.
          </p>
        </div>
      </button>
    </div>
  );

  const renderPdfToJpg = () => (
    <div className="max-w-3xl mx-auto bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden p-8 sm:p-12">
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => setMode('select')} className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowRight className="w-6 h-6 rotate-180" />
        </button>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          <FileText className="w-6 h-6 text-orange-500" />
          PDF a JPG
        </h2>
      </div>

      {!pdfToJpgResult ? (
        <div className="space-y-8">
          {!pdfFile ? (
            <div className="relative group">
              <input
                type="file"
                accept=".pdf"
                onChange={handlePdfFileChange}
                className="hidden"
                id="pdf-upload"
                disabled={isProcessing}
              />
              <label
                htmlFor="pdf-upload"
                className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-orange-400 rounded-3xl cursor-pointer transition-all"
              >
                <UploadCloud className="w-12 h-12 text-gray-400 mb-4 group-hover:text-orange-500 transition-colors" />
                <p className="text-lg font-medium text-gray-700">Select PDF document</p>
                <p className="text-sm text-gray-500 mt-1">or drag and drop here</p>
              </label>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-5 bg-orange-50 border border-orange-100 rounded-2xl">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-xl text-orange-600 shadow-sm">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{pdfFile.name}</p>
                    <p className="text-sm text-gray-500">{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
                <button
                  onClick={() => setPdfFile(null)}
                  disabled={isProcessing}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-white rounded-full transition-colors disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {isProcessing && (
                <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-3">
                  <div className="flex justify-between text-sm font-medium text-gray-700">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                      {progressMsg}
                    </span>
                    <span className="text-orange-600">{progressPercent}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={processPdfToJpg}
                disabled={isProcessing}
                className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-bold text-lg transition-colors flex justify-center items-center gap-2 disabled:opacity-50"
              >
                {isProcessing ? 'Processing...' : 'Convert to JPG'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">Conversion Complete!</h3>
          <p className="text-gray-500 mb-8">Your PDF pages have been converted to JPG images.</p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={handleDownloadPdfToJpg}
              className="px-8 py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-full font-bold text-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-200"
            >
              <Download className="w-5 h-5" />
              Download Images (ZIP)
            </button>
            <button
              onClick={() => {
                setPdfToJpgResult(null);
                setPdfFile(null);
                setProgressPercent(0);
              }}
              className="px-8 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full font-bold text-lg transition-all"
            >
              Convert Another
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderJpgToPdf = () => (
    <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden p-8">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => setMode('select')} className="text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowRight className="w-6 h-6 rotate-180" />
          </button>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <ImageIcon className="w-6 h-6 text-yellow-500" />
            JPG a PDF
          </h2>
        </div>

        {!jpgToPdfResult ? (
          <div className="space-y-6">
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              multiple
              onChange={handleImageFilesChange}
              className="hidden"
              id="image-upload"
              ref={fileInputRef}
              disabled={isProcessing}
            />
            
            {imageFiles.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {imageFiles.map((file, idx) => (
                  <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
                    {/* Object URL for preview - in a real app, revoke these later to avoid memory leaks */}
                    <img 
                      src={URL.createObjectURL(file)} 
                      alt={file.name} 
                      className="w-full h-full object-cover" 
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button 
                        onClick={() => removeImage(idx)}
                        className="p-2 bg-white text-red-500 rounded-full hover:scale-110 transition-transform"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-2xl border-2 border-dashed border-gray-300 hover:border-yellow-500 hover:bg-yellow-50 flex flex-col items-center justify-center text-gray-500 hover:text-yellow-600 transition-all cursor-pointer"
                >
                  <UploadCloud className="w-8 h-8 mb-2" />
                  <span className="font-medium">Add more</span>
                </button>
              </div>
            ) : (
              <label
                htmlFor="image-upload"
                className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-yellow-400 rounded-3xl cursor-pointer transition-all"
              >
                <FileImage className="w-16 h-16 text-gray-400 mb-4 group-hover:text-yellow-500 transition-colors" />
                <p className="text-xl font-medium text-gray-700">Select images</p>
                <p className="text-sm text-gray-500 mt-2">JPG, PNG, WEBP allowed. Select multiple.</p>
              </label>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-12 h-12" />
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-3">PDF Created!</h3>
            <p className="text-lg text-gray-500 mb-10">Your images have been successfully combined into a single PDF.</p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={handleDownloadJpgToPdf}
                className="px-10 py-4 bg-yellow-500 hover:bg-yellow-600 text-white rounded-full font-bold text-xl transition-all flex items-center justify-center gap-3 shadow-xl shadow-yellow-200"
              >
                <Download className="w-6 h-6" />
                Download PDF
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar options */}
      {!jpgToPdfResult && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 h-fit">
          <div className="flex items-center gap-2 mb-6 text-gray-900 font-bold text-lg">
            <Settings className="w-5 h-5 text-gray-400" />
            PDF Settings
          </div>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Orientation</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setOrientation('portrait')}
                  className={cn(
                    "py-3 px-4 rounded-xl border text-sm font-medium transition-all flex flex-col items-center gap-2",
                    orientation === 'portrait' 
                      ? "border-yellow-500 bg-yellow-50 text-yellow-700" 
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  <div className="w-6 h-8 border-2 border-current rounded-sm" />
                  Portrait
                </button>
                <button
                  onClick={() => setOrientation('landscape')}
                  className={cn(
                    "py-3 px-4 rounded-xl border text-sm font-medium transition-all flex flex-col items-center gap-2",
                    orientation === 'landscape' 
                      ? "border-yellow-500 bg-yellow-50 text-yellow-700" 
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  <div className="w-8 h-6 border-2 border-current rounded-sm" />
                  Landscape
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Margins</label>
              <div className="space-y-2">
                {[
                  { id: 'none', label: 'No margin' },
                  { id: 'small', label: 'Small margin' },
                  { id: 'big', label: 'Big margin' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setMargin(opt.id as any)}
                    className={cn(
                      "w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-all flex items-center justify-between",
                      margin === opt.id
                        ? "border-yellow-500 bg-yellow-50 text-yellow-700"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    {opt.label}
                    {margin === opt.id && <CheckCircle2 className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100">
              <button
                onClick={processJpgToPdf}
                disabled={imageFiles.length === 0 || isProcessing}
                className="w-full py-4 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl font-bold text-lg transition-colors flex justify-center items-center gap-2 disabled:opacity-50 shadow-md"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating PDF...
                  </>
                ) : (
                  'Convert to PDF'
                )}
              </button>
            </div>
            
            {isProcessing && (
              <div className="text-center text-sm font-medium text-gray-500 animate-pulse">
                {progressMsg} ({progressPercent}%)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col">
      <Navbar />
      <main className="flex-1 w-full px-4 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-100/70 text-yellow-700 text-xs font-semibold rounded-full mb-3">
            <Settings className="w-3.5 h-3.5 fill-yellow-600 text-yellow-600" />
            100% In-Browser Processing
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
            Imágenes y PDF
          </h1>
          <p className="text-lg text-gray-600 max-w-xl mx-auto">
            {mode === 'select' && 'Elige la herramienta que necesitas. Todo se procesa de forma segura en tu navegador.'}
            {mode === 'pdf-to-jpg' && 'Convierte las páginas de tu documento PDF en imágenes de alta calidad.'}
            {mode === 'jpg-to-pdf' && 'Une múltiples imágenes en un solo documento PDF con formato.'}
          </p>
        </div>

        {mode === 'select' && renderSelectMode()}
        {mode === 'pdf-to-jpg' && renderPdfToJpg()}
        {mode === 'jpg-to-pdf' && renderJpgToPdf()}
      </main>
    </div>
  );
}
