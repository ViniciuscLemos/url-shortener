// Many links at once, from a list someone pasted or a CSV out of a spreadsheet: one link per
// line, a name after a comma (or a semicolon, or a tab, which is how Excel in Portuguese and
// a copied column come out). A first line that is only headings is skipped.

export interface BulkLine {
  line: number;
  url: string;
  alias: string;
}

export const BULK_MAX = 50;

export function readLines(text: string): BulkLine[] {
  const out: BulkLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const cells = raw.split(/[,;\t]/).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
    const [url = '', alias = ''] = cells;
    if (!url) return;
    if (i === 0 && /^(url|link|long link|destination|address)$/i.test(url)) return;
    out.push({ line: i + 1, url, alias });
  });
  return out;
}
