import Link from 'next/link';
import { FileText } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 font-bold text-xl text-red-600">
              <FileText className="w-6 h-6" />
              <span>OpenPDF</span>
            </Link>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <Link href="/merge" className="hover:text-red-600 transition-colors">Merge PDF</Link>
            <Link href="/split" className="hover:text-red-600 transition-colors">Split PDF</Link>
            <Link href="https://github.com/anomalyco/open-pdf" target="_blank" className="hover:text-red-600 transition-colors">GitHub</Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
