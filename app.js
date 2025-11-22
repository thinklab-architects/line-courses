const DATA_URL = './data/courses.json';
const DEADLINE_SOON_DAYS = 7;
const BADGE_TEXT = {
  'due-soon': '即將開課',
  active: '尚未開課',
  expired: '已結束',
  'no-deadline': '尚未排程',
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
  document.title = 'LINE Courses｜高雄建築師公會課程快覽';
}

function formatUpdatedAt(isoString) {
  if (!isoString) return '課程更新：尚未同步';

  const formatter = new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  });

  try {
    return `課程更新：${formatter.format(new Date(isoString))}`;
  } catch {
    return `課程更新：${isoString}`;
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
    return '尚未提供日期';
  }

  if (doc.daysUntilDeadline < 0) {
    return `結束 ${Math.abs(doc.daysUntilDeadline)} 天`;
  }

  if (doc.daysUntilDeadline === 0) {
    return '今天開課';
  }

  if (doc.daysUntilDeadline === 1) {
    return '1 天後開課';
  }

  return `${doc.daysUntilDeadline} 天後開課`;
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
    elements.status.textContent = '目前尚未取得課程資訊，請稍候重試。';
    return;
  }

  if (filtered === 0) {
    elements.status.textContent = '沒有符合條件的課程。';
    return;
  }

  elements.status.textContent = `顯示 ${filtered} / ${total} 堂課程`;
}

function setDocumentListVisibility(hasResults) {
  elements.documentList.hidden = !hasResults;
}

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
    if (!item || !item.url) return;
    if (seen.has(item.url)) return;
    seen.add(item.url);

    const url = item.url;
    const label = item.label?.trim() || `連結 ${String(index + 1).padStart(2, '0')}`;

    const fileExtMatch = url.match(/\.(pdf|jpg|jpeg|png|gif)(?:[?#].*)?$/i);
    const isPdfMime = item.mime === 'application/pdf';
    const isDownloadPhp = /download\.php\?b=/i.test(url);
    const previewable = fileExtMatch || isPdfMime || isDownloadPhp;

    if (previewable) {
      const wrapper = document.createElement('div');
      wrapper.className = 'attachment-item';

      const a = document.createElement('a');
      a.className = 'attachment-download';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.download = '';
      a.textContent = label;

      if (isPdfMime || /pdf$/i.test(fileExtMatch?.[1] || '') || isDownloadPhp) {
        const previewBtn = document.createElement('button');
        previewBtn.className = 'attachment-preview-btn';
        previewBtn.type = 'button';
        previewBtn.title = '預覽檔案';
        previewBtn.innerHTML = '▶';
        previewBtn.addEventListener('click', (e) => {
          e.preventDefault();
          openPreview(url, label);
        });
        wrapper.append(a, previewBtn);
      } else {
        wrapper.append(a);
      }
      list.appendChild(wrapper);
    } else {
      const link = document.createElement('a');
      link.className = 'attachment-link';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      list.appendChild(link);
    }
  });

  if (!list.children.length) {
    const empty = document.createElement('span');
    empty.className = 'attachment-empty';
    empty.textContent = '尚未提供連結';
    return empty;
  }

  return list;
}

