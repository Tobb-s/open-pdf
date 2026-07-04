import Navbar from '@/components/Navbar';
import ToolCard from '@/components/ToolCard';
import { Combine, Split, FileType, PenSquare, FormInput } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const tools = [
    {
      title: 'Merge PDF',
      description: 'Combine PDFs into a single document.',
      icon: Combine,
      href: '/merge',
      bgColor: 'bg-blue-50',
      color: 'text-blue-600',
    },
    {
      title: 'Split PDF',
      description: 'Extract pages or ranges from a PDF.',
      icon: Split,
      href: '/split',
      bgColor: 'bg-red-50',
      color: 'text-red-500',
    },
    {
      title: 'PDF to Word',
      description: 'Convert PDF to an editable .docx file.',
      icon: FileType,
      href: '/pdf-to-word',
      bgColor: 'bg-indigo-50',
      color: 'text-indigo-500',
    },
    {
      title: 'Edit PDF',
      description: 'Add text annotations to any page.',
      icon: PenSquare,
      href: '/edit',
      bgColor: 'bg-purple-50',
      color: 'text-purple-500',
    },
    {
      title: 'Fill Form',
      description: 'Complete interactive PDF forms.',
      icon: FormInput,
      href: '/fill-form',
      bgColor: 'bg-teal-50',
      color: 'text-teal-500',
    },
  ];

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 sm:px-8">
        <section className="pt-24 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 border border-blue-100 rounded-full text-sm text-blue-700 mb-8 font-medium">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            100% free &amp; open-source
          </div>
          <h1 className="text-5xl sm:text-6xl font-medium text-gray-900 tracking-tight mb-5 leading-tight">
            PDF tools,<br />
            <span className="font-semibold">right in your browser</span>
          </h1>
          <p className="text-lg text-gray-500 max-w-xl mx-auto mb-10 leading-relaxed">
            No uploads, no servers, no limits. Everything you need to work with PDFs, 
            processed locally on your device.
          </p>
          <div className="relative max-w-lg mx-auto">
            <div className="flex items-center bg-white border border-gray-200 hover:border-gray-300 rounded-full pl-5 pr-2 py-2 shadow-sm transition-all focus-within:border-blue-400 focus-within:shadow-md">
              <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input 
                type="text" 
                placeholder="Search tools..." 
                className="flex-1 px-3 py-2 text-sm outline-none text-gray-700 placeholder-gray-400 bg-transparent"
                readOnly
              />
              <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-xs text-gray-400 bg-gray-50 border rounded-md font-mono">Ctrl+K</kbd>
            </div>
          </div>
        </section>

        <section className="pb-24">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools.map((tool) => (
              <ToolCard key={tool.title} {...tool} />
            ))}
          </div>
        </section>

        <section className="pb-24">
          <div className="bg-gray-50 border border-gray-100 rounded-3xl p-10 sm:p-14 text-center">
            <div className="flex justify-center gap-10 mb-8">
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </div>
                <span className="text-sm font-medium text-gray-700">Private</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <span className="text-sm font-medium text-gray-700">Fast</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Link href="https://github.com/Tobb-s/open-pdf" target="_blank" className="flex flex-col items-center gap-2 group">
                  <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-gray-100 transition-colors">
                    <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Open Source</span>
                </Link>
              </div>
            </div>
            <h2 className="text-2xl font-medium text-gray-900 mb-3">Why OpenPDF?</h2>
            <p className="text-gray-500 max-w-2xl mx-auto text-sm leading-relaxed">
              Unlike other online PDF tools, OpenPDF processes everything locally using JavaScript. 
              Your sensitive documents never leave your device, ensuring complete privacy.
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        <p>OpenPDF &mdash; Free &amp; open-source.</p>
      </footer>
    </div>
  );
}
