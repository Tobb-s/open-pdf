import Navbar from '@/components/Navbar';
import ToolCard from '@/components/ToolCard';
import { Combine, Split, FileText, ShieldCheck, GitFork } from 'lucide-react';

export default function Home() {
  const tools = [
    {
      title: 'Merge PDF',
      description: 'Combine multiple PDF files into one single document in seconds.',
      icon: Combine,
      href: '/merge',
      color: 'bg-blue-500',
    },
    {
      title: 'Split PDF',
      description: 'Separate one page or a range of pages from your PDF document.',
      icon: Split,
      href: '/split',
      color: 'bg-red-500',
    },
    // We can add more later like Compress, PDF to Word, etc.
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-extrabold text-gray-900 mb-6 tracking-tight">
            Every tool you need to work with <span className="text-red-600">PDFs</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            100% free, open-source, and private. Your files are processed in your browser
            and never leave your device.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-24">
          {tools.map((tool) => (
            <ToolCard key={tool.title} {...tool} />
          ))}
        </div>

        <div className="bg-white border rounded-3xl p-8 md:p-12 text-center">
          <div className="flex justify-center gap-8 mb-8">
            <div className="flex flex-col items-center gap-2">
              <ShieldCheck className="w-10 h-10 text-green-500" />
              <span className="font-semibold">Private</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <FileText className="w-10 h-10 text-blue-500" />
              <span className="font-semibold">Fast</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <GitFork className="w-10 h-10 text-gray-800" />
              <span className="font-semibold">Open Source</span>
            </div>
          </div>
          <h2 className="text-3xl font-bold mb-4">Why OpenPDF?</h2>
          <p className="text-gray-600 max-w-3xl mx-auto text-lg">
            Unlike other online PDF tools, OpenPDF processes everything locally using JavaScript. 
            This means your sensitive documents are never uploaded to a server, ensuring 
            complete privacy and security.
          </p>
        </div>
      </main>
      <footer className="border-t bg-white py-12 text-center text-gray-500 text-sm">
        <p>© {new Date().getFullYear()} OpenPDF. Built for the community.</p>
      </footer>
    </div>
  );
}
