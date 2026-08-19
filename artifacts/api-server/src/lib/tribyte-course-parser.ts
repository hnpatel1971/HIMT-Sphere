export interface TriByteScrapedCourse {
  nid: string;
  tid: string;
  name: string;
  thumbUrl: string;
}

function findLiBlockEnd(html: string, startPos: number): number {
  let depth = 1;
  let i = startPos;
  while (i < html.length) {
    if (html[i] === "<") {
      if (html.slice(i, i + 3).toLowerCase() === "<li" && (html[i + 3] === " " || html[i + 3] === ">")) {
        depth++;
        i += 3;
      } else if (html.slice(i, i + 5).toLowerCase() === "</li>") {
        depth--;
        if (depth === 0) return i;
        i += 5;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return html.length;
}

function cleanHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse TriByte's carousel cards from one authenticated course-list page. */
export function parseTriByteCoursePage(html: string): TriByteScrapedCourse[] {
  const courses: TriByteScrapedCourse[] = [];
  const cardRe = /<li\b(?=[^>]*\bid=["']category_(\d+)["'])[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = cardRe.exec(html)) !== null) {
    const nid = match[1];
    const cardStart = cardRe.lastIndex;
    const cardEnd = findLiBlockEnd(html, cardStart);
    const inner = html.slice(cardStart, cardEnd);
    cardRe.lastIndex = cardEnd + "</li>".length;

    const tid = (inner.match(/cat_tid=(\d+)/i) || inner.match(/cat=(\d+)/i))?.[1];
    if (!tid) continue;

    const nameMatch = inner.match(/<div[^>]*class=["'][^"']*\bcarousel_title_element\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
      || inner.match(/class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|h\d|a)>/i)
      || inner.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i);
    const thumbMatch = inner.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp)[^"]*)"/i)
      || inner.match(/src="([^"]*static[^"]+)"/i);

    courses.push({
      nid,
      tid,
      name: nameMatch ? cleanHtml(nameMatch[1]) : `Course ${nid}`,
      thumbUrl: thumbMatch?.[1] ?? "",
    });
  }

  return courses;
}