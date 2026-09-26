import type { Metadata } from 'next';
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return { title: lang === 'es' ? 'Mi cuenta · OpenPDF' : 'My account · OpenPDF', robots: { index: false, follow: false } };
}
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
