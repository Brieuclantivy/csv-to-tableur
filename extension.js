const vscode = require('vscode');
const crypto = require('crypto');
const path = require('path');
const C = require('./media/core.js');

const VIEW_TYPE = 'csvViewer.editor';
const COMPARE_SCHEME = 'csv-compare';
const compared = new Map(); // uri -> texte des résultats de comparaison (jamais écrit sur disque)
let compareCount = 0;

function activate(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const provider = new CsvEditorProvider(context, status);

  context.subscriptions.push(
    status,
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.registerTextDocumentContentProvider(COMPARE_SCHEME, {
      provideTextDocumentContent: uri => compared.get(uri.toString()) ?? '',
    }),
    vscode.workspace.onDidCloseTextDocument(doc => compared.delete(doc.uri.toString())),
    vscode.commands.registerCommand('csvViewer.open', uri => {
      const target = uri || vscode.window.activeTextEditor?.document.uri;

      if (target) {
        vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
      }
    }),
    vscode.commands.registerCommand('csvViewer.openText', uri => {
      const target = uri || provider.activeUri;

      if (target) {
        vscode.commands.executeCommand('vscode.openWith', target, 'default');
      }
    }),
  );
}

class CsvEditorProvider {
  constructor(context, status) {
    this.context = context;
    this.status = status;
    this.activeUri = null;
  }

  resolveCustomTextEditor(document, panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    let lastSent = null;
    let counts = null;

    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = this.html(panel.webview, media);

    const send = () => {
      const text = document.getText();

      if (text === lastSent) {
        return;
      }

      lastSent = text;
      panel.webview.postMessage({ type: 'update', text });
    };

    const showStatus = () => {
      if (!panel.active || !counts) {
        return;
      }

      const filtered = counts.shown !== counts.total;
      this.status.text = `$(table) ${counts.shown} / ${counts.total} rows`;
      this.status.tooltip = `${counts.cols} columns${filtered ? ' — filter active' : ''}`;
      this.status.show();
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        send();
      }
    });

    panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.activeUri = document.uri;
        showStatus();
      } else {
        this.status.hide();
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();

      if (panel.active) {
        this.status.hide();
      }
    });

    if (panel.active) {
      this.activeUri = document.uri;
    }

    panel.webview.onDidReceiveMessage(async msg => {
      switch (msg.type) {
        case 'ready':
          lastSent = null;
          send();
          break;

        case 'edit': {
          lastSent = msg.text;
          const edit = new vscode.WorkspaceEdit();
          const end = document.lineAt(document.lineCount - 1).range.end;
          edit.replace(document.uri, new vscode.Range(0, 0, end.line, end.character), msg.text);
          const ok = await vscode.workspace.applyEdit(edit);

          // Document en lecture seule (résultat de comparaison) : la grille revient au contenu réel.
          if (!ok) {
            lastSent = null;
            send();
          }

          break;
        }

        case 'counts':
          counts = msg;
          showStatus();
          break;

        case 'export': {
          const parsed = path.parse(document.uri.fsPath);
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(parsed.dir, `${parsed.name}-view${parsed.ext}`)),
            filters: { CSV: ['csv', 'tsv', 'txt'] },
          });

          if (target) {
            await vscode.workspace.fs.writeFile(target, Buffer.from(msg.text, 'utf8'));
            vscode.window.showInformationMessage(`View exported: ${target.fsPath}`);
          }

          break;
        }

        case 'compare':
          await compareWith(document, msg.delim, msg.hasHeader);
          break;

        case 'openText':
          vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
          break;
      }
    });
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const uri = f => webview.asWebviewUri(vscode.Uri.joinPath(media, f));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('style.css')}">
</head>
<body>
<div id="toolbar">
  <input id="search" type="search" placeholder="Search all columns…">
  <div id="chips"></div>
</div>
<div id="grid" tabindex="0">
  <table id="table"><colgroup id="colgroup"></colgroup><thead id="thead"></thead><tbody id="tbody"></tbody></table>
  <input id="editor" hidden>
</div>
<div id="footer">
  <div class="left">
    <label>Delimiter
      <select id="delim">
        <option value="auto">Auto</option>
        <option value=",">,</option>
        <option value=";">;</option>
        <option value="&#9;">Tab</option>
        <option value="|">|</option>
      </select>
    </label>
    <label><input type="checkbox" id="hdr" checked> First row is a header</label>
    <button id="clearAll" title="Remove all filters, the search and the sort">Clear all</button>
    <button id="compare" title="Compare this file (A) with another CSV (B) on a key column and chosen columns">Compare with…</button>
    <button id="export" title="Save the displayed rows (filtered and sorted) to a new file">Export view</button>
    <button id="openText">Open as text</button>
  </div>
  <div class="right">
    <span id="selstats"></span>
    <span id="counts"></span>
  </div>
