(function () {
  const vscode = acquireVsCodeApi();
  const C = window.CsvCore;
  const ROW_H = 24;
  const BUFFER = 15;

  const $ = id => document.getElementById(id);
  const grid = $('grid');
  const table = $('table');
  const colgroup = $('colgroup');
  const thead = $('thead');
  const tbody = $('tbody');
  const menu = $('menu');
  const editor = $('editor');

  const OPS = {
    eq: a => `= ${q(a)}`,
    neq: a => `≠ ${q(a)}`,
    contains: a => `contains ${q(a)}`,
    notcontains: a => `does not contain ${q(a)}`,
    starts: a => `starts with ${q(a)}`,
    ends: a => `ends with ${q(a)}`,
    empty: () => 'is empty',
    notempty: () => 'is not empty',
    gt: a => `> ${a}`,
    gte: a => `≥ ${a}`,
    lt: a => `< ${a}`,
    lte: a => `≤ ${a}`,
  };
  const NO_ARG = new Set(['', 'empty', 'notempty']);

  let text = '';
  let parsed = { rows: [], eol: '\n', trailingNewline: true, bom: false };
  let delimMode = 'auto';
  let delim = ',';
  let hasHeader = true;
  let ncols = 0;
  let headers = [];
  let filters = new Map();
  let sort = null;
  let search = '';
  let view = [];
  let widths = [];
  let rnWidth = 48;
  let sel = null; // { ar, ac, fr, fc } : ancre et curseur, en coordonnées de la vue
  let dragging = false;
  let editing = null;
  let menuState = null;

  function q(s) {
    return `'${s}'`;
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colLetter(c) {
    let s = '';
    c++;

    while (c > 0) {
      const m = (c - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      c = Math.floor((c - 1) / 26);
    }

    return s;
  }

  function colName(c) {
    return headers[c] ? `${colLetter(c)} (${headers[c]})` : colLetter(c);
  }

  function dataStart() {
    return hasHeader && parsed.rows.length ? 1 : 0;
  }

  function fmt(n) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 10 });
  }

  // ---------- Chargement ----------

  function load(newText, keepState) {
    text = newText;
    delim = delimMode === 'auto' ? C.detectDelimiter(text) : delimMode;
    parsed = C.parse(text, delim);

    let n = 0;

    for (const r of parsed.rows) {
      if (r.length > n) {
        n = r.length;
      }
    }

    if (!keepState || n !== ncols) {
      filters = new Map();
      sort = null;
      sel = null;
      widths = [];
    }

    ncols = n;
    headers = [];

    for (let c = 0; c < ncols; c++) {
      headers.push(hasHeader && parsed.rows[0] ? (parsed.rows[0][c] ?? '') : '');
    }

    if (widths.length !== ncols) {
      widths = autoWidths();
    }

    const label = { ',': ',', ';': ';', '\t': 'Tab', '|': '|' }[delim] || delim;
    $('delim').options[0].textContent = `Auto (${label})`;

    refresh();
  }

  let measureCtx = null;

  function textWidth(s) {
    if (!measureCtx) {
      measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = getComputedStyle(document.body).font;
    }

    return measureCtx.measureText(s).width;
  }

  function autoWidth(c, sample) {
    let w = textWidth(headers[c] || '') + textWidth(colLetter(c)) + 56;

    for (const r of sample) {
      const v = parsed.rows[r][c];

      if (v) {
        w = Math.max(w, textWidth(v.length > 80 ? v.slice(0, 80) : v) + 20);
      }
    }

    return Math.round(Math.min(Math.max(w, 60), 420));
  }

  function autoWidths() {
    const sample = [];

    for (let r = dataStart(); r < parsed.rows.length && sample.length < 300; r++) {
      sample.push(r);
    }

    const out = [];

    for (let c = 0; c < ncols; c++) {
      out.push(autoWidth(c, sample));
    }

    return out;
  }

  function refresh() {
    view = C.computeView(parsed.rows, dataStart(), filters, search, sort);

    if (sel) {
      clampSel();
    }

    const total = parsed.rows.length - dataStart();
    rnWidth = Math.max(44, String(total).length * 8 + 20);

    renderHeader();
    renderBody();
    renderChips();
    renderCounts(total);
    renderSelStats();
    vscode.postMessage({ type: 'counts', shown: view.length, total, cols: ncols });
  }

  function clampSel() {
    if (!view.length || !ncols) {
      sel = null;
      return;
    }

    const maxR = view.length - 1;
    const maxC = ncols - 1;
    sel.ar = Math.min(sel.ar, maxR);
    sel.fr = Math.min(sel.fr, maxR);
    sel.ac = Math.min(sel.ac, maxC);
    sel.fc = Math.min(sel.fc, maxC);
  }

  // ---------- Rendu ----------

  function applyWidths() {
    const cols = colgroup.children;

    for (let c = 0; c < ncols; c++) {
      cols[c + 1].style.width = widths[c] + 'px';
    }

    table.style.width = rnWidth + widths.reduce((a, b) => a + b, 0) + 'px';
  }

  function renderHeader() {
    colgroup.innerHTML = `<col style="width:${rnWidth}px">` + widths.map(w => `<col style="width:${w}px">`).join('');
    table.style.width = rnWidth + widths.reduce((a, b) => a + b, 0) + 'px';

    let h = '<tr><th class="rn corner" title="Select all"></th>';

    for (let c = 0; c < ncols; c++) {
      const f = filters.get(c);
      const s = sort && sort.col === c ? (sort.dir > 0 ? '▲' : '▼') : '';
      const name = headers[c];

      h += `<th data-c="${c}"><div class="h">`
        + `<span class="letter" title="Select column">${colLetter(c)}</span>`
        + `<span class="name" title="${esc(name)}${name ? ' — ' : ''}click to sort">${esc(name)}</span>`
        + `<span class="sort">${s}</span>`
        + `<button class="fbtn${f ? ' on' : ''}" title="Sort / filter">${f ? '⏷' : '▾'}</button>`
        + '</div><div class="resizer" title="Drag to resize, double-click to auto-fit"></div></th>';
    }

    thead.innerHTML = h + '</tr>';
  }

  function normSel() {
    if (!sel) {
      return null;
    }

    return {
      r0: Math.min(sel.ar, sel.fr),
      r1: Math.max(sel.ar, sel.fr),
      c0: Math.min(sel.ac, sel.fc),
      c1: Math.max(sel.ac, sel.fc),
      fr: sel.fr,
      fc: sel.fc,
    };
  }

  function spacer(height) {
    return `<tr class="spacer" style="height:${height}px"><td colspan="${ncols + 1}"></td></tr>`;
  }

  function renderBody() {
    const top = grid.scrollTop;
    const hgt = grid.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / ROW_H) - BUFFER);
    const last = Math.min(view.length, Math.ceil((top + hgt) / ROW_H) + BUFFER);
    const s = normSel();
    const start = dataStart();
    let h = first > 0 ? spacer(first * ROW_H) : '';

    for (let v = first; v < last; v++) {
      const r = view[v];
      const row = parsed.rows[r];
      const rs = s && v >= s.r0 && v <= s.r1;

      h += `<tr data-v="${v}"><td class="rn${rs ? ' rsel' : ''}">${r - start + 1}</td>`;

      for (let c = 0; c < ncols; c++) {
        const val = row[c] ?? '';
        let cls = '';

        if (rs && c >= s.c0 && c <= s.c1) {
          cls += ' sel';
        }

        if (s && v === s.fr && c === s.fc) {
          cls += ' cur';
        }

        if (C.toNumber(val) !== null) {
          cls += ' num';
        } else if (val.trim().toLowerCase() === 'null') {
          cls += ' null';
        }

        const title = val.length > 25 ? ` title="${esc(val)}"` : '';
        h += `<td data-c="${c}" class="${cls}"${title}>${esc(val)}</td>`;
      }

      h += '</tr>';
    }

    if (view.length > last) {
      h += spacer((view.length - last) * ROW_H);
    }

    if (!view.length) {
      h += `<tr class="empty"><td colspan="${ncols + 1}">${parsed.rows.length ? 'No rows match the filters.' : 'Empty file.'}</td></tr>`;
    }

    tbody.innerHTML = h;
  }

  function renderChips() {
    const parts = [];

    if (sort) {
      parts.push(`<span class="chip" data-kind="sort">Sort: ${esc(colName(sort.col))} ${sort.dir > 0 ? '▲' : '▼'}<b data-x="sort">✕</b></span>`);
    }

    for (const [c, f] of filters) {
      const conds = [];

      if (f.op) {
        conds.push(OPS[f.op](f.arg));
      }

      if (f.values) {
        conds.push(f.values.size === 1 ? `= ${q([...f.values][0])}` : `∈ ${f.values.size} values`);
      }

      parts.push(`<span class="chip" data-c="${c}">${esc(colName(c))} ${esc(conds.join(' and '))}<b data-x="${c}">✕</b></span>`);
    }

    if (search) {
      parts.push(`<span class="chip">Search ${esc(q(search))}<b data-x="search">✕</b></span>`);
    }

    $('chips').innerHTML = parts.join('<span class="and">AND</span>');
  }

  function renderCounts(total) {
    const el = $('counts');
    const filtered = view.length !== total;
    el.classList.toggle('filtered', filtered);
    el.innerHTML = `<b>${fmt(view.length)}</b> / ${fmt(total)} rows · ${ncols} columns`;
  }

  function renderSelStats() {
    const el = $('selstats');
    const s = normSel();

    if (!s || (s.r0 === s.r1 && s.c0 === s.c1)) {
      el.textContent = '';
      return;
    }

    if ((s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1) > 3e6) {
      el.textContent = 'Selection too large for statistics';
      return;
    }

    let count = 0;
    let nums = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let v = s.r0; v <= s.r1; v++) {
      const row = parsed.rows[view[v]];

      for (let c = s.c0; c <= s.c1; c++) {
        const val = row[c] ?? '';

        if (val === '') {
          continue;
        }

        count++;
        const n = C.toNumber(val);

        if (n !== null) {
          nums++;
          sum += n;
          min = Math.min(min, n);
          max = Math.max(max, n);
        }
      }
    }

    const parts = [`Count: ${fmt(count)}`];

    if (nums) {
      parts.push(`Sum: ${fmt(sum)}`, `Average: ${fmt(sum / nums)}`, `Min: ${fmt(min)}`, `Max: ${fmt(max)}`);
    }

    el.textContent = parts.join('  ·  ');
  }

  function updateSel() {
    renderBody();
    renderSelStats();
  }

  let scrollPending = false;

  grid.addEventListener('scroll', () => {
    if (scrollPending) {
      return;
    }

    scrollPending = true;
    requestAnimationFrame(() => {
      scrollPending = false;
      renderBody();
    });
  });

  window.addEventListener('resize', () => renderBody());

  // ---------- Sélection et clavier ----------

  function cellFrom(target) {
    const td = target.closest('td');

    if (!td || !td.parentElement.dataset.v) {
      return null;
    }

    return {
      v: +td.parentElement.dataset.v,
      c: td.classList.contains('rn') ? -1 : +td.dataset.c,
    };
  }

  tbody.addEventListener('mousedown', e => {
    if (e.button !== 0) {
      return;
    }

    const cell = cellFrom(e.target);

    if (!cell) {
      return;
    }

    if (cell.c === -1) {
      if (e.shiftKey && sel) {
        sel.fr = cell.v;
      } else {
        sel = { ar: cell.v, ac: 0, fr: cell.v, fc: ncols - 1 };
      }

      sel.ac = 0;
      sel.fc = ncols - 1;
    } else if (e.shiftKey && sel) {
      sel.fr = cell.v;
      sel.fc = cell.c;
    } else {
      sel = { ar: cell.v, ac: cell.c, fr: cell.v, fc: cell.c };
    }

    dragging = cell.c === -1 ? 'row' : 'cell';
    e.preventDefault();
    grid.focus();
    updateSel();
  });

  tbody.addEventListener('mouseover', e => {
    if (!dragging || !sel) {
      return;
    }

    const cell = cellFrom(e.target);

    if (!cell) {
      return;
    }

    sel.fr = cell.v;

    if (dragging === 'cell' && cell.c >= 0) {
      sel.fc = cell.c;
    }

    updateSel();
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });

  tbody.addEventListener('dblclick', e => {
    const cell = cellFrom(e.target);

    if (cell && cell.c >= 0) {
      startEdit(null);
    }
  });

  function selectAll() {
    if (view.length && ncols) {
      sel = { ar: 0, ac: 0, fr: view.length - 1, fc: ncols - 1 };
      updateSel();
    }
  }

  function ensureVisible(v, c) {
    const hh = thead.offsetHeight;
    const top = v * ROW_H;

    if (top < grid.scrollTop) {
      grid.scrollTop = top;
    } else if (top + ROW_H > grid.scrollTop + grid.clientHeight - hh) {
      grid.scrollTop = top + ROW_H - grid.clientHeight + hh;
    }

    let left = 0;

    for (let i = 0; i < c; i++) {
      left += widths[i];
    }

    const viewW = grid.clientWidth - rnWidth;

    if (left < grid.scrollLeft) {
      grid.scrollLeft = left;
    } else if (left + widths[c] > grid.scrollLeft + viewW) {
      grid.scrollLeft = left + widths[c] - viewW;
    }
  }

  grid.addEventListener('keydown', e => {
    if (editing || e.target !== grid) {
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }

    if (!sel) {
      return;
    }

    const page = Math.max(1, Math.floor(grid.clientHeight / ROW_H) - 2);
    let { fr, fc } = sel;
    let move = true;

    switch (e.key) {
      case 'ArrowUp': fr = ctrl ? 0 : fr - 1; break;
      case 'ArrowDown': fr = ctrl ? view.length - 1 : fr + 1; break;
      case 'ArrowLeft': fc = ctrl ? 0 : fc - 1; break;
      case 'ArrowRight': fc = ctrl ? ncols - 1 : fc + 1; break;
      case 'PageUp': fr -= page; break;
      case 'PageDown': fr += page; break;
      case 'Home': fc = 0; if (ctrl) { fr = 0; } break;
      case 'End': fc = ncols - 1; if (ctrl) { fr = view.length - 1; } break;
      case 'Tab': fc += e.shiftKey ? -1 : 1; break;
      default: move = false;
    }

    if (move) {
      e.preventDefault();
      fr = Math.max(0, Math.min(view.length - 1, fr));
      fc = Math.max(0, Math.min(ncols - 1, fc));

      if (e.shiftKey && e.key !== 'Tab') {
        sel.fr = fr;
        sel.fc = fc;
      } else {
        sel = { ar: fr, ac: fc, fr, fc };
      }

      ensureVisible(fr, fc);
      updateSel();
      return;
    }

    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      startEdit(null);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearSelection();
    } else if (e.key.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault();
      startEdit(e.key);
    }
  });

  document.addEventListener('copy', e => {
    if (editing || document.activeElement !== grid) {
      return;
    }

    const s = normSel();

    if (!s) {
      return;
    }

    const lines = [];

    for (let v = s.r0; v <= s.r1; v++) {
      const row = parsed.rows[view[v]];
      const cells = [];

      for (let c = s.c0; c <= s.c1; c++) {
        cells.push(C.quote(row[c] ?? '', '\t'));
      }

      lines.push(cells.join('\t'));
    }

    e.clipboardData.setData('text/plain', lines.join('\n'));
    e.preventDefault();
  });

  // ---------- Édition ----------

  function startEdit(initial) {
    if (!sel) {
      return;
    }

    const v = sel.fr;
    const c = sel.fc;
    sel = { ar: v, ac: c, fr: v, fc: c };
    ensureVisible(v, c);
    updateSel();

    const td = tbody.querySelector(`tr[data-v="${v}"] td[data-c="${c}"]`);

    if (!td) {
      return;
    }

    const g = grid.getBoundingClientRect();
    const t = td.getBoundingClientRect();
    const r = view[v];

    editor.style.top = t.top - g.top + grid.scrollTop + 'px';
    editor.style.left = t.left - g.left + grid.scrollLeft + 'px';
    editor.style.width = Math.max(t.width, 160) + 'px';
    editor.style.height = t.height + 'px';
    editor.value = initial !== null ? initial : (parsed.rows[r][c] ?? '');
    editor.hidden = false;
    editing = { r, c };
    editor.focus();

    if (initial === null) {
      editor.select();
    }
  }

  function commitEdit(save) {
    if (!editing) {
      return;
    }

    const { r, c } = editing;
    editing = null;
    editor.hidden = true;

    if (save) {
      setCells([[r, c, editor.value]]);
    }

    grid.focus();
  }

  editor.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit(true);

      if (sel) {
        const fr = e.key === 'Enter' ? Math.min(view.length - 1, sel.fr + 1) : sel.fr;
        const fc = e.key === 'Tab' ? Math.min(ncols - 1, sel.fc + 1) : sel.fc;
        sel = { ar: fr, ac: fc, fr, fc };
        ensureVisible(fr, fc);
        updateSel();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      commitEdit(false);
    }
  });

  editor.addEventListener('blur', () => commitEdit(true));

  function clearSelection() {
    const s = normSel();

    if (!s) {
      return;
    }

    const list = [];

    for (let v = s.r0; v <= s.r1; v++) {
      for (let c = s.c0; c <= s.c1; c++) {
        list.push([view[v], c, '']);
      }
    }

    setCells(list);
  }

  function setCells(list) {
    let changed = false;

    for (const [r, c, val] of list) {
      const row = parsed.rows[r];

      if ((row[c] ?? '') === val) {
        continue;
      }

      while (row.length <= c) {
        row.push('');
      }

      row[c] = val;
      changed = true;
    }

    if (!changed) {
      return;
    }

    // La vue n'est pas recalculée (comme Excel) : la ligne éditée reste à sa place.
    text = C.serialize(parsed.rows, delim, parsed.eol, parsed.trailingNewline, parsed.bom);
    vscode.postMessage({ type: 'edit', text });
    updateSel();
  }

  // ---------- En-têtes : tri, sélection de colonne, redimensionnement ----------

  function cycleSort(c) {
    if (!sort || sort.col !== c) {
      sort = { col: c, dir: 1 };
    } else if (sort.dir === 1) {
      sort = { col: c, dir: -1 };
    } else {
      sort = null;
    }

    refresh();
  }

  thead.addEventListener('mousedown', e => {
    const resizer = e.target.closest('.resizer');

    if (!resizer) {
      return;
    }

    e.preventDefault();
    const c = +resizer.parentElement.dataset.c;
    const startX = e.clientX;
    const startW = widths[c];

    const onMove = ev => {
      widths[c] = Math.max(30, startW + ev.clientX - startX);
      applyWidths();
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  thead.addEventListener('dblclick', e => {
    const resizer = e.target.closest('.resizer');

    if (resizer) {
      const c = +resizer.parentElement.dataset.c;
      widths[c] = autoWidth(c, view.slice(0, 1000));
      applyWidths();
    }
  });

  thead.addEventListener('click', e => {
    if (e.target.closest('.resizer')) {
      return;
    }

    if (e.target.closest('.corner')) {
      selectAll();
      grid.focus();
      return;
    }

    const th = e.target.closest('th[data-c]');

    if (!th) {
      return;
    }

    const c = +th.dataset.c;

    if (e.target.closest('.fbtn')) {
      e.stopPropagation();
      openMenu(c, th);
    } else if (e.target.closest('.letter')) {
      if (view.length) {
        sel = e.shiftKey && sel
          ? { ar: 0, ac: sel.ac, fr: view.length - 1, fc: c }
          : { ar: 0, ac: c, fr: view.length - 1, fc: c };
        grid.focus();
        updateSel();
      }
    } else {
      cycleSort(c);
    }
  });

  // ---------- Menu de filtre (façon Excel) ----------

  function openMenu(c, th) {
    const f = filters.get(c) || { values: null, op: null, arg: '' };
    const others = new Map(filters);
    others.delete(c);

    const counts = new Map();

    for (const r of C.computeView(parsed.rows, dataStart(), others, search, null)) {
      const v = parsed.rows[r][c] ?? '';
      counts.set(v, (counts.get(v) || 0) + 1);
    }

    const values = [...counts.keys()].sort(C.compareValues);
    const checked = new Set(f.values ? values.filter(v => f.values.has(v)) : values);

    menuState = { c, values, counts, checked, query: '', visible: values };
    $('mtitle').textContent = colName(c);
    $('mop').value = f.op || '';
    $('marg').value = f.arg || '';
    $('marg').hidden = NO_ARG.has($('mop').value);
    $('msearch').value = '';
    renderMenuValues();

    menu.hidden = false;
    const r = th.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(r.left, window.innerWidth - mw - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(r.bottom + 2, window.innerHeight - mh - 4)) + 'px';
  }

  function renderMenuValues() {
    const { values, counts, checked } = menuState;
    const query = menuState.query.toLowerCase();
    const visible = query ? values.filter(v => v.toLowerCase().includes(query)) : values;
    const shown = visible.slice(0, 500);
    menuState.visible = visible;

    let h = shown.map((v, i) =>
      `<label><input type="checkbox" data-i="${i}"${checked.has(v) ? ' checked' : ''}>`
      + `<span class="v">${v === '' ? '<i>(empty)</i>' : esc(v)}</span>`
      + `<span class="cnt">${fmt(counts.get(v))}</span></label>`).join('');

    if (visible.length > shown.length) {
      h += `<div class="more">… ${fmt(visible.length - shown.length)} more values, refine your search</div>`;
    }

    if (!visible.length) {
      h = '<div class="more">No values</div>';
    }

    $('mvals').innerHTML = h;
    $('mall').checked = visible.length > 0 && visible.every(v => checked.has(v));
  }

  function closeMenu() {
    menu.hidden = true;
    menuState = null;
  }

  $('mvals').addEventListener('change', e => {
    const v = menuState.visible[+e.target.dataset.i];

    if (e.target.checked) {
      menuState.checked.add(v);
    } else {
      menuState.checked.delete(v);
    }

    $('mall').checked = menuState.visible.every(x => menuState.checked.has(x));
  });

  $('mall').addEventListener('change', e => {
    for (const v of menuState.visible) {
      if (e.target.checked) {
        menuState.checked.add(v);
      } else {
        menuState.checked.delete(v);
      }
    }

    renderMenuValues();
  });

  $('msearch').addEventListener('input', e => {
    menuState.query = e.target.value;
    renderMenuValues();
  });

  $('mop').addEventListener('change', e => {
    $('marg').hidden = NO_ARG.has(e.target.value);

    if (!$('marg').hidden) {
      $('marg').focus();
    }
  });

  function applyMenu() {
    const { c, values, checked, query, visible } = menuState;
    // Comme Excel : avec une recherche, seules les valeurs trouvées et cochées sont gardées.
    const chosen = (query ? visible : values).filter(v => checked.has(v));
    const valuesFilter = chosen.length === values.length ? null : new Set(chosen);
    const op = $('mop').value || null;
    const arg = $('marg').value;

    if (!valuesFilter && !op) {
      filters.delete(c);
    } else {
      filters.set(c, { values: valuesFilter, op, arg });
    }

    closeMenu();
    refresh();
  }

  $('mok').addEventListener('click', applyMenu);

  menu.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      applyMenu();
    } else if (e.key === 'Escape') {
      closeMenu();
      grid.focus();
    }
  });

  $('mclear').addEventListener('click', () => {
    filters.delete(menuState.c);
    closeMenu();
    refresh();
  });

  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');

    if (!b) {
      return;
    }

    const dir = +b.dataset.sort;
    sort = dir ? { col: menuState.c, dir } : null;
    closeMenu();
    refresh();
  });

  document.addEventListener('mousedown', e => {
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('.fbtn')) {
      closeMenu();
    }
  });

  // ---------- Barre du haut et pied de page ----------

  let searchTimer = null;

  $('search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = e.target.value;
      refresh();
    }, 150);
  });

  $('chips').addEventListener('click', e => {
    const x = e.target.closest('[data-x]');

    if (x) {
      if (x.dataset.x === 'sort') {
        sort = null;
      } else if (x.dataset.x === 'search') {
        search = '';
        $('search').value = '';
      } else {
        filters.delete(+x.dataset.x);
      }

      refresh();
      return;
    }

    const chip = e.target.closest('.chip[data-c]');

    if (chip) {
      const th = thead.querySelector(`th[data-c="${chip.dataset.c}"]`);
      openMenu(+chip.dataset.c, th);
    }
  });

  $('delim').addEventListener('change', e => {
    delimMode = e.target.value;
    load(text, false);
  });

  $('hdr').addEventListener('change', e => {
    hasHeader = e.target.checked;
    widths = [];
    load(text, true);
  });

  $('clearAll').addEventListener('click', () => {
    filters = new Map();
    sort = null;
    search = '';
    $('search').value = '';
    refresh();
  });

  $('export').addEventListener('click', () => {
    const rows = view.map(r => parsed.rows[r]);

    if (hasHeader && parsed.rows.length) {
      rows.unshift(parsed.rows[0]);
    }

    vscode.postMessage({ type: 'export', text: C.serialize(rows, delim, parsed.eol, true, false) });
  });

  $('compare').addEventListener('click', () => vscode.postMessage({ type: 'compare', delim, hasHeader }));

  $('openText').addEventListener('click', () => vscode.postMessage({ type: 'openText' }));

  // ---------- Messages de l'extension ----------

  window.addEventListener('message', e => {
    const m = e.data;

    if (m.type === 'update') {
      if (editing) {
        commitEdit(false);
      }

      load(m.text, true);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
