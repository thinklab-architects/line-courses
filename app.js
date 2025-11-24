const DATA_URL = './data/courses.json';
const DEADLINE_SOON_DAYS = 7;
const PREVIEW_VIEWER_BASE = 'https://docs.google.com/viewer?embedded=true&url=';
const BADGE_TEXT = {
  'due-soon': '?喳??玨',
  active: '撠?玨',
  expired: '撌脩???,
  'no-deadline': '撠??',
};

const DEFAULT_STATUS_VALUES = ['due-soon', 'active'];

const state = {
  documents: [],
  filtered: [],
  filters: {
    search: '',
    sort: 'deadline-asc',
    statuses: new Set(DEFAULT_STATUS_VALUES),
    hasCreditsOnly: false,
  },
};

bootstrapLayout();

const elements = {
  status: document.getElementById('status'),
  documentList: document.getElementById('documentList'),
  searchInput: document.getElementById('search'),
  sortSelect: document.getElementById('sortSelect'),
  clearFilters: document.getElementById('clearFilters'),
  updatedAt: document.getElementById('updatedAt'),
  creditFilter: document.getElementById('creditFilter'),
  previewModal: document.getElementById('previewModal'),
  previewContent: document.getElementById('previewContent'),
};

const statusCheckboxes = Array.from(
  document.querySelectorAll('input[name="statusFilter"]'),
);

function syncStatusCheckboxes() {
  statusCheckboxes.forEach((checkbox) => {
    checkbox.checked = state.filters.statuses.has(checkbox.value);
  });
}

function resetStatusFilters() {
  state.filters.statuses = new Set(DEFAULT_STATUS_VALUES);
  syncStatusCheckboxes();
}

function syncCreditFilter() {
  if (!elements.creditFilter) return;
  const pressed = Boolean(state.filters.hasCreditsOnly);
  elements.creditFilter.classList.toggle('filter-chip--active', pressed);
  elements.creditFilter.setAttribute('aria-pressed', String(pressed));
}

statusCheckboxes.forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    const { value, checked } = checkbox;

    if (checked) {
      state.filters.statuses.add(value);
    } else {
      state.filters.statuses.delete(value);
      if (state.filters.statuses.size === 0) {
        state.filters.statuses.add(value);
        checkbox.checked = true;
        return;
      }
    }

    render();
  });
});

syncStatusCheckboxes();
syncCreditFilter();

if (elements.creditFilter) {
  elements.creditFilter.addEventListener('click', () => {
    state.filters.hasCreditsOnly = !state.filters.hasCreditsOnly;
    syncCreditFilter();
    render();
  });
}

elements.searchInput.addEventListener('input', (event) => {
  state.filters.search = event.target.value.trim();
  render();
});

elements.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (elements.searchInput.value) {
      elements.searchInput.value = '';
      state.filters.search = '';
      render();
    }
  }
});


elements.sortSelect.addEventListener('change', (event) => {
  state.filters.sort = event.target.value;
  render();
});

elements.clearFilters.addEventListener('click', () => {
  const hasSearch = Boolean(state.filters.search);
  const hasSort = state.filters.sort !== 'deadline-asc';
  const hasStatusChange =
    state.filters.statuses.size !== DEFAULT_STATUS_VALUES.length ||
    DEFAULT_STATUS_VALUES.some((value) => !state.filters.statuses.has(value));
  const hasCreditFilter = state.filters.hasCreditsOnly;

  if (!hasSearch && !hasSort && !hasStatusChange && !hasCreditFilter) {
    return;
  }

  state.filters.search = '';
  state.filters.sort = 'deadline-asc';
  resetStatusFilters();
  state.filters.hasCreditsOnly = false;
  syncCreditFilter();

  elements.searchInput.value = '';
  elements.sortSelect.value = 'deadline-asc';

  render();
});

loadDocuments();

function bootstrapLayout() {
  document.title = 'LINE Courses嚚??遣蝭葦?祆?隤脩?敹怨汗';
}

function formatUpdatedAt(isoString) {
  if (!isoString) return '隤脩??湔嚗??芸?甇?;

  const formatter = new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  });

  try {
    return `隤脩??湔嚗?{formatter.format(new Date(isoString))}`;
  } catch {
    return `隤脩??湔嚗?{isoString}`;
  }
}


