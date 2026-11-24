// Many links at once, from a list someone pasted or a CSV out of a spreadsheet: one link per
// line, a name after a comma (or a semicolon, or a tab, which is how Excel in Portuguese and
// a copied column come out). A first line that is only headings is skipped.

export interface BulkLine {
  line: number;
  url: string;
  alias: string;
}

export const BULK_MAX = 50;

const unquote = (cell: string) => cell.trim().replace(/^"(.*)"$/, '$1').trim();

// Links have commas of their own (?ids=1,2,3, Google Maps coordinates), so only the last
// separator splits the line, and only when what comes after it looks like a name.
// Splitting on every comma cut those links in half and took the rest as the name.
function cellsOf(raw: string): [string, string] {
  const sep = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : ',';
  const at = raw.lastIndexOf(sep);
  if (at < 0) return [unquote(raw), ''];
  const before = raw.slice(0, at);
  const after = unquote(raw.slice(at + 1));
  if (!after) return [unquote(before), ''];
  // a tab or a semicolon always splits; a comma only when a name follows it (a name starts
  // with a letter), and not when it sits right after a query (?) or coordinates (@)
  if (sep !== ',') return [unquote(before), after];
  const looksLikeName = /^[a-z][a-z0-9-]{2,31}$/i.test(after);
  const insideLink = !raw.slice(at + 1).startsWith(' ') && /[?@]/.test(before);
  return looksLikeName && !insideLink ? [unquote(before), after] : [unquote(raw), ''];
}

export function readLines(text: string): BulkLine[] {
  const out: BulkLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const [url, alias] = cellsOf(raw);
    if (!url) return;
    if (i === 0 && /^(url|link|long link|destination|address)$/i.test(url)) return;
    out.push({ line: i + 1, url, alias });
  });
  return out;
}
