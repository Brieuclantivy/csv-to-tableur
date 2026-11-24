# CSV to Tableur

A VS Code extension that opens `.csv` / `.tsv` files in a spreadsheet-like grid, the way Excel would.

![Preview: sorting and filtering a CSV file](images/screenshot.png)

## Features

- **Grid**: frozen header and row numbers, column letters (A, B, C…), right-aligned numbers, greyed-out `NULL` values, virtual scrolling for large files.
- **Sorting**: click a column name → ▲ ascending → ▼ descending → none. Numbers (`1,5`, `1 234`), dates (`31/12/2024`, `2024-12-31`) and text (natural order, case-insensitive) are all recognised. Empty cells always stay at the bottom.
- **Excel-style filters** (▾ button on each column):
  - a condition: equals, not equals, contains, starts/ends with, is empty / null, is not empty, `>`, `≥`, `<`, `≤`;
  - a checklist of values, with occurrence counts and a search box.
  - Filters on several columns combine with AND. Example: `A = 'toot'` AND `B is empty`.
- **Row count** in the bottom-right corner (and in the VS Code status bar): `shown rows / total`.
- **Global search** across all columns.
- **Selection** with the mouse or keyboard (Shift to extend, click a letter to select a whole column, click a row number to select a row). Selection statistics: count, sum, average, min, max.
- **Copy** (Ctrl+C): the selection is copied as tab-separated values and pastes straight into Excel.
- **Editing**: double-click, Enter, F2 or just start typing. Delete clears cells. Ctrl+Z undoes (handled by VS Code). Save as usual with Ctrl+S.
- **Delimiter** auto-detected (`,` `;` Tab `|`), can be changed in the footer. "First row is a header" checkbox.
- **Export view**: saves the filtered and sorted rows to a new file.
- **Compare with…**: compares the open file (A) with another CSV (B) on a key column (e.g. a patient id; the column names may differ, e.g. `id_patient` ↔ `patient_id`) and the columns you choose. The result opens in the grid, read-only and in memory only, with a *Status* column (`only in A`, `only in B`, `different`, `same`) and the names of the differing columns. Keys and values are compared ignoring surrounding spaces; a repeated key is paired in order of appearance.
- Resizable columns (drag the edge; double-click to auto-fit).
- "Open as text" button to switch back to the regular editor.

## Build from source

```sh
npm install
npm run package
code --install-extension csv-to-tableur-0.1.0.vsix
```

## Tests

```sh
npm test
```

## License

MIT
