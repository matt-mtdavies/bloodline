/*
 * Offline family archive viewer (docs/FULL-ARCHIVE-EXPORT.md §3.8). Reads
 * `window.__BLOODLINE_ARCHIVE__` (assigned by tree-data.js, loaded via a
 * plain relative <script> tag in START-HERE.html — never fetch()/XHR,
 * which file:// blocks entirely) and renders a read-only, keyboard-
 * navigable directory + profile browser. No network access, no build
 * step — this file is shipped byte-for-byte inside every archive.
 */
(function () {
  'use strict';

  const DATA = window.__BLOODLINE_ARCHIVE__;

  // Fields rendered in their own dedicated section, or that are internal
  // plumbing — never shown a second time in the generic "fields" grid.
  const NON_GENERIC_FIELDS = new Set([
    'id', 'searchKey', 'events', 'memories', 'display_name', 'photo', 'photo_thumb', 'keepsake',
]);

  const FIELD_LABELS = {
    birth_date: 'Born', death_date: 'Died', birth_place: 'Birthplace', residence: 'Residence',
    occupation: 'Occupation', gender: 'Gender', middle_name: 'Middle name', maiden_name: 'Maiden name',
    cause_of_death: 'Cause of death', bio: 'Biography', is_living: 'Living', tags: 'Tags',
  };

  function labelFor(key) {
    if (FIELD_LABELS[key]) return FIELD_LABELS[key];
    return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  function formatFieldValue(v) {
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function renderMissingDataState() {
    document.getElementById('av-root').innerHTML =
      '<div class="av-empty-state"><h2>This archive\'s viewer data could not be read.</h2>' +
      '<p>tree-data.js did not load correctly — open <code>data/tree.json</code> directly instead; it is the authoritative record.</p></div>';
  }

  if (!DATA || typeof DATA !== 'object') { renderMissingDataState(); return; }

  const peopleList = Object.values(DATA.people || {}).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
  let activeId = null;

  function renderHeader() {
    document.getElementById('av-family-name').textContent = DATA.family?.name || 'Family archive';
    document.getElementById('av-generated-at').textContent = DATA.generatedAt ? `Archived ${new Date(DATA.generatedAt).toLocaleDateString()}` : '';

    const warningCount = (DATA.warnings || []).length
      + (DATA.media || []).filter((m) => m.warning).length;
    const banner = document.getElementById('av-integrity-banner');
    if (warningCount > 0) {
      banner.hidden = false;
      banner.textContent = `This archive has ${warningCount} item${warningCount === 1 ? '' : 's'} with a warning — see below on the affected profile.`;
    } else {
      banner.hidden = true;
    }
  }

  function renderDirectory(filterText) {
    const list = document.getElementById('av-people-list');
    list.innerHTML = '';
    const q = (filterText || '').toLowerCase().trim();
    const filtered = q ? peopleList.filter((p) => (p.searchKey || '').includes(q)) : peopleList;

    if (!filtered.length) {
      list.appendChild(el(`<li class="av-people-list__empty">No matches.</li>`));
      return;
    }
    for (const p of filtered) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p.display_name || '(unnamed)';
      btn.setAttribute('aria-current', String(p.id === activeId));
      btn.addEventListener('click', () => { location.hash = `#/person/${encodeURIComponent(p.id)}`; });
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  function personChip(id) {
    const p = DATA.people?.[id];
    const name = p?.display_name || id;
    return `<button type="button" class="av-rel-chip" data-goto="${escapeHtml(id)}">${escapeHtml(name)}</button>`;
  }

  function renderProfile(personId) {
    const root = document.getElementById('av-profile');
    const person = DATA.people?.[personId];
    if (!person) {
      root.innerHTML = '<div class="av-empty-state"><h2>Select someone from the directory</h2><p>Or use the search box to find them by name.</p></div>';
      return;
    }

    const adjacency = DATA.relationshipAdjacency?.[personId] || { parents: [], children: [], partners: [] };
    const allMedia = (DATA.media || []).filter((m) => m.ownerId === personId);
    const photoMedia = allMedia.filter((m) => m.recordType === 'person_photo' || m.recordType === 'person_photo_thumb' || m.recordType === 'photo');
    const documentMedia = allMedia.filter((m) => m.recordType === 'document' || m.recordType === 'document_thumb');
    const keepsakeMedia = allMedia.filter((m) => m.recordType === 'keepsake_edition');
    const genericFields = Object.entries(person).filter(([k, v]) => {
      if (NON_GENERIC_FIELDS.has(k) || v == null || v === '') return false;
      if (Array.isArray(v)) return v.length > 0 && v.every((x) => typeof x !== 'object');
      return typeof v !== 'object';
    });

    root.innerHTML = `
      <div class="av-profile__name">${escapeHtml(person.display_name || '(unnamed)')}</div>
      <div class="av-profile__sub">
        <button type="button" class="av-print-btn" id="av-print-btn">Print this profile</button>
      </div>

      ${genericFields.length ? `
      <div class="av-section">
        <h2>Details</h2>
        <div class="av-fields">
          ${genericFields.map(([k, v]) => `<div><div class="av-field__label">${escapeHtml(labelFor(k))}</div><div class="av-field__value">${escapeHtml(formatFieldValue(v))}</div></div>`).join('')}
        </div>
      </div>` : ''}

      ${(adjacency.parents.length || adjacency.partners.length || adjacency.children.length) ? `
      <div class="av-section">
        <h2>Relationships</h2>
        ${adjacency.parents.length ? `<p><strong>Parents</strong></p><div class="av-rel-list">${adjacency.parents.map(personChip).join('')}</div>` : ''}
        ${adjacency.partners.length ? `<p><strong>Partners</strong></p><div class="av-rel-list">${adjacency.partners.map(personChip).join('')}</div>` : ''}
        ${adjacency.children.length ? `<p><strong>Children</strong></p><div class="av-rel-list">${adjacency.children.map(personChip).join('')}</div>` : ''}
      </div>` : ''}

      ${person.events?.length ? `
      <div class="av-section">
        <h2>Life events</h2>
        <ul class="av-events">
          ${[...person.events].sort((a, b) => (a.year || 0) - (b.year || 0)).map((e) => `<li>${e.year ? `<span class="av-event__year">${escapeHtml(e.year)}</span>` : ''}${escapeHtml(e.title || '')}${e.detail ? ' — ' + escapeHtml(e.detail) : ''}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${person.memories?.length ? `
      <div class="av-section">
        <h2>Memories</h2>
        <ul class="av-memories">
          ${person.memories.map((m) => `<li>${escapeHtml(m.text || '')}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${renderKeepsakeSection(person, keepsakeMedia)}

      ${documentMedia.length ? `
      <div class="av-section">
        <h2>Documents</h2>
        <ul class="av-documents">
          ${documentMedia.map(renderDocumentItem).join('')}
        </ul>
      </div>` : ''}

      ${photoMedia.length ? `
      <div class="av-section">
        <h2>Photos</h2>
        <div class="av-media-grid">
          ${photoMedia.map(renderMediaItem).join('')}
        </div>
      </div>` : ''}
    `;

    root.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => { location.hash = `#/person/${encodeURIComponent(btn.dataset.goto)}`; });
    });
    const printBtn = document.getElementById('av-print-btn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());
  }

  function renderMediaItem(m) {
    if (m.warning) {
      return `<div class="av-media-item"><div class="av-media-item__warning">${escapeHtml(m.warning.replace('_', ' '))}</div><div>${escapeHtml(m.path)}</div></div>`;
    }
    const isImage = /\.(jpe?g|png|webp|gif)$/i.test(m.path);
    // Media paths (photos/documents/thumbnails/keepsakes) are archive-ROOT-
    // relative, matching where START-HERE.html itself lives — resolved
    // against the document's own base URL, not this script's location, so
    // no "../" is needed even though app.js is loaded from viewer/app.js.
    return `<div class="av-media-item">
      ${isImage ? `<img src="${escapeHtml(m.path)}" alt="" loading="lazy">` : ''}
      <div>${escapeHtml(m.path.split('/').pop())}</div>
      <a href="${escapeHtml(m.path)}" target="_blank" rel="noopener">Open</a>
    </div>`;
  }

  // Documents get their own list (not the generic photo grid) so the
  // real document TITLE (from DATA.documents, keyed by the media entry's
  // fileId for the 'document' recordType — 'document_thumb' entries share
  // the same owning document but their OWN fileId is the thumb's own
  // record id, not the document's, so those fall back to a generic label)
  // is what the viewer shows, not just a bare filename.
  function renderDocumentItem(m) {
    const doc = m.recordType === 'document' ? DATA.documents?.[m.fileId] : null;
    const title = doc?.title || m.path.split('/').pop();
    if (m.warning) {
      return `<li class="av-media-item"><div class="av-media-item__warning">${escapeHtml(m.warning.replace('_', ' '))}</div><div>${escapeHtml(title)}</div></li>`;
    }
    return `<li class="av-media-item">
      <div>${escapeHtml(title)}</div>
      <a href="${escapeHtml(m.path)}" target="_blank" rel="noopener">Open document</a>
    </li>`;
  }

  // Renders the person's current Keepsake edition as a genuine readable
  // narrative (epithet, chapters, legacy) — not a bare link to the raw
  // JSON file, per §3.8's "Keepsake narrative reading when present".
  // Falls back to an explicit "content not included" note when a
  // Keepsake reference exists in the archive but no narrative body was
  // embedded for it (e.g. missing/unreadable, or Phase A's own metadata-
  // only inventory with no body available at all).
  function renderKeepsakeSection(person, keepsakeMedia) {
    if (person.keepsake) {
      const n = person.keepsake.narrative || {};
      return `
      <div class="av-section av-keepsake">
        <h2>Keepsake</h2>
        ${n.epithet ? `<p class="av-keepsake__epithet">${escapeHtml(n.epithet)}</p>` : ''}
        ${(n.origins || []).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
        ${(n.chapters || []).map((ch) => `
          <div class="av-keepsake__chapter">
            <h3>${escapeHtml(ch.title || '')} ${ch.years ? `<span class="av-keepsake__years">${escapeHtml(ch.years)}</span>` : ''}</h3>
            ${(ch.paragraphs || []).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
          </div>`).join('')}
        ${(n.legacy || []).length ? `<div class="av-keepsake__legacy">${n.legacy.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>` : ''}
      </div>`;
    }
    if (keepsakeMedia.length) {
      const current = keepsakeMedia.find((m) => m.isLatestEdition) || keepsakeMedia[0];
      return `
      <div class="av-section av-keepsake">
        <h2>Keepsake</h2>
        <p>A Keepsake exists for this person, but its narrative content isn't included in this archive${current.warning ? ` (${escapeHtml(current.warning.replace('_', ' '))})` : ''}.</p>
        ${!current.warning ? `<a href="${escapeHtml(current.path)}" target="_blank" rel="noopener">Open the raw Keepsake file</a>` : ''}
      </div>`;
    }
    return '';
  }

  function route() {
    const match = /^#\/person\/(.+)$/.exec(location.hash);
    activeId = match ? decodeURIComponent(match[1]) : (peopleList[0]?.id ?? null);
    renderDirectory(document.getElementById('av-search').value);
    renderProfile(activeId);
  }

  document.getElementById('av-search').addEventListener('input', (e) => renderDirectory(e.target.value));
  window.addEventListener('hashchange', route);

  renderHeader();
  route();
})();
