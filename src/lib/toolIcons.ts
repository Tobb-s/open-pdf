import {
  Combine,
  FileStack,
  FileType,
  FormInput,
  Hash,
  Image as ImageIcon,
  Minimize2,
  PenSquare,
  Presentation,
  ScanText,
  Split,
  SquarePen,
  Stamp,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { ToolSlug } from '@/lib/tools';

/**
 * One icon per tool, shared by everything that lists them — the front page, the
 * navigation panel, the page-not-found suggestions. Typed by slug, so adding a
 * tool without an icon fails to compile rather than rendering a hole.
 */
export const TOOL_ICONS: Record<ToolSlug, LucideIcon> = {
  compress: Minimize2,
  ocr: ScanText,
  merge: Combine,
  split: Split,
  organize: FileStack,
  'pdf-to-word': FileType,
  edit: PenSquare,
  'fill-form': FormInput,
  'office-to-pdf': Presentation,
  'image-pdf': ImageIcon,
  watermark: Stamp,
  'page-numbers': Hash,
  batch: Workflow,
  studio: SquarePen,
};
