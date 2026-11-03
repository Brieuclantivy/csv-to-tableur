const vscode = require('vscode');
const crypto = require('crypto');
const path = require('path');

const VIEW_TYPE = 'csvViewer.editor';

function activate(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const provider = new CsvEditorProvider(context, status);

  context.subscriptions.push(
    status,
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
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
      this.status.text = `$(table) ${counts.shown} / ${counts.total} lignes`;
      this.status.tooltip = `${counts.cols} colonnes${filtered ? ' — filtre actif' : ''}`;
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
          await vscode.workspace.applyEdit(edit);
          break;
        }

        case 'counts':
          counts = msg;
          showStatus();
          break;

        case 'export': {
          const parsed = path.parse(document.uri.fsPath);
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(parsed.dir, `${parsed.name}-vue${parsed.ext}`)),
            filters: { CSV: ['csv', 'tsv', 'txt'] },
          });

          if (target) {
            await vscode.workspace.fs.writeFile(target, Buffer.from(msg.text, 'utf8'));
            vscode.window.showInformationMessage(`Vue exportée : ${target.fsPath}`);
          }

          break;
        }

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
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('style.css')}">
</head>
<body>
<div id="toolbar">
  <input id="search" type="search" placeholder="Rechercher dans toutes les colonnes…">
  <div id="chips"></div>
</div>
<div id="grid" tabindex="0">
  <table id="table"><colgroup id="colgroup"></colgroup><thead id="thead"></thead><tbody id="tbody"></tbody></table>
  <input id="editor" hidden>
</div>
<div id="footer">
  <div class="left">
    <label>Séparateur
      <select id="delim">
        <option value="auto">Auto</option>
        <option value=",">,</option>
        <option value=";">;</option>
        <option value="&#9;">Tab</option>
        <option value="|">|</option>
      </select>
    </label>
    <label><input type="checkbox" id="hdr" checked> 1re ligne = en-tête</label>
    <button id="clearAll" title="Retirer tous les filtres, la recherche et le tri">Tout effacer</button>
    <button id="export" title="Enregistrer les lignes affichées (filtrées et triées) dans un nouveau fichier">Exporter la vue</button>
    <button id="openText">Ouvrir en texte</button>
  </div>
  <div class="right">
    <span id="selstats"></span>
    <span id="counts"></span>
  </div>
</div>
<div id="menu" hidden>
  <div class="mtitle" id="mtitle"></div>
  <button class="mitem" data-sort="1">↑ Trier du plus petit au plus grand (A → Z)</button>
  <button class="mitem" data-sort="-1">↓ Trier du plus grand au plus petit (Z → A)</button>
  <button class="mitem" data-sort="0">Retirer le tri</button>
  <hr>
  <div class="mlabel">Condition</div>
  <div class="mrow">
    <select id="mop">
      <option value="">(aucune)</option>
      <option value="eq">est égal à</option>
      <option value="neq">est différent de</option>
      <option value="contains">contient</option>
      <option value="notcontains">ne contient pas</option>
      <option value="starts">commence par</option>
      <option value="ends">se termine par</option>
      <option value="empty">est vide / null</option>
      <option value="notempty">n'est pas vide</option>
      <option value="gt">&gt;</option>
      <option value="gte">≥</option>
      <option value="lt">&lt;</option>
      <option value="lte">≤</option>
    </select>
    <input id="marg" placeholder="valeur">
  </div>
  <hr>
  <div class="mlabel">Valeurs</div>
  <input id="msearch" type="search" placeholder="Rechercher une valeur…">
  <label class="mall"><input type="checkbox" id="mall"> (Tout sélectionner)</label>
  <div id="mvals"></div>
  <div class="mactions">
    <button id="mclear" class="secondary">Effacer le filtre</button>
    <button id="mok">OK</button>
  </div>
</div>
<script nonce="${nonce}" src="${uri('core.js')}"></script>
<script nonce="${nonce}" src="${uri('main.js')}"></script>
</body>
</html>`;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