// Preview modal helpers
function openPreview(url, title) {
  const modal = document.getElementById('previewModal');
  const content = document.getElementById('previewContent');
  if (!modal || !content) {
    window.open(url, '_blank', 'noopener');
    return;
  }

  content.innerHTML = '';

  const ext = (url.match(/\.([a-z0-9]+)(?:[?#].*)?$/i) || [])[1]?.toLowerCase();

  if (ext === 'pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = title || '檔案預覽';
    content.appendChild(iframe);
  } else if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif') {
    const img = document.createElement('img');
    img.src = url;
    img.alt = title || '影像預覽';
    content.appendChild(img);
  } else {
    const msg = document.createElement('div');
    msg.innerHTML = `<p>此檔案類型無法內嵌預覽。<a href="${url}" target="_blank" rel="noopener noreferrer">在新分頁開啟</a> 或右鍵另存。</p>`;
    content.appendChild(msg);
  }

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  const content = document.getElementById('previewContent');
  if (!modal || !content) return;
  content.innerHTML = '';
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}

// wire up modal close buttons/backdrop
document.addEventListener('click', (e) => {
  const target = e.target;
  if (target && (target.matches('[data-close]') || target.closest('[data-close]'))) {
    closePreview();
  }
});

function createDocumentCard(doc) {
  const card = document.createElement('article');
  card.className = `document-card document-card--${doc.deadlineCategory}`;

  const header = document.createElement('header');
  header.className = 'document-card__header';

  const badge = document.createElement('span');
  badge.className = `badge badge--${doc.deadlineCategory}`;
  badge.textContent = BADGE_TEXT[doc.deadlineCategory] ?? '狀態不明';
  header.appendChild(badge);

  const issued = document.createElement('span');
  issued.className = 'document-card__issued';

  const issuedLabel = document.createElement('span');
  issuedLabel.className = 'document-card__label';
  issuedLabel.textContent = '課程日期';
  issued.appendChild(issuedLabel);

  if (doc.date) {
    const issuedTime = document.createElement('time');
    issuedTime.dateTime = doc.date;
    issuedTime.textContent = doc.date;
    issued.appendChild(issuedTime);
  } else {
    const placeholder = document.createElement('span');
    placeholder.textContent = '尚未提供';
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
    creditLabel.textContent = '課程總分';

    const creditValueEl = document.createElement('strong');
    creditValueEl.className = 'credit-highlight__value';
    creditValueEl.textContent = Number.isInteger(creditValue)
      ? `${creditValue} 分`
      : `${creditValue.toFixed(1)} 分`;

    creditHighlight.append(creditLabel, creditValueEl);
  }

  const title = document.createElement('h2');
  title.className = 'document-card__title';
  const titleText =
    doc.title?.trim() || doc.subject?.trim() || '未提供課程名稱';
  const primaryUrl =
    doc.detailUrl ?? doc.subjectUrl ?? doc.links?.[0]?.url ?? null;

  if (primaryUrl) {
    const link = document.createElement('a');
    link.href = primaryUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = titleText;
    title.appendChild(link);
    // add download toggle next to title when attachments exist
    if (Array.isArray(doc.attachments) && doc.attachments.length > 0) {
      const dlWrapper = document.createElement('span');
      dlWrapper.className = 'document-download-wrapper';

      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'course-download-toggle';
      dlBtn.title = '下載附件';
      dlBtn.setAttribute('aria-expanded', 'false');
      dlBtn.innerHTML = '下載';

      const panel = document.createElement('div');
      panel.className = 'attachment-panel';
      panel.hidden = true;
      // populate with attachment list (use doc.attachments only)
      const attachmentsList = createLinkList({ ...doc, links: [], attachments: doc.attachments });
      panel.appendChild(attachmentsList);

      dlBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const opened = dlBtn.getAttribute('aria-expanded') === 'true';
        dlBtn.setAttribute('aria-expanded', String(!opened));
        panel.hidden = opened;
      });

      dlWrapper.appendChild(dlBtn);
      dlWrapper.appendChild(panel);
      title.appendChild(dlWrapper);
    }
  } else {
    title.textContent = titleText;
  }

  const metaList = document.createElement('dl');
  metaList.className = 'document-card__meta';

  const countdown = document.createElement('span');
  countdown.className = 'deadline-note';
  countdown.textContent = formatDeadlineNote(doc);

  const timeContent = document.createElement('span');
  timeContent.textContent = doc.time?.trim() || '尚未提供';

  metaList.append(
    createMetaItem('開課倒數', countdown),
    createMetaItem('上課時間', timeContent),
    createMetaItem('課程連結', createLinkList(doc)),
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
    elements.status.textContent = '課程載入失敗，請檢查網路或稍後再試。';
    elements.status.classList.add('status--error');
  }
}