</div>
<div id="menu" hidden>
  <div class="mtitle" id="mtitle"></div>
  <button class="mitem" data-sort="1">↑ Sort smallest to largest (A → Z)</button>
  <button class="mitem" data-sort="-1">↓ Sort largest to smallest (Z → A)</button>
  <button class="mitem" data-sort="0">Remove sort</button>
  <hr>
  <div class="mlabel">Condition</div>
  <div class="mrow">
    <select id="mop">
      <option value="">(none)</option>
      <option value="eq">equals</option>
      <option value="neq">does not equal</option>
      <option value="contains">contains</option>
      <option value="notcontains">does not contain</option>
      <option value="starts">starts with</option>
      <option value="ends">ends with</option>
      <option value="empty">is empty / null</option>
      <option value="notempty">is not empty</option>
      <option value="gt">&gt;</option>
      <option value="gte">≥</option>
      <option value="lt">&lt;</option>
      <option value="lte">≤</option>
    </select>
    <input id="marg" placeholder="value">
  </div>
  <hr>
  <div class="mlabel">Values</div>
  <input id="msearch" type="search" placeholder="Search values…">
  <label class="mall"><input type="checkbox" id="mall"> (Select all)</label>
  <div id="mvals"></div>
  <div class="mactions">
    <button id="mclear" class="secondary">Clear filter</button>
    <button id="mok">OK</button>
  </div>
</div>
<script nonce="${nonce}" src="${uri('core.js')}"></script>
<script nonce="${nonce}" src="${uri('main.js')}"></script>
</body>
</html>`;
  }
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

function readTable(text, delim, hasHeader) {
  const rows = C.parse(text, delim).rows.filter(r => r.length > 1 || r[0] !== '');
  const header = hasHeader ? rows.shift() || [] : [];
  let ncols = header.length;

  for (const r of rows) {
    if (r.length > ncols) {
      ncols = r.length;
    }
  }

  const names = [];

  for (let c = 0; c < ncols; c++) {
    names.push((header[c] ?? '').trim());
  }

  return { rows, names };
}

function colLabel(t, c) {
  return t.names[c] || colLetter(c);
}

function columnItems(t) {
  return t.names.map((n, c) => ({ label: n ? `${colLetter(c)} — ${n}` : colLetter(c), c }));
}

async function pickColumn(t, title) {
  const it = await vscode.window.showQuickPick(columnItems(t), { title, placeHolder: 'Pick a column' });

  return it?.c;
}

// Colonne de B correspondant à la colonne c de A : même nom (sans casse), sinon choix manuel.
async function matchColumn(a, c, b) {
  const name = a.names[c].toLowerCase();
  const found = name ? b.names.findIndex(n => n.toLowerCase() === name) : -1;

  if (found >= 0) {
    return found;
  }

  return pickColumn(b, `Column of B matching "${colLabel(a, c)}" of A`);
}

async function compareWith(docA, delimA, hasHeader) {
  const pathA = docA.uri.fsPath;
  const picked = await vscode.window.showOpenDialog({
    defaultUri: vscode.Uri.file(path.dirname(pathA)),
    canSelectMany: false,
    filters: { CSV: ['csv', 'tsv', 'txt'] },
    openLabel: 'Compare',
    title: `Compare ${path.basename(pathA)} (A) with… (B)`,
  });

  if (!picked) {
    return;
  }

  const docB = await vscode.workspace.openTextDocument(picked[0]);
  const textB = docB.getText();
  const a = readTable(docA.getText(), delimA, hasHeader);
  const b = readTable(textB, C.detectDelimiter(textB), hasHeader);

  const keyA = await pickColumn(a, 'Key column of A (e.g. the patient id)');

  if (keyA === undefined) {
    return;
  }

  const keyB = await matchColumn(a, keyA, b);

  if (keyB === undefined) {
    return;
  }

  const cols = await vscode.window.showQuickPick(columnItems(a).filter(it => it.c !== keyA), {
    title: 'Columns of A to compare',
    placeHolder: 'Tick the columns to compare, or none to compare the keys only',
    canPickMany: true,
  });

  if (!cols) {
    return;
  }

  const pairs = [];

  for (const it of cols) {
    const cb = await matchColumn(a, it.c, b);

    if (cb === undefined) {
      return;
    }

    pairs.push([it.c, cb, colLabel(a, it.c)]);
  }

  const kA = colLabel(a, keyA);
  const kB = colLabel(b, keyB);
  const header = ['Status', kA === kB ? kA : `${kA} / ${kB}`, 'Differences'];

  for (const [ca, cb] of pairs) {
    header.push(`${colLabel(a, ca)} (A)`, `${colLabel(b, cb)} (B)`);
  }

  const body = C.compareTables(a.rows, b.rows, [keyA, keyB], pairs);
  const pathB = picked[0].fsPath;
  const uri = vscode.Uri.joinPath(
    vscode.Uri.file(path.dirname(pathA)),
    `${path.parse(pathA).name} vs ${path.parse(pathB).name}.csv`,
  ).with({ scheme: COMPARE_SCHEME, query: String(++compareCount) });

  compared.set(uri.toString(), C.serialize([header, ...body], delimA, '\n', true, false));
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);

  const n = {};

  for (const r of body) {
    n[r[0]] = (n[r[0]] || 0) + 1;
  }

  const summary = ['only in A', 'only in B', 'different', 'same'].map(s => `${n[s] || 0} ${s}`).join(', ');
  vscode.window.showInformationMessage(`A = ${pathA} — B = ${pathB}: ${summary}. Filter the Status column to list them.`);
}

function deactivate() {}

module.exports = { activate, deactivate };
