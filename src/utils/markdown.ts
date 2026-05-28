export interface ParsedMarkdown {
  frontMatter: string | null;
  body: string;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export function splitFrontMatter(content: string): ParsedMarkdown {
  const match = FRONT_MATTER_RE.exec(content);
  if (!match || !match[1] || !match[2]) {
    return { frontMatter: null, body: content };
  }
  return { frontMatter: match[1], body: match[2] };
}
