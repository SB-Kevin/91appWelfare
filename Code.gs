/*************************************************************
 * 91APP 世界盃開踢 — Google Sheet Web App
 * 分頁：predictions / teams / results / meta
 * 部署：部署 → 新增部署作業 → 網頁應用程式
 *        執行身分＝我、誰可存取＝任何人 → 取得 /exec 網址
 *
 * 寫入三種途徑：
 *   1) doPost（外部 caller / Zapier / 後端，帶 token）
 *   2) importFromDrive（時間觸發器，讀 Drive 上的 worldcup_results.json）← Claude 排程用
 *   3) （手動）直接編輯各分頁
 *************************************************************/

const SS = SpreadsheetApp.getActiveSpreadsheet();

// 寫入用密碼（doPost 需要），請自訂並妥善保管
const WRITE_TOKEN = '請改成你自己的密碼';

// Claude 排程寫到 Drive 的檔名（importFromDrive 會讀它）
const DRIVE_RESULT_FILE = 'worldcup_results.json';
// 指定存放資料夾 ID（Claude 建檔與 importFromDrive 讀檔都在此資料夾）
const DRIVE_FOLDER_ID = '14HM-mQrt2IswY4AiKISQ3m2iRnIaJ5wl';

/* ====================== 讀取（GET） ====================== */
function doGet(e) {
  const data = {
    meta:        readMeta_(),
    teams:       readTable_('teams'),
    players:     readTable_('players'),
    predictions: readPredictions_(),   // 不含 email
    results:     readResults_()
  };
  const json = JSON.stringify(data);
  if (e && e.parameter && e.parameter.callback) {
    return ContentService.createTextOutput(e.parameter.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function readTable_(name) {
  const sh = SS.getSheetByName(name);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const head = rows.shift().map(h => String(h).trim());
  return rows.filter(r => r.join('').trim() !== '')
    .map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; });
}

function readPredictions_() {
  const toCode = {};
  readTable_('teams').forEach(t => {
    const code = String(t.code || '').trim();
    if (code) { toCode[code] = code; toCode[String(t.name || '').trim()] = code; }
  });
  return readTable_('predictions').map(p => {
    const champ = String(p.champion || '').trim();
    return {
      nickname:   String(p.nickname || '').trim(),
      department: String(p.department || '').trim(),
      champion:   toCode[champ] || champ
    };
  }).filter(p => p.nickname && p.champion);
}

function readResults_() {
  const out = {};
  readTable_('results').forEach(r => {
    const id = String(r.matchId || '').trim();
    if (!id) return;
    out[id] = { winner: String(r.winner||'').trim(), score: String(r.score||'').trim(), pk: String(r.pk||'').trim() };
  });
  return out;
}

function readMeta_() {
  const o = {};
  readTable_('meta').forEach(r => { o[String(r.key).trim()] = r.value; });
  return {
    last_updated: o.last_updated || '',
    demo_mode: (o.demo_mode === true || String(o.demo_mode).toUpperCase() === 'TRUE'),
    form_url: o.form_url || ''
  };
}

/* ====================== 寫入（POST，外部 caller） ====================== */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== WRITE_TOKEN) return _json({ ok: false, error: 'unauthorized' });
    applyWrite_(body);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/* ====================== Claude 排程交接：讀 Drive 檔 → 寫 Sheet ======================
 * Claude 每日把整理好的結果寫成 Drive 檔（application/json）：
 * { "last_updated":"...", "demo_mode":false,
 *   "results":[{"matchId":"r0m0","winner":"ARG","score":"2-0","pk":""}],
 *   "teams":[{"code":"ARG","name":"阿根廷","flag":"🇦🇷","predictable":true,"match":10,"pos":0}] }
 * 在「觸發器」設定 importFromDrive 為「時間驅動 → 每日 07:10」即可全自動。
 */
function importFromDrive() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const it = folder.getFilesByName(DRIVE_RESULT_FILE);
  const files = [];
  while (it.hasNext()) files.push(it.next());
  if (!files.length) return;
  files.sort((a, b) => b.getLastUpdated() - a.getLastUpdated());  // 取最新
  const body = JSON.parse(files[0].getBlob().getDataAsString());
  applyWrite_(body);
  files.forEach(f => f.setTrashed(true));   // 匯入後刪除，避免重複處理
}

