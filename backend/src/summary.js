// The Summary sheet: anonymous statistics on formulas that update themselves. Pure function:
// summaryLayout() returns cells, formulas and formats; setup() in entry.js writes them.
// Every formula finds its Responses column by header text (MATCH on the first row), never
// by letter, and excludes rows whose Source is "test". No names, no emails, no single rows.

import { HEADERS } from './sheet.js';

export const SUMMARY_SHEET_NAME = 'Summary';
export const SUMMARY_NOTE = 'Figures update by themselves with every new response. Test rows (Source = test) are not counted. After the questions change, run setup() again to refresh the question names.';
export const SUMMARY_COLUMNS = 4;        // visible columns A to D
export const HELPER_FIRST_COLUMN = 8;    // H to K: the unsorted question table that the sorted one reads
export const QUESTION_ROWS = 12;
export const SOURCE_ROWS = 30;           // room for 30 distinct sources in the "By source" table
export const PERCENT = '0%';
export const TWO_DECIMALS = '0.00';
export const DATE_TIME = 'yyyy-mm-dd hh:mm';

// A1 column letter for a 1-based column number.
export function columnLetter(column) {
  let n = column;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// Checks that stop setup() from writing a formula with a mismatched bracket or quote.
export function balanced(formula) {
  let depth = 0;
  let doubleQuotes = 0;
  let singleQuotes = 0;
  for (const char of formula) {
    if (char === '"') doubleQuotes += 1;
    if (char === "'") singleQuotes += 1;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && doubleQuotes % 2 === 0 && singleQuotes % 2 === 0;
}

// lastColumn: the letter of the last column of the Responses grid at setup time, so the
// references never point outside the sheet.
function makeColumnRef(lastColumn) {
  return (header) => `INDEX(Responses!$A$2:$${lastColumn},0,MATCH("${header}",Responses!$1:$1,0))`;
}

// Layout rows (1-based) that other formulas refer to.
export const ROWS = {
  note: 1,
  responsesTitle: 3,
  total: 4,
  subscribed: 5,
  notSubscribed: 6,
  first: 7,
  last: 8,
  resultTitle: 10,
  resultFirst: 11,          // 11 to 14: three pillars and Balanced
  priorityTitle: 16,
  priorityFirst: 17,        // 17 to 19: three pillars
  focused: 20,
  differs: 21,
  averageTitle: 23,
  averageFirst: 24,         // 24 to 26
  questionsTitle: 28,
  questionsHeader: 29,
  questionsFirst: 30,       // 30 to 41, the sorted table (and the helper rows in H to K)
  sourceTitle: 43,
  sourceHeader: 44,
  sourceFirst: 45,          // 45 to 74
};

// pillars: [{ key, short }] from the content (or the keys alone), items: [{ pillarShort, title, code }]
// in question order, lastColumn: letter of the last column of Responses.
export function summaryLayout({ pillars, items, lastColumn }) {
  const col = makeColumnRef(lastColumn);
  const notTest = `${col('Source')},"<>test"`;
  const total = `$B$${ROWS.total}`;
  const share = (cell) => `=IF(${total}=0,0,${cell}/${total})`;
  const cells = [];
  const formulas = [];
  const formats = [];
  const bold = [];
  const value = (row, column, text) => cells.push({ row, column, value: text });
  const formula = (row, column, text, format) => {
    if (!balanced(text)) throw new Error(`unbalanced formula at row ${row}, column ${column}: ${text}`);
    formulas.push({ row, column, formula: text });
    if (format) formats.push({ row, column, rows: 1, columns: 1, format });
  };
  const title = (row, text) => {
    value(row, 1, text);
    bold.push({ row, column: 1, rows: 1, columns: SUMMARY_COLUMNS });
  };

  value(ROWS.note, 1, SUMMARY_NOTE);

  // 1. Responses
  title(ROWS.responsesTitle, 'Responses');
  value(ROWS.total, 1, 'Responses (test rows excluded)');
  formula(ROWS.total, 2, `=COUNTIFS(${col('Result')},"<>",${notTest})`);
  value(ROWS.subscribed, 1, 'Subscribed to the newsletter');
  formula(ROWS.subscribed, 2, `=COUNTIFS(${col('Newsletter consent')},"Yes",${notTest})`);
  formula(ROWS.subscribed, 3, share(`B${ROWS.subscribed}`), PERCENT);
  value(ROWS.notSubscribed, 1, 'Not subscribed');
  formula(ROWS.notSubscribed, 2, `=COUNTIFS(${col('Newsletter consent')},"No",${notTest})`);
  formula(ROWS.notSubscribed, 3, share(`B${ROWS.notSubscribed}`), PERCENT);
  value(ROWS.first, 1, 'First response');
  formula(ROWS.first, 2, `=IF(${total}=0,"-",MINIFS(${col('Received at')},${notTest},${col('Result')},"<>"))`, DATE_TIME);
  value(ROWS.last, 1, 'Last response');
  formula(ROWS.last, 2, `=IF(${total}=0,"-",MAXIFS(${col('Received at')},${notTest},${col('Result')},"<>"))`, DATE_TIME);

  // 2. Result
  title(ROWS.resultTitle, 'Result');
  const labels = pillars.map((pillar) => pillar.short || pillar.key);
  [...labels, 'Balanced'].forEach((label, i) => {
    const row = ROWS.resultFirst + i;
    value(row, 1, label);
    formula(row, 2, `=COUNTIFS(${col('Result')},"${label}",${notTest})`);
    formula(row, 3, share(`B${row}`), PERCENT);
  });

  // 3. Priority
  title(ROWS.priorityTitle, 'Priority');
  labels.forEach((label, i) => {
    const row = ROWS.priorityFirst + i;
    value(row, 1, label);
    formula(row, 2, `=COUNTIFS(${col('Priority')},"${label}",${notTest})`);
    formula(row, 3, share(`B${row}`), PERCENT);
  });
  value(ROWS.focused, 1, 'Responses with a focus (not balanced)');
  formula(ROWS.focused, 2, `=COUNTIFS(${col('Result')},"<>",${col('Result')},"<>Balanced",${notTest})`);
  value(ROWS.differs, 1, 'Priority differs from the result');
  formula(ROWS.differs, 2, `=SUMPRODUCT((${col('Source')}<>"test")*(${col('Result')}<>"")*(${col('Result')}<>"Balanced")*(${col('Priority')}<>${col('Result')}))`);
  formula(ROWS.differs, 3, `=IF($B$${ROWS.focused}=0,0,B${ROWS.differs}/$B$${ROWS.focused})`, PERCENT);

  // 4. Average by pillar
  title(ROWS.averageTitle, 'Average by pillar');
  const averageHeaders = ['Foundation avg', 'Professional avg', 'Visibility avg'];
  labels.forEach((label, i) => {
    const row = ROWS.averageFirst + i;
    value(row, 1, label);
    formula(row, 2, `=IFERROR(AVERAGEIFS(${col(averageHeaders[i])},${notTest}),"-")`, TWO_DECIMALS);
  });

  // 5. Average by question, lowest first: the helper block in H to K holds the unsorted
  // rows, the visible block sorts them by the average.
  title(ROWS.questionsTitle, 'Average by question, lowest first');
  ['Pillar', 'Question', 'Average', 'Answers 1 to 4'].forEach((header, i) => value(ROWS.questionsHeader, i + 1, header));
  bold.push({ row: ROWS.questionsHeader, column: 1, rows: 1, columns: SUMMARY_COLUMNS });
  const h = HELPER_FIRST_COLUMN;
  value(ROWS.questionsHeader, h, 'Helper rows for the sorted table on the left (hidden, do not edit)');
  items.forEach((item, i) => {
    const row = ROWS.questionsFirst + i;
    value(row, h, item.pillarShort);
    value(row, h + 1, item.title);
    formula(row, h + 2, `=IFERROR(AVERAGEIFS(${col(item.code)},${notTest}),"-")`, TWO_DECIMALS);
    formula(row, h + 3, `=IF(${total}=0,"-",COUNTIFS(${col(item.code)},"<=4",${notTest})/${total})`, PERCENT);
  });
  const helperRange = `$${columnLetter(h)}$${ROWS.questionsFirst}:$${columnLetter(h + 3)}$${ROWS.questionsFirst + items.length - 1}`;
  formula(ROWS.questionsFirst, 1, `=SORT(${helperRange},3,TRUE)`);
  formats.push({ row: ROWS.questionsFirst, column: 3, rows: items.length, columns: 1, format: TWO_DECIMALS });
  formats.push({ row: ROWS.questionsFirst, column: 4, rows: items.length, columns: 1, format: PERCENT });

  // 6. By source
  title(ROWS.sourceTitle, 'By source');
  ['Source', 'Responses', 'Subscribed', 'Subscribed share'].forEach((header, i) => value(ROWS.sourceHeader, i + 1, header));
  bold.push({ row: ROWS.sourceHeader, column: 1, rows: 1, columns: SUMMARY_COLUMNS });
  formula(ROWS.sourceFirst, 1,
    `=IFERROR(QUERY({${col('Source')},ARRAYFORMULA(IF(${col('Newsletter consent')}="Yes",1,0))},"select Col1, count(Col1), sum(Col2) where Col1 <> 'test' and Col1 <> '' group by Col1 order by count(Col1) desc label count(Col1) '', sum(Col2) ''",0),"-")`);
  for (let i = 0; i < SOURCE_ROWS; i += 1) {
    const row = ROWS.sourceFirst + i;
    formula(row, 4, `=IF(OR(B${row}="",NOT(ISNUMBER(B${row}))),"",IF(B${row}=0,0,C${row}/B${row}))`, PERCENT);
  }

  return {
    cells,
    formulas,
    formats,
    bold,
    hiddenColumns: { start: HELPER_FIRST_COLUMN, count: 4 },
    autoResize: { start: 1, count: SUMMARY_COLUMNS },
    rows: ROWS.sourceFirst + SOURCE_ROWS - 1,
    columns: HELPER_FIRST_COLUMN + 3,
  };
}

// Question rows from the content (names) or from the answer codes alone.
export function questionItems(content) {
  const codes = HEADERS.slice(HEADERS.indexOf('F1'), HEADERS.indexOf('V4') + 1);
  if (!content || !Array.isArray(content.pillars)) {
    return codes.map((code) => ({ pillarShort: code.charAt(0), title: code, code }));
  }
  const items = [];
  content.pillars.forEach((pillar) => {
    (pillar.items || []).forEach((item, i) => {
      const code = `${pillar.key}${i + 1}`;
      items.push({ pillarShort: pillar.short || pillar.key, title: item.title || code, code });
    });
  });
  return items.length === codes.length ? items : codes.map((code) => ({ pillarShort: code.charAt(0), title: code, code }));
}

export function pillarLabels(content) {
  if (!content || !Array.isArray(content.pillars) || content.pillars.length !== 3) {
    return [{ key: 'F' }, { key: 'P' }, { key: 'V' }];
  }
  return content.pillars.map((pillar) => ({ key: pillar.key, short: pillar.short }));
}
