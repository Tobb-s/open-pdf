import Link from 'next/link';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  color: string;
  bgColor?: string;
  /**
   * Navigate with a plain anchor rather than a client-side transition.
   *
   * Needed by tools whose route carries headers the browser only applies to a
   * document response — a client-side route change never fetches one.
   */
  fullReload?: boolean;
}

const CARD_CLASS =
  'group relative flex h-full flex-col rounded-2xl border border-gray-100 bg-white p-5 transition-all duration-200 hover:border-gray-200 hover:shadow-md';

export default function ToolCard({
  title,
  description,
  icon: Icon,
  href,
  color,
  bgColor,
  fullReload = false,
}: ToolCardProps) {
  const body = (
    <>
      <div
        className={cn(
          'mb-3 flex h-10 w-10 items-center justify-center rounded-full transition-colors',
          bgColor || 'bg-gray-50'
        )}
      >
        <Icon className={cn('h-5 w-5', color || 'text-gray-600')} />
      </div>
      <h3 className="mb-1 text-base font-medium text-gray-900">{title}</h3>
      <p className="flex-1 text-sm leading-relaxed text-gray-500">{description}</p>
    </>
  );

  if (fullReload) {
    return (
      <a href={href} className={CARD_CLASS}>
        {body}
      </a>
    );
  }

  return (
    <Link href={href} className={CARD_CLASS}>
      {body}
    </Link>
  );
}
