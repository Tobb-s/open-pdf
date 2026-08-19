import Link from 'next/link';
import { FileText } from 'lucide-react';
import { TOOLS } from '@/lib/tools';

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-xl tracking-tight text-gray-800"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
              <FileText className="h-5 w-5" />
            </div>
            <span className="font-semibold text-gray-900">
              Open<span className="font-normal text-gray-500">PDF</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 overflow-x-auto text-sm font-medium md:flex">
            {TOOLS.map((tool) => (
              <Link
                key={tool.slug}
                href={`/${tool.slug}`}
                className="whitespace-nowrap rounded-full px-3 py-2 text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
              >
                {tool.navLabel}
              </Link>
            ))}
            <div className="mx-2 h-4 w-px bg-gray-200" />
            <Link
              href="https://github.com/Tobb-s/open-pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap rounded-full px-3 py-2 text-gray-500 transition-all hover:bg-gray-50 hover:text-gray-900"
            >
              GitHub
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
