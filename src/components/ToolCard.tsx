import Link from 'next/link';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  color: string;
}

export default function ToolCard({ title, description, icon: Icon, href, color }: ToolCardProps) {
  return (
    <Link href={href} className="group relative p-6 bg-white border rounded-2xl hover:shadow-xl transition-all duration-300 hover:-translate-y-1 flex flex-col h-full">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors", color)}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <h3 className="text-lg font-semibold mb-2 group-hover:text-red-600 transition-colors">{title}</h3>
      <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
    </Link>
  );
}
