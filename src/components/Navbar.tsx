import Link from 'next/link';
import { FileText } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 sm:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 font-google text-xl text-gray-800 tracking-tight">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                <FileText className="w-5 h-5" />
              </div>
              <span className="font-semibold text-gray-900">Open<span className="font-normal text-gray-500">PDF</span></span>
            </Link>
          </div>
          <div className="hidden md:flex items-center gap-2 text-sm font-medium">
            <Link href="/merge" className="px-4 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-full transition-all">Merge</Link>
            <Link href="/split" className="px-4 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-full transition-all">Split</Link>
            <Link href="/pdf-to-word" className="px-4 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-full transition-all">PDF to Word</Link>
            <Link href="/edit" className="px-4 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-full transition-all">Edit</Link>
            <Link href="/fill-form" className="px-4 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-full transition-all">Fill Form</Link>
            <div className="h-4 w-px bg-gray-200 mx-2" />
            <Link href="https://github.com/Tobb-s/open-pdf" target="_blank" className="px-3 py-2 text-gray-500 hover:bg-gray-50 hover:text-gray-900 rounded-full transition-all">
              GitHub
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
