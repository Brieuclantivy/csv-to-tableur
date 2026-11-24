// Logique pure (parsing, tri, filtres) : partagée entre la webview et les tests Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CsvCore = factory();
  }
})(this, function () {
  const CANDIDATES = [',', ';', '\t', '|'];
  const QUOTE = 34;

  function parse(text, delim) {
    let bom = false;

    if (text.charCodeAt(0) === 0xfeff) {
      bom = true;
      text = text.slice(1);
    }

    const rows = [];
    const n = text.length;
    let row = [];
    let i = 0;
    let eol = null;

    while (i < n) {
      if (text.charCodeAt(i) === QUOTE) {
        i++;
        let start = i;
        let val = '';

        while (true) {
          const q = text.indexOf('"', i);

          if (q === -1) {
            val += text.slice(start);
            i = n;
            break;
          }

          if (text.charCodeAt(q + 1) === QUOTE) {
            val += text.slice(start, q + 1);
            i = q + 2;
            start = i;
            continue;
          }

          val += text.slice(start, q);
          i = q + 1;
          break;
        }

        // Texte parasite après le guillemet fermant : gardé tel quel.
        const s2 = i;

        while (i < n && text[i] !== delim && text[i] !== '\n' && text[i] !== '\r') {
          i++;
        }

        row.push(val + text.slice(s2, i));
      } else {
        const s = i;

        while (i < n && text[i] !== delim && text[i] !== '\n' && text[i] !== '\r') {
          i++;
        }

        row.push(text.slice(s, i));
      }

      if (i >= n) {
        rows.push(row);
        row = null;
        break;
      }

      if (text[i] === delim) {
        i++;

        if (i >= n) {
          row.push('');
          rows.push(row);
          row = null;
        }

        continue;
      }

      if (text[i] === '\r' && text[i + 1] === '\n') {
        eol = eol || '\r\n';
        i += 2;
      } else {
        eol = eol || text[i];
        i++;
      }

      rows.push(row);
      row = [];
    }

    const trailingNewline = n > 0 && (text[n - 1] === '\n' || text[n - 1] === '\r');

    return { rows, eol: eol || '\n', trailingNewline, bom };
  }

  function quote(v, delim) {
    if (v.includes('"') || v.includes(delim) || v.includes('\n') || v.includes('\r')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }

    return v;
  }

  function serialize(rows, delim, eol, trailingNewline, bom) {
    const body = rows.map(r => r.map(v => quote(v, delim)).join(delim)).join(eol);

    return (bom ? '﻿' : '') + body + (trailingNewline && rows.length ? eol : '');
  }

  function detectDelimiter(text) {
    const sample = text.slice(0, 64 * 1024);
    let best = ',';
    let bestScore = -1;

    for (const d of CANDIDATES) {
      const rows = parse(sample, d).rows.slice(0, 50);

      if (sample.length === 64 * 1024 && rows.length > 1) {
        rows.pop();
      }

      if (!rows.length || rows[0].length < 2) {
        continue;
      }

      const first = rows[0].length;
      const consistent = rows.filter(r => r.length === first).length / rows.length;
      const score = consistent * 1000 + first;

      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }

    return best;
  }

  // Nombre strict : "12", "-3,5", "1.2e3", "1 234,5". Tout le reste est du texte.
  const NUM_RE = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;

  function toNumber(s) {
    if (!s) {
      return null;
    }

    const t = s.replace(/[\s  ]/g, '');

    if (!t || !NUM_RE.test(t)) {
      return null;
    }

    return Number(t.replace(',', '.'));
  }

  const FR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

  function toDateKey(s) {
    let m = FR_DATE.exec(s);

    if (m) {
      return dateKey(m[3], m[2], m[1], m[4], m[5], m[6]);
    }

    m = ISO_DATE.exec(s);

    if (m) {
      return dateKey(m[1], m[2], m[3], m[4], m[5], m[6]);
    }

    return null;
  }

  function dateKey(y, mo, d, h, mi, s) {
    return ((((+y * 100 + +mo) * 100 + +d) * 100 + +(h || 0)) * 100 + +(mi || 0)) * 100 + +(s || 0);
  }

  // t: 0 nombre, 1 date, 2 texte, 3 vide (toujours en dernier).
  function sortKey(v) {
    const s = v.trim();

    if (s === '') {
      return { t: 3, k: 0 };
    }

    const n = toNumber(s);

    if (n !== null) {
      return { t: 0, k: n };
    }

    const d = toDateKey(s);

    if (d !== null) {
      return { t: 1, k: d };
    }

    return { t: 2, k: s };
  }

  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

  function compareKeys(a, b) {
    if (a.t !== b.t) {
      return a.t - b.t;
    }

    if (a.t === 2) {
      return collator.compare(a.k, b.k);
    }

    return a.k < b.k ? -1 : a.k > b.k ? 1 : 0;
  }

  function compareValues(a, b) {
    return compareKeys(sortKey(a), sortKey(b));
  }

  function isEmptyValue(v) {
    const t = v.trim();

    return t === '' || t.toLowerCase() === 'null';
  }

  function sameValue(v, arg) {
    const a = toNumber(v);
    const b = toNumber(arg);

    if (a !== null && b !== null) {
      return a === b;
    }

    return v.trim().toLowerCase() === arg.trim().toLowerCase();
  }

  function matchCondition(v, op, arg) {
    const lv = v.toLowerCase();
    const la = (arg || '').toLowerCase();

    switch (op) {
      case 'eq': return sameValue(v, arg || '');
      case 'neq': return !sameValue(v, arg || '');
      case 'contains': return lv.includes(la);
      case 'notcontains': return !lv.includes(la);
      case 'starts': return lv.startsWith(la);
      case 'ends': return lv.endsWith(la);
      case 'empty': return isEmptyValue(v);
      case 'notempty': return !isEmptyValue(v);
      case 'gt': return !isEmptyValue(v) && compareValues(v, arg || '') > 0;
      case 'gte': return !isEmptyValue(v) && compareValues(v, arg || '') >= 0;
      case 'lt': return !isEmptyValue(v) && compareValues(v, arg || '') < 0;
      case 'lte': return !isEmptyValue(v) && compareValues(v, arg || '') <= 0;
      default: return true;
    }
  }

  // filters : Map(colonne -> { values: Set|null, op: string|null, arg: string })
  // sort : { col, dir: 1|-1 } | null
  function computeView(rows, start, filters, search, sort) {
    const active = [...filters.entries()];
    const s = search ? search.toLowerCase() : '';
    const idx = [];

    for (let r = start; r < rows.length; r++) {
      const row = rows[r];
      let ok = true;

      for (const [c, f] of active) {
        const v = row[c] ?? '';

        if ((f.values && !f.values.has(v)) || (f.op && !matchCondition(v, f.op, f.arg))) {
          ok = false;
          break;
        }
      }

      if (ok && s && !row.some(v => v.toLowerCase().includes(s))) {
        ok = false;
      }

      if (ok) {
        idx.push(r);
      }
    }

    if (sort) {
      const keys = new Map();

      for (const r of idx) {
        keys.set(r, sortKey(rows[r][sort.col] ?? ''));
      }

      idx.sort((a, b) => {
        const ka = keys.get(a);
        const kb = keys.get(b);

        // Les vides restent en bas quel que soit le sens.
        if (ka.t === 3 || kb.t === 3) {
          return (ka.t === 3) - (kb.t === 3) || a - b;
        }

        return compareKeys(ka, kb) * sort.dir || a - b;
      });
    }

    return idx;
  }

  // Compare deux tables via une colonne clé ; clés et valeurs sont comparées sans les espaces autour.
  // key : [colonne A, colonne B] ; pairs : [[colonne A, colonne B, libellé], ...].
  // Une clé répétée est appariée dans l'ordre : 1re occurrence de A avec 1re de B, etc.
  // Renvoie les lignes [statut, clé, libellés des colonnes différentes, valeur A, valeur B, ...].
  function compareTables(rowsA, rowsB, key, pairs) {
    const val = (r, c) => (r[c] ?? '').trim();
    const byKey = new Map();
    const matched = new Array(rowsB.length).fill(false);

    rowsB.forEach((r, i) => {
      const k = val(r, key[1]);

      if (!byKey.has(k)) {
        byKey.set(k, []);
      }

      byKey.get(k).push(i);
    });

    const line = (status, k, a, b) => {
      const diffs = a && b ? pairs.filter(p => val(a, p[0]) !== val(b, p[1])).map(p => p[2]) : [];
      const cells = pairs.flatMap(p => [a ? (a[p[0]] ?? '') : '', b ? (b[p[1]] ?? '') : '']);

      return [status || (diffs.length ? 'different' : 'same'), k, diffs.join(', '), ...cells];
    };

    const out = [];

    for (const a of rowsA) {
      const k = val(a, key[0]);
      const queue = byKey.get(k);

      if (queue && queue.length) {
        const i = queue.shift();
        matched[i] = true;
        out.push(line(null, k, a, rowsB[i]));
      } else {
        out.push(line('only in A', k, a, null));
      }
    }

    rowsB.forEach((b, i) => {
      if (!matched[i]) {
        out.push(line('only in B', val(b, key[1]), null, b));
      }
    });

    return out;
  }

  return {
    parse,
    serialize,
    quote,
    detectDelimiter,
    toNumber,
    sortKey,
    compareValues,
    isEmptyValue,
    matchCondition,
    computeView,
    compareTables,
  };
});
