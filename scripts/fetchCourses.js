import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import iconv from 'iconv-lite';

const BASE_URL = 'https://www.kaa.org.tw/news_class_list.php';
const MAX_PAGES = 5;
const WAIT_MS = 300;
const DETAIL_WAIT_MS = 400;
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isPdfUrl(url, timeout = 8000) {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    // try HEAD first
    const headResp = await fetch(url, { method: 'HEAD', headers: HEADERS, signal: controller.signal });
    clearTimeout(id);
    if (headResp && headResp.ok) {
      const ct = headResp.headers.get('content-type') || '';
      if (ct.toLowerCase().includes('application/pdf')) return true;
    }
  } catch (e) {
    // ignore and fallback to GET below
  }

  // fallback: try a small GET (Range) to avoid downloading whole file
  try {
    const controller2 = new AbortController();
    const id2 = setTimeout(() => controller2.abort(), timeout);
    const getResp = await fetch(url, {
      method: 'GET',
      headers: { ...HEADERS, Range: 'bytes=0-1023' },
      signal: controller2.signal,
    });
    clearTimeout(id2);
    if (getResp && getResp.ok) {
      const ct2 = getResp.headers.get('content-type') || '';
      if (ct2.toLowerCase().includes('application/pdf')) return true;
      // some servers send octet-stream but content looks like PDF (start with %PDF)
      const buf = Buffer.from(await getResp.arrayBuffer()).slice(0, 16);
      const head = buf.toString('utf8', 0, Math.min(buf.length, 4));
      if (head === '%PDF') return true;
    }
  } catch (e) {
    // last resort: treat as not pdf
  }

  return false;
}

