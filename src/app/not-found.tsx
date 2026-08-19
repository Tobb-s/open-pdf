import Link from 'next/link';
import Navbar from '@/components/Navbar';
import ToolCard from '@/components/ToolCard';
import { FileQuestion } from 'lucide-react';
import { TOOLS } from '@/lib/tools';
import { Combine, FileStack, Minimize2, ScanText } from 'lucide-react';

const SUGGESTED = ['merge', 'split', 'compress', 'ocr'] as const;
const ICONS = {
  merge: Combine,
  split: FileStack,
  compress: Minimize2,
  ocr: ScanText,
} as const;

export default function NotFound() {
  const suggestions = TOOLS.filter((tool) =>
    (SUGGESTED as readonly string[]).includes(tool.slug)
  );

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-24">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <FileQuestion className="h-8 w-8" />
          </div>
          <h1 className="mb-3 text-4xl font-bold tracking-tight text-gray-900">
            That page does not exist
          </h1>
          <p className="mx-auto mb-10 max-w-md text-gray-500">
            The link may be out of date, or the address slightly off. Here is where most people
            were heading.
          </p>
        </div>

        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {suggestions.map((tool) => (
            <ToolCard
              key={tool.slug}
              title={tool.title}
              description={tool.tagline}
              icon={ICONS[tool.slug as keyof typeof ICONS]}
              href={`/${tool.slug}`}
              color={tool.color}
              bgColor={tool.bgColor}
            />
          ))}
        </div>

        <p className="text-center">
          <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            See all tools
          </Link>
        </p>
      </main>
    </div>
  );
}