function parseDate(value) {
  if (!value) return null;

  const normalized = value.trim().replace(/\//g, '-');
  const isoCandidate =
    normalized.length === 10
      ? `${normalized}T00:00:00+08:00`
      : normalized;

  const parsed = new Date(isoCandidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const taipeiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function buildPreviewUrl(url) {
  if (!url) return null;
  try {
    // Use Google Docs viewer (same approach as line-event) to avoid forced downloads
    const absolute = new URL(url, window.location.href).href;
    const encoded = encodeURIComponent(absolute);
    return `${PREVIEW_VIEWER_BASE}${encoded}`;
  } catch {
    return null;
  }
}

function getTaipeiToday() {
  const formatted = taipeiDateFormatter.format(Date.now());
  return parseDate(formatted);
}

function enrichDocument(doc) {
  const issuedDate = parseDate(doc.date);
  const deadlineDate = parseDate(doc.deadline);
  const today = getTaipeiToday();

  let deadlineCategory = 'no-deadline';
  let daysUntilDeadline = null;

  if (deadlineDate && today) {
    const diffDays = Math.floor(
      (deadlineDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );
    daysUntilDeadline = diffDays;

    if (diffDays < 0) {
      deadlineCategory = 'expired';
    } else if (diffDays <= DEADLINE_SOON_DAYS) {
      deadlineCategory = 'due-soon';
    } else {
      deadlineCategory = 'active';
    }
  }

  return {
    ...doc,
    issuedDate,
    deadlineDate,
    deadlineCategory,
    daysUntilDeadline,
  };
}

function formatDeadlineNote(doc) {
  if (doc.daysUntilDeadline == null) {
    return '撠???交?';
  }

  if (doc.daysUntilDeadline < 0) {
    return `蝯? ${Math.abs(doc.daysUntilDeadline)} 憭奈;
  }

  if (doc.daysUntilDeadline === 0) {
    return '隞予?玨';
  }

  if (doc.daysUntilDeadline === 1) {
    return '1 憭拙??玨';
  }

  return `${doc.daysUntilDeadline} 憭拙??玨`;
}


function sortDocuments(documents) {
  const sorted = [...documents];

  const compareDate = (a, b, key, direction = 'desc') => {
    const aDate = a[key];
    const bDate = b[key];

    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;

    const diff = aDate.getTime() - bDate.getTime();
    return direction === 'asc' ? diff : -diff;
  };

  switch (state.filters.sort) {
    case 'deadline-asc':
      sorted.sort((a, b) => {
        if (!a.deadlineDate && !b.deadlineDate) {
          return compareDate(a, b, 'issuedDate', 'desc');
        }
        if (!a.deadlineDate) return 1;
        if (!b.deadlineDate) return -1;
        const diff = a.deadlineDate.getTime() - b.deadlineDate.getTime();
        return diff === 0
          ? compareDate(a, b, 'issuedDate', 'desc')
          : diff;
      });
      break;
    case 'deadline-desc':
      sorted.sort((a, b) => {
        if (!a.deadlineDate && !b.deadlineDate) {
          return compareDate(a, b, 'issuedDate', 'desc');
        }
        if (!a.deadlineDate) return 1;
        if (!b.deadlineDate) return -1;
        const diff = b.deadlineDate.getTime() - a.deadlineDate.getTime();
        return diff === 0
          ? compareDate(a, b, 'issuedDate', 'desc')
          : diff;
      });
      break;
    case 'date-asc':
      sorted.sort((a, b) => compareDate(a, b, 'issuedDate', 'asc'));
      break;
    case 'date-desc':
    default:
      sorted.sort((a, b) => compareDate(a, b, 'issuedDate', 'desc'));
      break;
  }

  return sorted;
}

function applyFilters() {
  const query = state.filters.search.trim().toLowerCase();

  let results = state.documents;

  if (query) {
    results = results.filter((doc) => {
      const title =
        doc.title?.toLowerCase() ?? doc.subject?.toLowerCase() ?? '';
      const detailUrl =
        doc.detailUrl?.toLowerCase() ?? doc.subjectUrl?.toLowerCase() ?? '';
      const timeText = doc.time?.toLowerCase() ?? '';
      const links = (doc.links ?? doc.attachments ?? [])
        .map(
          (link) =>
            `${(link.label ?? '').toLowerCase()} ${(link.url ?? '').toLowerCase()}`,
        )
        .join(' ');
      const dateText = (doc.date ?? '').toLowerCase();
      const deadlineText = (doc.deadline ?? '').toLowerCase();

      return (
        title.includes(query) ||
        detailUrl.includes(query) ||
        links.includes(query) ||
        dateText.includes(query) ||
        deadlineText.includes(query) ||
        timeText.includes(query)
      );
    });
  }

  if (state.filters.statuses.size) {
    results = results.filter((doc) =>
      state.filters.statuses.has(doc.deadlineCategory ?? 'no-deadline'),
    );
  }

  if (state.filters.hasCreditsOnly) {
    results = results.filter((doc) => Number(doc.credits ?? 0) > 0);
  }

  return sortDocuments(results);
}

function updateStatus(filtered, total) {
  elements.status.classList.remove('status--error');

  if (total === 0) {
    elements.status.textContent = '?桀?撠??隤脩?鞈?嚗?蝔?閰艾?;
    return;
  }

  if (filtered === 0) {
    elements.status.textContent = '瘝?蝚血?璇辣?玨蝔?;
    return;
  }

  elements.status.textContent = `憿舐內 ${filtered} / ${total} ?玨蝔;
}

function setDocumentListVisibility(hasResults) {
  elements.documentList.hidden = !hasResults;
}

function closePreview() {
  if (!elements.previewModal || !elements.previewContent) return;
  elements.previewContent.replaceChildren();
  elements.previewModal.setAttribute('aria-hidden', 'true');
  elements.previewModal.hidden = true;
}

function showPreview(url, label) {
  if (!elements.previewModal || !elements.previewContent || !url) return;
  elements.previewContent.replaceChildren();

  const previewUrl = buildPreviewUrl(url) || url;

  const iframe = document.createElement('iframe');
  iframe.src = previewUrl;
  iframe.title = label || '瑼??汗';
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'no-referrer';
  iframe.allow = 'fullscreen';
  elements.previewContent.appendChild(iframe);

  // fallback open in new tab if viewer cannot load
  const fallback = document.createElement('p');
  fallback.className = 'preview-fallback';
  const fallbackLink = document.createElement('a');
  fallbackLink.href = url;
  fallbackLink.target = '_blank';
  fallbackLink.rel = 'noopener noreferrer';
  fallbackLink.textContent = '?亦瘜?閬踝?暺迨???啗?蝒?頛??亦?';
  fallback.appendChild(fallbackLink);
  elements.previewContent.appendChild(fallback);

  elements.previewModal.hidden = false;
  elements.previewModal.setAttribute('aria-hidden', 'false');
}

// wire up modal close buttons/backdrop
document.addEventListener('click', (e) => {
  const target = e.target;
  if (target && (target.matches('[data-close]') || target.closest('[data-close]'))) {
    closePreview();
  }
});

// open preview when clicking download/attachment links
document.addEventListener('click', (e) => {
  const anchor = e.target.closest('.attachment-link--download');
  if (!anchor) return;
  // allow modifier clicks to open new tab as usual
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  showPreview(anchor.href, anchor.textContent.trim());
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePreview();
  }
});

function createMetaItem(label, content) {
  const wrapper = document.createElement('div');
  wrapper.className = 'meta-item';

  const dt = document.createElement('dt');
  dt.textContent = label;

  const dd = document.createElement('dd');
  if (typeof content === 'string') {
    dd.textContent = content;
  } else if (content instanceof Node) {
    dd.appendChild(content);
  }

  wrapper.append(dt, dd);
  return wrapper;
}

function createLinkList(doc) {
  const list = document.createElement('div');
  list.className = 'attachment-list';

  const seen = new Set();
  const allLinks = [];
  if (Array.isArray(doc.links)) allLinks.push(...doc.links);
  if (Array.isArray(doc.attachments)) allLinks.push(...doc.attachments);

  allLinks.forEach((item, index) => {
    if (!item?.url || seen.has(item.url)) return;
    seen.add(item.url);

    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const labelText =
      item.label?.trim() || `?辣 ${String(index + 1).padStart(2, '0')}`;
    link.textContent = labelText;

    const lowerLabel = labelText.toLowerCase();
    const lowerUrl = (item.url ?? '').toLowerCase();
    const isRegister =
      /?勗?/.test(labelText) ||
      /register|signup|enroll/.test(lowerUrl);
    const isDownload =
      /銝?|?辣|瑼?/.test(labelText) ||
      /\.pdf\b/.test(lowerUrl) ||
      /download\.php/.test(lowerUrl);

    link.className = 'attachment-link';
    if (isRegister) link.classList.add('attachment-link--register');
    if (isDownload) link.classList.add('attachment-link--download');

    list.appendChild(link);
  });

  if (!list.children.length) {
    const empty = document.createElement('span');
    empty.className = 'attachment-empty';
    empty.textContent = '撠?????';
    return empty;
  }

  return list;
}

function createDocumentCard(doc) {
  const card = document.createElement('article');
  card.className = `document-card document-card--${doc.deadlineCategory}`;

  const header = document.createElement('header');
  header.className = 'document-card__header';

  const badge = document.createElement('span');
  badge.className = `badge badge--${doc.deadlineCategory}`;
  badge.textContent = BADGE_TEXT[doc.deadlineCategory] ?? '?????;
  header.appendChild(badge);

  const issued = document.createElement('span');
  issued.className = 'document-card__issued';

  const issuedLabel = document.createElement('span');
  issuedLabel.className = 'document-card__label';
  issuedLabel.textContent = '隤脩??交?';
  issued.appendChild(issuedLabel);

  if (doc.date) {
    const issuedTime = document.createElement('time');
    issuedTime.dateTime = doc.date;
    issuedTime.textContent = doc.date;
    issued.appendChild(issuedTime);
  } else {
    const placeholder = document.createElement('span');
    placeholder.textContent = '撠??';
    issued.appendChild(placeholder);
  }

  header.appendChild(issued);

  let creditHighlight = null;
  const creditValue = Number(doc.credits ?? 0);
  if (
    Number.isFinite(creditValue) &&
    creditValue > 0 &&
    doc.deadlineCategory !== 'expired'
  ) {
    creditHighlight = document.createElement('div');
    creditHighlight.className = 'credit-highlight';

    const creditLabel = document.createElement('span');
    creditLabel.className = 'credit-highlight__label';
    creditLabel.textContent = '隤脩?蝮賢?';

    const creditValueEl = document.createElement('strong');
    creditValueEl.className = 'credit-highlight__value';
    creditValueEl.textContent = Number.isInteger(creditValue)
      ? `${creditValue} ?
      : `${creditValue.toFixed(1)} ?;

    creditHighlight.append(creditLabel, creditValueEl);
  }

  const title = document.createElement('h2');
  title.className = 'document-card__title';
  const titleText =
    doc.title?.trim() || doc.subject?.trim() || '?芣?靘玨蝔?蝔?;
  const primaryUrl =
    doc.detailUrl ?? doc.subjectUrl ?? doc.links?.[0]?.url ?? null;

  if (primaryUrl) {
    const link = document.createElement('a');
    link.href = primaryUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = titleText;
    title.appendChild(link);
  } else {
    title.textContent = titleText;
  }

  const metaList = document.createElement('dl');
  metaList.className = 'document-card__meta';

  const countdown = document.createElement('span');
  countdown.className = 'deadline-note';
  countdown.textContent = formatDeadlineNote(doc);

  const timeContent = document.createElement('span');
  timeContent.textContent = doc.time?.trim() || '撠??';

  metaList.append(
    createMetaItem('?玨?', countdown),
    createMetaItem('銝玨??', timeContent),
    createMetaItem('隤脩????', createLinkList(doc)),
  );

  const sections = [header];
  if (creditHighlight) {
    sections.push(creditHighlight);
  }
  sections.push(title, metaList);

  card.append(...sections);
  return card;
}

function renderDocuments(documents) {
  elements.documentList.replaceChildren(
    ...documents.map((doc) => createDocumentCard(doc)),
  );
}

function render() {
  state.filtered = applyFilters();
  updateStatus(state.filtered.length, state.documents.length);
  setDocumentListVisibility(state.filtered.length > 0);

  if (state.filtered.length) {
    renderDocuments(state.filtered);
  }
}

async function loadDocuments() {
  try {
    const response = await fetch(`${DATA_URL}?_=${Date.now()}`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const documents = payload.courses ?? payload.documents ?? [];

    state.documents = documents.map(enrichDocument);
    render();

    if (payload.updatedAt) {
      elements.updatedAt.textContent = formatUpdatedAt(payload.updatedAt);
    }

    setDocumentListVisibility(state.filtered.length > 0);
  } catch (error) {
    console.error('Unable to load courses', error);
    elements.status.textContent = '隤脩?頛憭望?嚗?瑼Ｘ蝬脰楝??敺?閰艾?;
    elements.status.classList.add('status--error');
  }
}
