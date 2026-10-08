import * as XLSX from 'xlsx';

const SEP = '|';
const idForIndex = (i) => String.fromCharCode(97 + i); // 0->a, 1->b, ...

// ----- EXPORT: questions -> worksheet rows -----
export function questionsToRows(questions) {
  return questions.map((q) => {
    const type = q.type || 'SINGLE';
    let choices = '';
    let answer = '';
    if (type === 'TEXT') {
      // answer = correctText | accepted1 | accepted2 ...
      answer = [q.correctText || '', ...((q.acceptedAnswers || []).filter(Boolean))].join(SEP);
    } else {
      const list = q.choices || [];
      choices = list.map((c) => c.text).join(SEP);
      const correctIds = new Set(q.correctChoiceIds || []);
      answer = list.filter((c) => correctIds.has(c.id)).map((c) => c.text).join(SEP);
    }
    return {
      type,
      body: q.body || '',
      choices,
      answer,
      points: q.points || 1,
      timeSec: q.timeoutSec || 10,
    };
  });
}

export function downloadXlsx(questions, filename = 'quiz-questions.xlsx') {
  const rows = questionsToRows(questions);
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ['type', 'body', 'choices', 'answer', 'points', 'timeSec'],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'questions');
  XLSX.writeFile(wb, filename);
}

// ----- IMPORT: file -> questions[] (append; order assigned by caller) -----
// Supports .xlsx / .xls / .csv. CSV is read as UTF-8 text so 한글이 깨지지 않음.
export async function parseXlsx(file) {
  const isCsv = /\.csv$/i.test(file.name || '') || file.type === 'text/csv';
  let wb;
  if (isCsv) {
    // read as UTF-8 text (strip BOM) → let SheetJS parse CSV (quotes/commas handled)
    let text = await file.text();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    wb = XLSX.read(text, { type: 'string' });
  } else {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: 'array' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rowsToQuestions(rows);
}

export function rowsToQuestions(rows) {
  const out = [];
  for (const r of rows) {
    const type = String(r.type || '').trim().toUpperCase();
    if (!['SINGLE', 'MULTI', 'TEXT'].includes(type)) continue; // skip invalid/empty rows
    const body = String(r.body ?? '').trim();
    const points = Number(r.points) > 0 ? Math.floor(Number(r.points)) : 1;
    const timeoutSec = Number(r.timeSec) > 0 ? Math.floor(Number(r.timeSec)) : 10;

    const splitCell = (v) => String(v ?? '').split(SEP).map((s) => s.trim()).filter((s) => s !== '');

    if (type === 'TEXT') {
      const ans = splitCell(r.answer);
      out.push({
        type, body,
        choices: null, correctChoiceIds: null,
        correctText: ans[0] || '',
        acceptedAnswers: ans.slice(1),
        points, timeoutSec, imageKey: null, imageUrl: null, _new: true,
      });
    } else {
      const choiceTexts = splitCell(r.choices);
      const choices = choiceTexts.map((text, i) => ({ id: idForIndex(i), text }));
      const answerTexts = new Set(splitCell(r.answer));
      const correctChoiceIds = choices.filter((c) => answerTexts.has(c.text)).map((c) => c.id);
      out.push({
        type, body, choices, correctChoiceIds,
        correctText: '', acceptedAnswers: [],
        points, timeoutSec, imageKey: null, imageUrl: null, _new: true,
      });
    }
  }
  return out;
}
