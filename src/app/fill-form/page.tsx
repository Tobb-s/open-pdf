'use client';

import React, { useState } from 'react';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import { Upload, FileText, X, Download, Loader2 } from 'lucide-react';

interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio';
  value: string;
  options?: string[];
}

export default function FillFormPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultPdf, setResultPdf] = useState<Blob | null>(null);
  const [loadingFields, setLoadingFields] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setResultPdf(null);
      const arrayBuffer = await selectedFile.arrayBuffer();
      setPdfData(arrayBuffer);
      await detectFormFields(arrayBuffer);
    }
  };

  const detectFormFields = async (buffer: ArrayBuffer) => {
    setLoadingFields(true);
    try {
      const pdfDoc = await PDFDocument.load(buffer);
      const form = pdfDoc.getForm();
      const detected: FormField[] = [];

      const pdfFields = form.getFields();
      for (const field of pdfFields) {
        const name = field.getName();
        if (field instanceof PDFTextField) {
          detected.push({ name, type: 'text', value: field.getText() || '' });
        } else if (field instanceof PDFCheckBox) {
          detected.push({ name, type: 'checkbox', value: field.isChecked() ? 'true' : 'false' });
        } else if (field instanceof PDFDropdown) {
          const options = field.getOptions();
          detected.push({ name, type: 'dropdown', value: field.getSelected() || '', options });
        } else if (field instanceof PDFRadioGroup) {
          const options = field.getOptions();
          detected.push({ name, type: 'radio', value: field.getSelected() || '', options });
        }
      }
      setFields(detected);
    } catch (error) {
      console.error('Error detecting form fields:', error);
      if (!error || (typeof error === 'object' && 'message' in (error as any) && !(error as any).message?.includes('form'))) {
        alert('No form fields detected in this PDF.');
      }
    } finally {
      setLoadingFields(false);
    }
  };

  const updateField = (index: number, value: string) => {
    setFields(prev => prev.map((f, i) => i === index ? { ...f, value } : f));
  };

  const fillForm = async () => {
    if (!pdfData) return;
    setIsProcessing(true);
    try {
      const pdfDoc = await PDFDocument.load(pdfData);
      const form = pdfDoc.getForm();

      for (const field of fields) {
        try {
          if (field.type === 'text') {
            const textField = form.getTextField(field.name);
            textField.setText(field.value);
          } else if (field.type === 'checkbox') {
            const cb = form.getCheckBox(field.name);
            if (field.value === 'true') cb.check(); else cb.uncheck();
          } else if (field.type === 'dropdown') {
            const dd = form.getDropdown(field.name);
            dd.select(field.value);
          } else if (field.type === 'radio') {
            const rg = form.getRadioGroup(field.name);
            rg.select(field.value);
          }
        } catch {
        }
      }

      const pdfBytes = (await pdfDoc.save()).slice();
      setResultPdf(new Blob([pdfBytes], { type: 'application/pdf' }));
    } catch (error) {
      console.error('Error filling form:', error);
      alert('An error occurred while filling the form.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPdf = () => {
    if (!resultPdf) return;
    const url = URL.createObjectURL(resultPdf);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filled_form.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Fill PDF Form</h1>
          <p className="text-gray-600">Complete interactive PDF forms directly in your browser.</p>
        </div>

        {!file ? (
          <div className="border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer bg-white border-gray-300 hover:border-red-400 transition-all"
            onClick={() => document.getElementById('fileInput')?.click()}>
            <input id="fileInput" type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center">
                <Upload className="w-8 h-8" />
              </div>
              <p className="text-lg font-semibold">Choose PDF form</p>
              <p className="text-sm text-gray-500">Files with fillable form fields</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-white border rounded-2xl">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-teal-500 shrink-0" />
                <span className="font-medium truncate">{file.name}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                  {fields.length} fields detected
                </span>
              </div>
              <button onClick={() => { setFile(null); setPdfData(null); setFields([]); }}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingFields ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
                <span className="ml-3 text-gray-600">Detecting form fields...</span>
              </div>
            ) : fields.length === 0 ? (
              <div className="text-center p-12 bg-white border rounded-3xl">
                <p className="text-gray-500">No form fields were detected in this PDF.</p>
                <p className="text-sm text-gray-400 mt-2">Try a PDF that contains interactive form fields.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white border rounded-3xl p-6 shadow-sm">
                  <h3 className="font-semibold text-gray-700 mb-6">Form Fields</h3>
                  <div className="space-y-5">
                    {fields.map((field, index) => (
                      <div key={field.name + index}>
                        <label className="block text-sm font-medium text-gray-600 mb-1.5 capitalize">
                          {field.name.replace(/[<>]/g, '').replace(/_/g, ' ')}
                          <span className="text-xs text-gray-400 ml-2">({field.type})</span>
                        </label>
                        {field.type === 'text' && (
                          <input type="text" value={field.value}
                            onChange={(e) => updateField(index, e.target.value)}
                            className="w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none" />
                        )}
                        {field.type === 'checkbox' && (
                          <button onClick={() => updateField(index, field.value === 'true' ? 'false' : 'true')}
                            className={`px-6 py-2 rounded-xl font-medium text-sm border transition-all ${field.value === 'true' ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-300 hover:border-teal-400'}`}>
                            {field.value === 'true' ? '✓ Checked' : 'Unchecked'}
                          </button>
                        )}
                        {field.type === 'dropdown' && (
                          <select value={field.value} onChange={(e) => updateField(index, e.target.value)}
                            className="w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white">
                            <option value="">Select...</option>
                            {field.options?.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        )}
                        {field.type === 'radio' && (
                          <div className="flex flex-wrap gap-3">
                            {field.options?.map(opt => (
                              <button key={opt} onClick={() => updateField(index, opt)}
                                className={`px-4 py-2 rounded-xl text-sm border transition-all ${field.value === opt ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-300 hover:border-teal-400'}`}>
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-center pt-2">
                  <button onClick={fillForm} disabled={isProcessing}
                    className="px-8 py-4 bg-teal-600 text-white rounded-full font-bold text-lg hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-teal-200">
                    {isProcessing ? <><Loader2 className="w-5 h-5 animate-spin" /> Filling...</> : 'Download Filled PDF'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {resultPdf && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="text-center p-12 bg-white border rounded-3xl shadow-xl max-w-md mx-4">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <FileText className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Form Filled Successfully!</h2>
              <p className="text-gray-600 mb-8">Your completed form is ready for download.</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={downloadPdf}
                  className="px-8 py-4 bg-teal-600 text-white rounded-full font-bold text-lg hover:bg-teal-700 flex items-center gap-2">
                  <Download className="w-5 h-5" /> Download PDF
                </button>
                <button onClick={() => { setResultPdf(null); setFile(null); setPdfData(null); setFields([]); }}
                  className="px-8 py-4 bg-gray-100 text-gray-700 rounded-full font-bold text-lg hover:bg-gray-200">
                  Fill another form
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
