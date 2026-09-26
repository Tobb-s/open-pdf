import type { Metadata } from 'next';
import { toolMetadata } from '@/lib/i18n/metadata';
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  return toolMetadata('translate', (await params).lang);
}
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
