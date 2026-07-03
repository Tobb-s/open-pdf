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
}

export default function ToolCard({ title, description, icon: Icon, href, color, bgColor }: ToolCardProps) {
  return (
    <Link 
      href={href} 
      className="group relative p-5 bg-white border border-gray-100 rounded-2xl hover:border-gray-200 hover:shadow-md transition-all duration-200 flex flex-col h-full"
    >
      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center mb-3 transition-colors", bgColor || "bg-gray-50")}>
        <Icon className={cn("w-5 h-5", color || "text-gray-600")} />
      </div>
      <h3 className="text-base font-medium text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed flex-1">{description}</p>
    </Link>
  );
}