function cleanText(value) {
  return (
    value
      ?.replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

function toAbsoluteUrl(url) {
  if (!url) return null;
  try {
    return new URL(url, BASE_URL).href;
  } catch {
    return null;
  }
}

function buildLink(label, url, fallbackLabel) {
  const normalizedUrl = toAbsoluteUrl(url);
  if (!normalizedUrl) {
    return null;
  }

  const normalizedLabel = cleanText(label) || fallbackLabel;
  return {
    label: normalizedLabel,
    url: normalizedUrl,
  };
}

function parseCourses(html) {
  const $ = load(html);
  const rows = $('table tr').slice(1);
  const courses = [];

  rows.each((_, row) => {
    const cells = $(row).find('td');
    if (!cells.length) return;

    const titleCell = $(cells[0]);
    const title = cleanText(titleCell.text());
    if (!title) return;

    const dateText = cleanText($(cells[1]).text());
    const timeText = cleanText($(cells[2]).text());

    const detailLink = buildLink(
      $(cells[3]).text(),
      $(cells[3]).find('a').attr('href') ?? titleCell.find('a').attr('href'),
      '課程資訊',
    );

    const registerLink = buildLink(
      $(cells[4]).text(),
      $(cells[4]).find('a').attr('href'),
      '線上報名',
    );

    const extras = [];
    $(cells[5])
      .find('a')
      .each((__, anchor) => {
        const link = buildLink($(anchor).text(), $(anchor).attr('href'), '相關連結');
        if (link) {
          extras.push(link);
        }
      });

    const seen = new Set();
    const links = [detailLink, registerLink, ...extras].filter((link) => {
      if (!link) {
        return false;
      }
      if (seen.has(link.url)) {
        return false;
      }
      seen.add(link.url);
      return true;
    });

    courses.push({
      title,
      date: dateText || null,
      deadline: dateText || null,
      time: timeText || null,
      links,
      detailUrl: detailLink?.url ?? null,
      registrationUrl: registerLink?.url ?? null,
    });
  });

  return courses;
}

function parseDateValue(value) {
  if (!value) return null;
  const normalized = value.replace(/\//g, '-').trim();
  const iso =
    normalized.length === 10 ? `${normalized}T23:59:59+08:00` : normalized;
  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function isExpired(deadline) {
  const date = parseDateValue(deadline);
  if (!date) {
    return false;
  }
  return date.getTime() < Date.now();
}

async function fetchCourseDetail(detailUrl) {
  if (!detailUrl) return { credits: null, attachments: [] };

  const response = await fetch(detailUrl, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to fetch detail: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  let html = buffer.toString('utf8');
  if (!/\u7e3d/.test(html)) {
    html = iconv.decode(buffer, 'big5');
  }
  const $ = load(html);

  // extract credit text from table cells (same logic as before)
  const creditContainer = $('td')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .find((text) => /\u7e3d\s*\u5206|\u7e3d\s*\u5b78\u5206/.test(text));

  let credits = null;
  if (creditContainer) {
    const match = creditContainer.match(
      /\u7e3d(?:\u5b78)?\u5206[：:\s]*([0-9]+(?:\.[0-9]+)?)/,
    );
    if (match) {
      credits = Number.parseFloat(match[1]);
    }
  }

  // find downloadable attachments in the detail page
  const attachments = [];
  const candidates = [];
  // only collect PDF files per request
  const fileExtPattern = /\.pdf(?:[?#].*)?$/i;

  // primary pass: anchors with explicit file extensions or obvious download hints
  $('a').each((_, anchor) => {
    const $a = $(anchor);
    const href = $a.attr('href');
    const text = cleanText($a.text());

    // try href first
    if (href) {
      const abs = toAbsoluteUrl(href);
      if (abs) {
        const lower = abs.toLowerCase();
        if (fileExtPattern.test(abs)) {
          const label = text || path.basename(abs);
          attachments.push({ label, url: abs });
          return;
        }
      }
    }

    // fallback: check onclick handlers that may open a file
    const onclick = $a.attr('onclick') || $a.closest('[onclick]').attr('onclick');
    if (onclick) {
      // extract first http(s) url or quoted filename with known extensions from onclick
      const mHttp = onclick.match(/https?:\/\/[^'"\)\s]+\.pdf(?:[?#][^'"\)\s]*)?/i);
      const mQuoted = onclick.match(/['"]([^'"\]]+\.pdf(?:[?#].*)?)['"]/i);
      const urlCandidate = mHttp ? mHttp[0] : mQuoted ? mQuoted[1] : null;
      if (urlCandidate) {
        const abs2 = toAbsoluteUrl(urlCandidate);
        if (abs2) {
          const label = text || path.basename(abs2);
          attachments.push({ label, url: abs2 });
        }
      }
    }
  });

  // secondary pass: look for nearby blocks labeled "相關檔案" or "檔案下載" and collect anchors inside
  $('*')
    .filter((_, el) => /相關檔案|檔案下載|下載檔案/.test(cleanText($(el).text())))
    .each((_, el) => {
      const $el = $(el);
      // find anchors inside the same block or immediate next sibling(s)
      const localAnchors = $el.find('a').toArray();
      if (!localAnchors.length) {
        const nextAnchors = $el.next().find('a').toArray();
        localAnchors.push(...nextAnchors);
      }
      localAnchors.forEach((anchor) => {
        const href = $(anchor).attr('href');
        if (!href) return;
        const abs = toAbsoluteUrl(href);
        if (!abs) return;
        const label = cleanText($(anchor).text()) || path.basename(abs);
        // if url has pdf extension, accept immediately
        if (fileExtPattern.test(abs)) {
          if (!attachments.find((x) => x.url === abs)) {
            attachments.push({ label, url: abs });
          }
        } else {
          // otherwise add to candidates to verify via HEAD/GET
          candidates.push({ label, url: abs });
        }
      });
    });

  // also scan general anchors that say 檔案下載 or 下載 and treat non-pdf as candidates
  $('a').each((_, a) => {
    const t = cleanText($(a).text());
    const href = $(a).attr('href');
    if (!href) return;
    const abs = toAbsoluteUrl(href);
    if (!abs) return;
    if (/檔案|下載/.test(t) && !fileExtPattern.test(abs)) {
      candidates.push({ label: t || path.basename(abs), url: abs });
    }
  });

  // verify candidates via HEAD/GET; include those that are confirmed PDFs
  for (const c of candidates) {
    try {
      const ok = await isPdfUrl(c.url);
      if (ok && !attachments.find((x) => x.url === c.url)) {
        attachments.push({ label: c.label, url: c.url });
      }
    } catch (e) {
      // ignore per-link errors
    }
  }

  return { credits, attachments };
}

async function enrichCoursesWithCredits(courses) {
  const enriched = [];

  for (const course of courses) {
    const courseCopy = { ...course, credits: null };
    const shouldFetchDetail = course.detailUrl && !isExpired(course.deadline);

    if (shouldFetchDetail) {
      try {
        const detail = await fetchCourseDetail(course.detailUrl);
        courseCopy.credits = detail.credits ?? null;
        courseCopy.attachments = detail.attachments ?? [];
      } catch (error) {
        console.warn(`Failed to fetch detail for ${course.title}: ${error.message}`);
      }

      await sleep(DETAIL_WAIT_MS);
    } else {
      courseCopy.attachments = [];
    }

    enriched.push(courseCopy);
  }

  return enriched;
}

async function fetchPage(page) {
  const url = new URL(BASE_URL);
  if (page > 1) {
    url.searchParams.set('b', String(page));
  }

  const response = await fetch(url, { headers: HEADERS });

  if (!response.ok) {
    throw new Error(`Failed to fetch page ${page}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('utf8');
}

async function scrapeCourses() {
  const courses = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const html = await fetchPage(page);
    const pageCourses = parseCourses(html);

    if (pageCourses.length === 0) {
      break;
    }

    courses.push(
      ...pageCourses.map((course) => ({
        ...course,
        page,
      })),
    );

    console.log(`Page ${page}: ${pageCourses.length} courses`);

    if (pageCourses.length < 10) {
      break;
    }

    await sleep(WAIT_MS);
  }

  return courses;
}

async function writeOutput(courses) {
  const outDir = path.resolve(__dirname, '../data');
  await fs.mkdir(outDir, { recursive: true });

  const outPath = path.join(outDir, 'courses.json');
  const payload = {
    source: BASE_URL,
    updatedAt: new Date().toISOString(),
    total: courses.length,
    courses,
  };

  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  return outPath;
}

async function main() {
  try {
    const courses = await scrapeCourses();
    if (!courses.length) {
      throw new Error('未擷取到任何課程資料，請稍後再試。');
    }

    const enriched = await enrichCoursesWithCredits(courses);
    const outPath = await writeOutput(enriched);
    console.log(`Saved ${courses.length} courses to ${outPath}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
