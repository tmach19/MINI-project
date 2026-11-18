import React from 'react';

interface ChatMarkdownProps {
  content: string;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key} className="font-bold text-gray-950 dark:text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={key} className="italic text-gray-700 dark:text-slate-300">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded-md bg-stone-200/80 dark:bg-slate-900 text-[11px] font-mono text-red-700 dark:text-amber-300 border border-stone-300/60 dark:border-slate-700"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Bộ render Markdown nhẹ, an toàn (pure React JSX) dành cho câu trả lời Gia sư AI.
 */
export const ChatMarkdown: React.FC<ChatMarkdownProps> = ({ content }) => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Code block ```...```
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={`code-${i}`}
          className="p-3 rounded-xl bg-stone-900 dark:bg-slate-950 text-stone-100 text-[11px] font-mono overflow-x-auto border border-stone-700/60"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Markdown Table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div
          key={`tbl-${i}`}
          className="overflow-x-auto rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900/80"
        >
          <table className="w-full text-left text-[11px] border-collapse">
            <thead className="bg-stone-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200">
              <tr>
                {headers.map((h, hIdx) => (
                  <th
                    key={hIdx}
                    className="px-2.5 py-2 font-bold border-b border-stone-200 dark:border-slate-700"
                  >
                    {renderInline(h, `th-${i}-${hIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-stone-50/70 dark:hover:bg-slate-800/40">
                  {headers.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-2.5 py-1.5 text-gray-700 dark:text-slate-300"
                    >
                      {renderInline(row[cIdx] || '', `td-${i}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="border-stone-200 dark:border-slate-700/80 my-1" />);
      i += 1;
      continue;
    }

    // Headings (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      blocks.push(
        <div
          key={`h-${i}`}
          className={`font-bold text-gray-900 dark:text-white flex items-center gap-2 ${
            level <= 2
              ? 'text-sm pt-2 first:pt-0 pb-1 border-b border-stone-200/80 dark:border-slate-700'
              : 'text-xs pt-2 first:pt-0 text-red-700 dark:text-amber-300'
          }`}
        >
          <span className="w-1.5 h-3.5 rounded-full bg-gradient-to-b from-red-500 to-amber-500 flex-shrink-0" />
          <span>{renderInline(headingText, `h-${i}`)}</span>
        </div>
      );
      i += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`bq-${i}`}
          className="pl-3 py-1.5 border-l-2 border-red-400 dark:border-amber-500 bg-white/60 dark:bg-slate-900/50 rounded-r-xl text-gray-700 dark:text-slate-300 space-y-1"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>{renderInline(ql, `bq-${i}-${qIdx}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Lists (unordered & ordered, including nested indentation)
    const listMatch = line.match(/^(\s*)([-*•]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const listItems: Array<{ indent: number; marker: string; isOrdered: boolean; text: string }> = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*•]|\d+\.)\s+(.+)$/);
        if (!m) break;
        listItems.push({
          indent: m[1].replace(/\t/g, '  ').length,
          marker: m[2],
          isOrdered: /\d+\./.test(m[2]),
          text: m[3],
        });
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="space-y-1.5 pl-3.5">
          {listItems.map((item, lIdx) => {
            const nestLevel = item.indent >= 4 ? 2 : item.indent >= 2 ? 1 : 0;
            const indentClass = nestLevel === 2 ? 'pl-8' : nestLevel === 1 ? 'pl-4' : '';
            const nested = nestLevel >= 1;
            return (
              <li
                key={lIdx}
                className={`flex items-start gap-2 leading-relaxed ${indentClass}`}
              >
                {item.isOrdered ? (
                  <span className="text-[11px] font-bold text-red-600 dark:text-amber-400 min-w-[16px] mt-[1px]">
                    {item.marker}
                  </span>
                ) : (
                  <span
                    className={`rounded-full flex-shrink-0 mt-[6px] ${
                      nested
                        ? 'w-1.5 h-1.5 border border-red-400 dark:border-amber-400'
                        : 'w-1.5 h-1.5 bg-red-500 dark:bg-amber-400'
                    }`}
                  />
                )}
                <span className="flex-1 text-gray-800 dark:text-slate-200">
                  {renderInline(item.text, `li-${i}-${lIdx}`)}
                </span>
              </li>
            );
          })}
        </ul>
      );
      continue;
    }

    // Normal paragraph
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (
        !curTrim ||
        curTrim.startsWith('```') ||
        curTrim.startsWith('>') ||
        /^(#{1,4})\s+/.test(curTrim) ||
        /^(\s*)([-*•]|\d+\.)\s+/.test(cur) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(curTrim) ||
        (curTrim.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(curTrim);
      i += 1;
    }

    blocks.push(
      <p key={`p-${i}`} className="leading-relaxed text-gray-800 dark:text-slate-200">
        {paraLines.map((pl, pIdx) => (
          <React.Fragment key={pIdx}>
            {pIdx > 0 && <br />}
            {renderInline(pl, `p-${i}-${pIdx}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="space-y-2.5 text-xs">{blocks}</div>;
};
