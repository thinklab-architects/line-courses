import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import iconv from 'iconv-lite';

const BASE_URL = 'https://www.kaa.org.tw/news_class_list.php';
const MAX_PAGES = 200;
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

async function fetchCourseCredits(detailUrl) {
  if (!detailUrl) return null;

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

  const creditContainer = $('td')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .find((text) => /\u7e3d\s*\u5206|\u7e3d\s*\u5b78\u5206/.test(text));

  if (!creditContainer) {
    return null;
  }

  const match = creditContainer.match(
    /\u7e3d(?:\u5b78)?\u5206[：:\s]*([0-9]+(?:\.[0-9]+)?)/,
  );
  if (!match) {
    return null;
  }

  return Number.parseFloat(match[1]);
}

async function enrichCoursesWithCredits(courses) {
  const enriched = [];

  for (const course of courses) {
    const courseCopy = { ...course, credits: null };
    const shouldFetchCredits =
      course.detailUrl && !isExpired(course.deadline);

    if (shouldFetchCredits) {
      try {
        courseCopy.credits = await fetchCourseCredits(course.detailUrl);
      } catch (error) {
        console.warn(`Failed to fetch credits for ${course.title}: ${error.message}`);
      }

      await sleep(DETAIL_WAIT_MS);
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
