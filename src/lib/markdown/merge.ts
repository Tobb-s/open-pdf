/**
 * Unifies multiple Markdown documents into a single cohesive document.
 */

export type MergeSeparatorStyle = 'divider' | 'heading' | 'both' | 'blank';

export interface MarkdownFileItem {
  id: string;
  name: string;
  content: string;
  size: number;
}

export interface MergeOptions {
  separator: MergeSeparatorStyle;
  addTitleHeading?: boolean;
}

export interface MergeStats {
  filesCount: number;
  totalLines: number;
  totalWords: number;
  totalCharacters: number;
}

/**
 * Derives a clean document title from a filename (e.g. "01_intro-chapter.md" -> "01 Intro Chapter").
 */
export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/**
 * Calculates word and character statistics for a string of text.
 */
export function countMarkdownStats(text: string): { lines: number; words: number; chars: number } {
  const lines = text.split(/\r?\n/).length;
  const words = (text.match(/\b[\w'-]+\b/g) ?? []).length;
  const chars = text.length;
  return { lines, words, chars };
}

/**
 * Merges an array of Markdown files into a single unified Markdown text.
 */
export function mergeMarkdownFiles(
  files: MarkdownFileItem[],
  options: MergeOptions = { separator: 'both', addTitleHeading: true }
): { content: string; stats: MergeStats } {
  if (files.length === 0) {
    return {
      content: '',
      stats: { filesCount: 0, totalLines: 0, totalWords: 0, totalCharacters: 0 },
    };
  }

  const sections: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const cleanContent = file.content.trim();
    const title = titleFromFilename(file.name);

    let sectionText = '';

    const needsHeader =
      options.addTitleHeading || options.separator === 'heading' || options.separator === 'both';

    if (needsHeader) {
      // Check if file already begins with an H1 heading matching the title
      const alreadyHasH1 = /^#\s+/m.test(cleanContent.slice(0, 100));
      if (!alreadyHasH1) {
        sectionText += `# ${title}\n\n`;
      }
    }

    sectionText += cleanContent;

    if (i < files.length - 1) {
      if (options.separator === 'divider' || options.separator === 'both') {
        sectionText += '\n\n---\n\n';
      } else if (options.separator === 'blank') {
        sectionText += '\n\n\n';
      } else {
        sectionText += '\n\n';
      }
    }

    sections.push(sectionText);
  }

  const merged = sections.join('');
  const counts = countMarkdownStats(merged);

  return {
    content: merged,
    stats: {
      filesCount: files.length,
      totalLines: counts.lines,
      totalWords: counts.words,
      totalCharacters: counts.chars,
    },
  };
}
