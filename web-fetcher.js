/**
 * Fetch a URL and extract readable text — no external dependencies.
 *
 * - Decodes using the charset from Content-Type or <meta charset>.
 * - Prefers <article> / <main> / role="main" content when present.
 * - Drops boilerplate (nav, header, footer, aside, forms, scripts, styles, svg).
 * - Keeps paragraph / heading / list structure as line breaks.
 * - Returns plain text / JSON / markdown as-is.
 * - Throws UnsupportedContentError for PDFs and other binary types so the
 *   caller can fall back to Tavily Extract.
 */

const DEFAULT_MAX_CHARS = 8000;

// Matches a tag even when quoted attribute values contain ">" (e.g. Wikipedia data-mw)
const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g;

class UnsupportedContentError extends Error {}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.7,id;q=0.5",
};

async function fetchWebContent(url, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: BROWSER_HEADERS,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (/application\/pdf/.test(contentType) || /\.pdf($|\?)/i.test(new URL(response.url || url).pathname)) {
    throw new UnsupportedContentError("PDF documents are not supported by the direct fetcher");
  }
  if (contentType && !/text\/|html|xml|json|javascript|markdown/.test(contentType)) {
    throw new UnsupportedContentError(`Unsupported content type: ${contentType}`);
  }

  const buf = new Uint8Array(await response.arrayBuffer());
  const raw = decode(buf, contentType);

  let title = "";
  let text;
  if (/html|xml/.test(contentType) || /^\s*</.test(raw)) {
    title = decodeEntities((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
    text = htmlToText(raw);
  } else {
    text = raw.trim();
  }

  if (text.length < 50) {
    throw new Error("Page content is empty or couldn't be extracted (possibly JS-rendered)");
  }

  const truncated = text.length > maxChars;
  text = text.slice(0, maxChars);
  if (truncated) text += `\n\n[… truncated at ${maxChars} characters]`;

  return title ? `# ${title}\n\n${text}` : text;
}

function decode(buf, contentType) {
  let charset = contentType.match(/charset=["']?([\w-]+)/)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
    charset =
      head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ||
      head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function pickMainHtml(html) {
  const candidates = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<(div|section)\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/\1>/gi,
  ];
  for (const re of candidates) {
    const parts = [...html.matchAll(re)].map((m) => m[m.length - 1]);
    const joined = parts.join("\n");
    // Only trust it if it holds a meaningful chunk of text
    if (joined.replace(TAG, "").trim().length > 500) return joined;
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1];
  return body || html;
}

function htmlToText(html) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe)\b[\s\S]*?<\/\1>/gi, "");

  h = pickMainHtml(h).replace(
    /<(nav|header|footer|aside|form|button|select|dialog)\b[\s\S]*?<\/\1>/gi,
    ""
  );

  return decodeEntities(
    h
      .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Number(n))} `)
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h[1-6]|ul|ol|table|tr|blockquote|pre)>/gi, "\n\n")
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(TAG, " ")
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®",
  trade: "™", laquo: "«", raquo: "»", middot: "·", bull: "•",
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

module.exports = { fetchWebContent, htmlToText, UnsupportedContentError };