/* ====================== 共用寫入邏輯 ====================== */
function applyWrite_(body) {
  // results（依 matchId upsert）
  if (Array.isArray(body.results)) {
    const sh = SS.getSheetByName('results');
    const rows = sh.getDataRange().getValues();
    const head = rows[0].map(h => String(h).trim());
    const col = n => head.indexOf(n);
    const rowById = {};
    for (let i = 1; i < rows.length; i++) rowById[String(rows[i][col('matchId')]).trim()] = i + 1;
    body.results.forEach(r => {
      const id = String(r.matchId || '').trim(); if (!id) return;
      let row = rowById[id];
      if (!row) { row = sh.getLastRow() + 1; sh.getRange(row, col('matchId') + 1).setValue(id); rowById[id] = row; }
      const set = (f, v) => { if (v !== undefined && col(f) >= 0) sh.getRange(row, col(f) + 1).setValue(v); };
      set('winner', r.winner); set('score', r.score); set('pk', r.pk);
    });
  }
  // teams（依 code upsert；32 強對戰公布後寫入真實隊伍）
  if (Array.isArray(body.teams)) {
    const tsh = SS.getSheetByName('teams');
    const tr = tsh.getDataRange().getValues();
    const th = tr[0].map(h => String(h).trim());
    const tc = n => th.indexOf(n);
    const rowByCode = {};
    for (let i = 1; i < tr.length; i++) rowByCode[String(tr[i][tc('code')]).trim()] = i + 1;
    body.teams.forEach(t => {
      const code = String(t.code || '').trim(); if (!code) return;
      let row = rowByCode[code];
      if (!row) { row = tsh.getLastRow() + 1; tsh.getRange(row, tc('code') + 1).setValue(code); rowByCode[code] = row; }
      const set = (f, v) => { if (v !== undefined && tc(f) >= 0) tsh.getRange(row, tc(f) + 1).setValue(v); };
      set('name', t.name); set('flag', t.flag); set('predictable', t.predictable);
      set('match', t.match); set('pos', t.pos);
    });
  }
  // players（整批覆蓋：清空後重寫，因同隊多列）
  if (Array.isArray(body.players)) {
    const psh = SS.getSheetByName('players');
    const ph = psh.getDataRange().getValues()[0].map(h => String(h).trim());
    const pc = n => ph.indexOf(n);
    if (psh.getLastRow() > 1) psh.getRange(2, 1, psh.getLastRow() - 1, psh.getLastColumn()).clearContent();
    body.players.forEach((p, i) => {
      const row = i + 2;
      const set = (f, v) => { if (v !== undefined && pc(f) >= 0) psh.getRange(row, pc(f) + 1).setValue(v); };
      set('code', p.code); set('name', p.name); set('role', p.role); set('note', p.note); set('wiki', p.wiki);
    });
  }

  // meta
  if (body.last_updated !== undefined || body.demo_mode !== undefined || body.form_url !== undefined) {
    const meta = SS.getSheetByName('meta');
    const mv = meta.getDataRange().getValues();
    const setMeta = (k, v) => {
      for (let i = 1; i < mv.length; i++) if (String(mv[i][0]).trim() === k) { meta.getRange(i + 1, 2).setValue(v); return; }
      meta.appendRow([k, v]);
    };
    if (body.last_updated !== undefined) setMeta('last_updated', body.last_updated);
    if (body.demo_mode    !== undefined) setMeta('demo_mode', body.demo_mode ? 'TRUE' : 'FALSE');
    if (body.form_url     !== undefined) setMeta('form_url', body.form_url);
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* 測試用：在編輯器執行即可驗證寫入（測完請刪測試資料） */
function testApplyWrite() {
  applyWrite_({
    last_updated: 'TEST ' + new Date().toISOString(),
    results: [{ matchId: 'r0m0', winner: 'TST', score: '9-0', pk: '' }]
  });
}
