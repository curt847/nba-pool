// ============================================================
// NBA Playoff Money Pool 2026 — Google Apps Script
//
// ALL requests use GET (no POST) to avoid CORS preflight issues.
// Data is passed as URL parameters, JSON-encoded where needed.
//
// SETUP:
// 1. Paste into Apps Script attached to your Google Sheet
// 2. Run initSheet() once manually
// 3. Deploy > New Deployment > Web App
//    - Execute as: Me
//    - Who has access: Anyone
// 4. Paste deployment URL into index.html CONFIG.PROXY_URL
//
// HOW WIN COUNTS WORK:
// - The SeriesWins sheet is the single source of truth.
// - t1 is the higher seed / "upper bracket" team for that slot.
// - autoUpdateWins fetches all STATUS_FINAL playoff games from
//   ESPN across the full window and writes win counts to the sheet.
// - Later-round series rows are added to SeriesWins automatically
//   when both teams are known from completed prior-round series.
// - ESPN is used ONLY for logos and live-game detection.
//   All bracket structure comes from this script.
// ============================================================

const ADMIN_PASSWORD = 'commish2026';

// ============================================================
// PLAYOFF DATE WINDOW
// ============================================================
const PLAYOFFS_START = '20260418'; // First Round Game 1
const PLAYOFFS_END   = '20260619'; // NBA Finals Game 7 (if necessary)

// ============================================================
// BRACKET SLOT DEFINITIONS
//
// The NBA bracket is fixed — no reseeding. 15 series slots:
//
// R1:  e1(1v8) e2(2v7) e3(3v6) e4(4v5)  — East
//      w1(1v8) w2(2v7) w3(3v6) w4(4v5)  — West
// R2:  e5 = winner(e1) vs winner(e4)
//      e6 = winner(e2) vs winner(e3)
//      w5 = winner(w1) vs winner(w4)
//      w6 = winner(w2) vs winner(w3)
// CF:  e7 = winner(e5) vs winner(e6)
//      w7 = winner(w5) vs winner(w6)
// Finals: f1 = winner(e7) vs winner(w7)
// ============================================================
const BRACKET_SLOTS = [
  { id:'e1', round:1, conf:'East',   src1:null, src2:null },
  { id:'e2', round:1, conf:'East',   src1:null, src2:null },
  { id:'e3', round:1, conf:'East',   src1:null, src2:null },
  { id:'e4', round:1, conf:'East',   src1:null, src2:null },
  { id:'w1', round:1, conf:'West',   src1:null, src2:null },
  { id:'w2', round:1, conf:'West',   src1:null, src2:null },
  { id:'w3', round:1, conf:'West',   src1:null, src2:null },
  { id:'w4', round:1, conf:'West',   src1:null, src2:null },
  { id:'e5', round:2, conf:'East',   src1:'e1', src2:'e4' },
  { id:'e6', round:2, conf:'East',   src1:'e2', src2:'e3' },
  { id:'w5', round:2, conf:'West',   src1:'w1', src2:'w4' },
  { id:'w6', round:2, conf:'West',   src1:'w2', src2:'w3' },
  { id:'e7', round:3, conf:'East',   src1:'e5', src2:'e6' },
  { id:'w7', round:3, conf:'West',   src1:'w5', src2:'w6' },
  { id:'f1', round:4, conf:'Finals', src1:'e7', src2:'w7' },
];

// ============================================================
// ROUND 1 — hardcoded team data
// t1 = higher seed, t2 = lower seed
// ============================================================
const R1_TEAMS = {
  e1: { team1:{name:'Detroit Pistons',       abbrev:'DET',seed:1,logo:'https://a.espncdn.com/i/teamlogos/nba/500/det.png'},
        team2:{name:'Orlando Magic',          abbrev:'ORL',seed:8,logo:'https://a.espncdn.com/i/teamlogos/nba/500/orl.png'} },
  e2: { team1:{name:'Boston Celtics',        abbrev:'BOS',seed:2,logo:'https://a.espncdn.com/i/teamlogos/nba/500/bos.png'},
        team2:{name:'Philadelphia 76ers',     abbrev:'PHI',seed:7,logo:'https://a.espncdn.com/i/teamlogos/nba/500/phi.png'} },
  e3: { team1:{name:'New York Knicks',       abbrev:'NYK',seed:3,logo:'https://a.espncdn.com/i/teamlogos/nba/500/ny.png'},
        team2:{name:'Atlanta Hawks',          abbrev:'ATL',seed:6,logo:'https://a.espncdn.com/i/teamlogos/nba/500/atl.png'} },
  e4: { team1:{name:'Cleveland Cavaliers',   abbrev:'CLE',seed:4,logo:'https://a.espncdn.com/i/teamlogos/nba/500/cle.png'},
        team2:{name:'Toronto Raptors',        abbrev:'TOR',seed:5,logo:'https://a.espncdn.com/i/teamlogos/nba/500/tor.png'} },
  w1: { team1:{name:'Oklahoma City Thunder', abbrev:'OKC',seed:1,logo:'https://a.espncdn.com/i/teamlogos/nba/500/okc.png'},
        team2:{name:'Phoenix Suns',           abbrev:'PHX',seed:8,logo:'https://a.espncdn.com/i/teamlogos/nba/500/phx.png'} },
  w2: { team1:{name:'San Antonio Spurs',     abbrev:'SAS',seed:2,logo:'https://a.espncdn.com/i/teamlogos/nba/500/sa.png'},
        team2:{name:'Portland Trail Blazers', abbrev:'POR',seed:7,logo:'https://a.espncdn.com/i/teamlogos/nba/500/por.png'} },
  w3: { team1:{name:'Denver Nuggets',        abbrev:'DEN',seed:3,logo:'https://a.espncdn.com/i/teamlogos/nba/500/den.png'},
        team2:{name:'Minnesota Timberwolves', abbrev:'MIN',seed:6,logo:'https://a.espncdn.com/i/teamlogos/nba/500/min.png'} },
  w4: { team1:{name:'Los Angeles Lakers',    abbrev:'LAL',seed:4,logo:'https://a.espncdn.com/i/teamlogos/nba/500/lal.png'},
        team2:{name:'Houston Rockets',        abbrev:'HOU',seed:5,logo:'https://a.espncdn.com/i/teamlogos/nba/500/hou.png'} },
};

// ============================================================
// SERIES ID MAP — R1 only; later rounds built dynamically
// ============================================================
const SERIES_ID_MAP_BASE = {
  'DET_ORL':'e1','ORL_DET':'e1',
  'BOS_PHI':'e2','PHI_BOS':'e2',
  'ATL_NYK':'e3','NYK_ATL':'e3','ATL_NY':'e3','NY_ATL':'e3',
  'CLE_TOR':'e4','TOR_CLE':'e4',
  'OKC_PHX':'w1','PHX_OKC':'w1',
  'POR_SAS':'w2','SAS_POR':'w2','POR_SA':'w2','SA_POR':'w2',
  'DEN_MIN':'w3','MIN_DEN':'w3',
  'HOU_LAL':'w4','LAL_HOU':'w4',
};

const ABBREV_NORMALIZE = { 'SA':'SAS', 'NY':'NYK' };
function normalizeAbbrev(a) { return ABBREV_NORMALIZE[a] || a; }

// ============================================================
// SHEET SETUP — run once manually
// ============================================================
function initSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let ps = ss.getSheetByName('Players');
  if (!ps) ps = ss.insertSheet('Players');
  if (ps.getLastRow() === 0) { ps.appendRow(['id','name','pin']); ps.setFrozenRows(1); }

  let pks = ss.getSheetByName('Picks');
  if (!pks) pks = ss.insertSheet('Picks');
  if (pks.getLastRow() === 0) { pks.appendRow(['id','playerId','seriesId','team','games','date']); pks.setFrozenRows(1); }

  let so = ss.getSheetByName('SeriesOdds');
  if (!so) so = ss.insertSheet('SeriesOdds');
  if (so.getLastRow() === 0) { so.appendRow(['seriesId','odds1','odds2']); so.setFrozenRows(1); }

  let sr = ss.getSheetByName('SeriesResults');
  if (!sr) sr = ss.insertSheet('SeriesResults');
  if (sr.getLastRow() === 0) {
    sr.appendRow(['seriesId','winner','games','round','roundName','conf','t1name','t1abbrev','t1seed','t1logo','t2name','t2abbrev','t2seed','t2logo']);
    sr.setFrozenRows(1);
  }

  let sw = ss.getSheetByName('SeriesWins');
  if (!sw) sw = ss.insertSheet('SeriesWins');
  if (sw.getLastRow() === 0) {
    sw.appendRow(['seriesId','t1wins','t2wins']);
    sw.setFrozenRows(1);
    // Only R1 rows seeded — later rounds added automatically
    ['e1','e2','e3','e4','w1','w2','w3','w4'].forEach(id => sw.appendRow([id, 0, 0]));
  }

  Logger.log('Sheet initialized.');
}

// ============================================================
// SERIES WINS — read from sheet
// ============================================================
function getSeriesWins() {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SeriesWins');
    if (!sh || sh.getLastRow() < 2) return {};
    const result = {};
    sh.getDataRange().getValues().slice(1).forEach(r => {
      if (r[0]) result[String(r[0])] = { t1wins: parseInt(r[1])||0, t2wins: parseInt(r[2])||0 };
    });
    return result;
  } catch(e) {
    Logger.log('getSeriesWins error: ' + e);
    return {};
  }
}

function ensureSeriesWinsRow(sid) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SeriesWins');
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  if (data.some(r => String(r[0]) === sid)) return;
  sh.appendRow([sid, 0, 0]);
  Logger.log('ensureSeriesWinsRow: added ' + sid);
}

// ============================================================
// RESPONSE HELPER
// ============================================================
function jsonResponse(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(`${callback}(${json})`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ALL REQUESTS GO THROUGH doGet
// ============================================================
function doGet(e) {
  const p        = e.parameter || {};
  const action   = p.action || 'getState';
  const callback = p.callback || null;

  try {
    let result;
    const payload = p.payload ? JSON.parse(p.payload) : {};
    switch (action) {
      case 'getState':          result = actionGetState();                 break;
      case 'register':          result = actionAddPlayer(payload);         break;
      case 'submitPicks':       result = actionSubmitPicks(payload);       break;
      case 'adminSetOdds':      result = actionAdminSetOdds(payload);      break;
      case 'adminResetPin':     result = actionAdminResetPin(payload);     break;
      case 'adminRemovePlayer': result = actionAdminRemovePlayer(payload); break;
      case 'adminAddPlayer':    result = actionAdminAddPlayer(payload);    break;
      case 'adminDeletePick':   result = actionAdminDeletePick(payload);   break;
      case 'syncScores':        autoUpdateWins(); result = { ok: true };    break;
      default: throw new Error('Unknown action: ' + action);
    }
    return jsonResponse({ success: true, data: result }, callback);
  } catch(err) {
    return jsonResponse({ success: false, error: err.toString() }, callback);
  }
}

// ============================================================
// GET STATE
// ============================================================
function actionGetState() {
  const players = getPlayers();
  const picks   = getPicks();
  const odds    = getSeriesOdds();

  players.forEach(p => { p.picks = picks.filter(pk => pk.playerId === p.id); });

  const series = buildAllSeries();

  series.forEach(s => {
    const o = odds.find(x => x.seriesId === s.id);
    if (o) { s.odds1 = o.odds1; s.odds2 = o.odds2; }
  });

  return { players, series, lastUpdated: new Date().toISOString() };
}

// ============================================================
// BUILD ALL SERIES
//
// Constructs all 15 bracket slots. R1 teams come from R1_TEAMS.
// Later-round teams are derived from winners of completed series
// stored in SeriesResults. TBD shown for undecided slots.
// ============================================================
function buildAllSeries() {
  const sheetWins  = getSeriesWins();
  const resultsMap = getSeriesResultsMap();
  const espnData   = fetchESPNLogosAndLive();
  const roundNames = {
    1:'First Round', 2:'Conference Semifinals',
    3:'Conference Finals', 4:'NBA Finals'
  };
  const series = [];

  // Resolve team data for every slot
  const teamsBySid = {};
  Object.entries(R1_TEAMS).forEach(([sid, t]) => { teamsBySid[sid] = t; });

  BRACKET_SLOTS.filter(sl => sl.round > 1).forEach(sl => {
    const r1 = resultsMap[sl.src1];
    const r2 = resultsMap[sl.src2];
    teamsBySid[sl.id] = {
      team1: r1 ? { name:r1.winner, abbrev:normalizeAbbrev(r1.winnerAbbrev), seed:r1.winnerSeed, logo:r1.winnerLogo } : { name:'TBD', abbrev:'TBD', seed:'?', logo:'' },
      team2: r2 ? { name:r2.winner, abbrev:normalizeAbbrev(r2.winnerAbbrev), seed:r2.winnerSeed, logo:r2.winnerLogo } : { name:'TBD', abbrev:'TBD', seed:'?', logo:'' },
    };
    // Ensure sheet row exists once both teams are known
    if (r1 && r2) ensureSeriesWinsRow(sl.id);
  });

  BRACKET_SLOTS.forEach(sl => {
    const sid   = sl.id;
    const teams = teamsBySid[sid];
    const sw    = sheetWins[sid] || { t1wins:0, t2wins:0 };
    const isTbd = teams.team1.abbrev === 'TBD' || teams.team2.abbrev === 'TBD';

    const t1logo = (!isTbd && espnData[teams.team1.abbrev]?.logo) || teams.team1.logo || '';
    const t2logo = (!isTbd && espnData[teams.team2.abbrev]?.logo) || teams.team2.logo || '';
    const hasLive = !isTbd && !!(espnData[teams.team1.abbrev]?.hasLive || espnData[teams.team2.abbrev]?.hasLive);

    const w1 = sw.t1wins;
    const w2 = sw.t2wins;

    let status = isTbd ? 'tbd' : 'pre';
    let winner = null, games = null;

    if (!isTbd) {
      if (w1 >= 4 || w2 >= 4) {
        status = 'post';
        winner = w1 >= 4 ? teams.team1.name : teams.team2.name;
        games  = w1 + w2;
        // Persist so later-round slots can resolve their teams
        saveSeriesResultIfNew({
          id:sid, winner, games, round:sl.round,
          roundName:roundNames[sl.round], conf:sl.conf, status:'post', odds1:null, odds2:null,
          team1:{...teams.team1, wins:w1, logo:t1logo},
          team2:{...teams.team2, wins:w2, logo:t2logo},
        });
      } else if (w1 > 0 || w2 > 0 || hasLive) {
        status = 'live';
      }
    }

    series.push({
      id:sid, round:sl.round,
      roundName: roundNames[sl.round] || ('Round ' + sl.round),
      conf:sl.conf,
      team1:{ ...teams.team1, wins:w1, logo:t1logo },
      team2:{ ...teams.team2, wins:w2, logo:t2logo },
      status, winner, games, odds1:null, odds2:null,
    });
  });

  Logger.log('buildAllSeries: ' + series.map(s =>
    s.id+' '+s.team1.abbrev+':'+s.team1.wins+' '+s.team2.abbrev+':'+s.team2.wins+' ['+s.status+']'
  ).join(', '));

  return series.sort((a,b) => a.round - b.round || a.conf.localeCompare(b.conf));
}

// ============================================================
// ESPN — logos + live detection ONLY
// ============================================================
function fetchESPNLogosAndLive() {
  const result = {};
  try {
    const now  = new Date();
    const yest = new Date(now.getTime() - 86400000);
    const fmt  = d => Utilities.formatDate(d, 'America/New_York', 'yyyyMMdd');
    [fmt(yest), fmt(now)].forEach(dateStr => {
      try {
        const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
                  + '?seasontype=3&limit=200&dates=' + dateStr;
        const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        const data = JSON.parse(res.getContentText());
        (data.events || []).forEach(event => {
          const comp = (event.competitions || [])[0];
          if (!comp) return;
          const statusType = comp.status?.type?.name;
          const isLive     = statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME';
          (comp.competitors || []).forEach(c => {
            if (!c.team) return;
            const abbrev = normalizeAbbrev(c.team.abbreviation || '');
            const logo   = c.team.logo || c.team.logos?.[0]?.href || '';
            if (!result[abbrev]) result[abbrev] = { logo:'', hasLive:false };
            if (logo) result[abbrev].logo = logo;
            if (isLive) result[abbrev].hasLive = true;
          });
        });
      } catch(e) { Logger.log('fetchESPNLogosAndLive date error: ' + e); }
    });
  } catch(e) { Logger.log('fetchESPNLogosAndLive error: ' + e); }
  return result;
}

// ============================================================
// SeriesResults persistence
// ============================================================
function getSeriesResults() {
  try {
    const sr = getSheet('SeriesResults');
    if (sr.getLastRow() < 2) return [];
    return sr.getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({
      id:String(r[0]), winner:String(r[1]), games:parseInt(r[2])||null,
      round:parseInt(r[3])||1, roundName:String(r[4]), conf:String(r[5]),
      status:'post', odds1:null, odds2:null,
      team1:{ name:String(r[6]),  abbrev:String(r[7]),  seed:r[8],  wins:4,                   logo:String(r[9])  },
      team2:{ name:String(r[10]), abbrev:String(r[11]), seed:r[12], wins:parseInt(r[2])-4||0, logo:String(r[13]) },
    }));
  } catch(e) { Logger.log('getSeriesResults error: ' + e); return []; }
}

function getSeriesResultsMap() {
  const map = {};
  getSeriesResults().forEach(r => {
    const winnerIsT1 = r.team1.name === r.winner;
    map[r.id] = {
      winner:       r.winner,
      winnerAbbrev: winnerIsT1 ? r.team1.abbrev : r.team2.abbrev,
      winnerSeed:   winnerIsT1 ? r.team1.seed   : r.team2.seed,
      winnerLogo:   winnerIsT1 ? r.team1.logo   : r.team2.logo,
    };
  });
  return map;
}

function saveSeriesResultIfNew(s) {
  try {
    const sr   = getSheet('SeriesResults');
    const data = sr.getLastRow() > 1 ? sr.getDataRange().getValues() : [];
    if (data.some(r => String(r[0]) === s.id)) return;
    sr.appendRow([s.id, s.winner, s.games, s.round, s.roundName, s.conf,
      s.team1.name, s.team1.abbrev, s.team1.seed, s.team1.logo,
      s.team2.name, s.team2.abbrev, s.team2.seed, s.team2.logo]);
    Logger.log('Saved series result: ' + s.id + ' winner: ' + s.winner);
  } catch(e) { Logger.log('saveSeriesResultIfNew error: ' + e); }
}

// ============================================================
// PLAYER ACTIONS
// ============================================================
function actionAddPlayer(body) {
  const { name, pin } = body;
  if (!name || !pin)         throw new Error('Name and PIN required.');
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits.');
  const players = getPlayers();
  if (players.find(p => p.name.toLowerCase() === name.trim().toLowerCase()))
    throw new Error('That name is already taken.');
  const id = 'p_' + Date.now();
  getSheet('Players').appendRow([id, name.trim(), pin]);
  return { id, name: name.trim() };
}

function actionSubmitPicks(body) {
  const { playerId, pin, picks } = body;
  if (!playerId || !pin || !picks) throw new Error('Missing fields.');
  const player = getPlayerById(playerId);
  if (!player)            throw new Error('Player not found.');
  if (player.pin !== pin) throw new Error('Incorrect PIN.');
  const existing = getPicks().filter(pk => pk.playerId === playerId);
  const sheet    = getSheet('Picks');
  picks.forEach(pick => {
    if (existing.find(e => e.seriesId === pick.seriesId)) return;
    const id = 'pk_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    sheet.appendRow([id, playerId, pick.seriesId, pick.team, pick.games||'', new Date().toISOString()]);
  });
  return { ok: true };
}

// ============================================================
// ADMIN ACTIONS
// ============================================================
function requireAdmin(body) {
  if (body.adminPassword !== ADMIN_PASSWORD) throw new Error('Wrong admin password.');
}
function actionAdminSetOdds(body) {
  requireAdmin(body);
  const { seriesId, odds1, odds2 } = body;
  if (!seriesId || odds1 == null || odds2 == null) throw new Error('Missing fields.');
  const so = getSheet('SeriesOdds'), data = so.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === seriesId) {
      so.getRange(i+1,2).setValue(parseInt(odds1));
      so.getRange(i+1,3).setValue(parseInt(odds2));
      return { ok:true };
    }
  }
  so.appendRow([seriesId, parseInt(odds1), parseInt(odds2)]);
  return { ok:true };
}
function actionAdminResetPin(body)     { requireAdmin(body); updatePlayerRow(body.playerId, { pin: body.newPin }); return { ok:true }; }
function actionAdminRemovePlayer(body) {
  requireAdmin(body);
  const { playerId } = body;
  const ps = getSheet('Players'), pData = ps.getDataRange().getValues();
  for (let i = pData.length-1; i >= 1; i--) if (String(pData[i][0]) === playerId) { ps.deleteRow(i+1); break; }
  const pks = getSheet('Picks'), pkData = pks.getDataRange().getValues();
  for (let i = pkData.length-1; i >= 1; i--) if (String(pkData[i][1]) === playerId) pks.deleteRow(i+1);
  return { ok:true };
}
function actionAdminAddPlayer(body) {
  requireAdmin(body);
  return actionAddPlayer({ name: body.name, pin: (body.pin && /^\d{4}$/.test(body.pin)) ? body.pin : '0000' });
}
function actionAdminDeletePick(body) {
  requireAdmin(body);
  const { playerId, seriesId } = body;
  if (!playerId || !seriesId) throw new Error('Missing fields.');
  const pks = getSheet('Picks'), pkData = pks.getDataRange().getValues();
  for (let i = pkData.length-1; i >= 1; i--) {
    if (String(pkData[i][1]) === playerId && String(pkData[i][2]) === seriesId) {
      pks.deleteRow(i+1);
      return { ok:true };
    }
  }
  throw new Error('Pick not found.');
}

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" not found. Run initSheet() first.');
  return sheet;
}
function getPlayers() {
  const ps = getSheet('Players');
  if (ps.getLastRow() < 2) return [];
  return ps.getDataRange().getValues().slice(1).filter(r => r[0])
    .map(r => ({ id:String(r[0]), name:String(r[1]), pin:String(r[2]) }));
}
function getPlayerById(id) { return getPlayers().find(p => p.id === id) || null; }
function getPicks() {
  const pks = getSheet('Picks');
  if (pks.getLastRow() < 2) return [];
  return pks.getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({
    id:String(r[0]), playerId:String(r[1]), seriesId:String(r[2]),
    team:String(r[3]), games:r[4]?parseInt(r[4]):null, date:String(r[5])
  }));
}
function getSeriesOdds() {
  const so = getSheet('SeriesOdds');
  if (so.getLastRow() < 2) return [];
  return so.getDataRange().getValues().slice(1).filter(r => r[0])
    .map(r => ({ seriesId:String(r[0]), odds1:parseInt(r[1]), odds2:parseInt(r[2]) }));
}
const PLAYER_COLS = { id:1, name:2, pin:3 };
function updatePlayerRow(playerId, fields) {
  const ps = getSheet('Players'), data = ps.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === playerId) {
      Object.entries(fields).forEach(([key, val]) => {
        const col = PLAYER_COLS[key];
        if (col) ps.getRange(i+1, col).setValue(val);
      });
      return;
    }
  }
  throw new Error('Player not found: ' + playerId);
}

// ============================================================
// AUTO UPDATE WINS — nightly trigger
//
// Fetches all STATUS_FINAL playoff games from ESPN across the
// full window and writes win counts to SeriesWins.
//
// Builds a dynamic series ID map that includes later-round
// matchups derived from completed series so ESPN results are
// matched to the correct bracket slot automatically across
// all four rounds — no manual updates needed.
//
// SET UP: Triggers > Add Trigger
//   Function: autoUpdateWins | Time-driven | Day timer | 1am–2am
// ============================================================
function autoUpdateWins() {
  try {
    const resultsMap = getSeriesResultsMap();

    // Build dynamic ID map: R1 base + later rounds from known winners
    const dynamicMap = Object.assign({}, SERIES_ID_MAP_BASE);
    BRACKET_SLOTS.filter(sl => sl.round > 1).forEach(sl => {
      const r1 = resultsMap[sl.src1];
      const r2 = resultsMap[sl.src2];
      if (!r1 || !r2) return;
      const a1 = normalizeAbbrev(r1.winnerAbbrev);
      const a2 = normalizeAbbrev(r2.winnerAbbrev);
      if (!a1 || !a2) return;
      const k1 = [a1,a2].sort().join('_');
      const k2 = [a2,a1].sort().join('_');
      dynamicMap[k1] = sl.id;
      dynamicMap[k2] = sl.id;
      Logger.log('dynamicMap: ' + k1 + ' -> ' + sl.id);
    });

    // Build seriesMap: which abbrevs correspond to t1/t2 for each slot
    const seriesMap = {};
    Object.entries(R1_TEAMS).forEach(([sid, t]) => {
      seriesMap[sid] = { t1abbrev:t.team1.abbrev, t2abbrev:t.team2.abbrev, t1wins:0, t2wins:0 };
    });
    BRACKET_SLOTS.filter(sl => sl.round > 1).forEach(sl => {
      const r1 = resultsMap[sl.src1];
      const r2 = resultsMap[sl.src2];
      if (!r1 || !r2) return;
      seriesMap[sl.id] = {
        t1abbrev: normalizeAbbrev(r1.winnerAbbrev),
        t2abbrev: normalizeAbbrev(r2.winnerAbbrev),
        t1wins:0, t2wins:0
      };
    });

    // Fetch full playoff scoreboard
    const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
              + '?seasontype=3&limit=200&dates=' + PLAYOFFS_START + '-' + PLAYOFFS_END;
    const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    (data.events || []).forEach(event => {
      const comp = (event.competitions || [])[0];
      if (!comp) return;
      if (comp.status?.type?.name !== 'STATUS_FINAL') return;

      const competitors = comp.competitors || [];
      if (competitors.length < 2) return;

      const teams = competitors.map(c => ({
        abbrev: normalizeAbbrev(c.team?.abbreviation || ''),
        winner: c.winner || false
      }));

      const sortedKey = [teams[0].abbrev, teams[1].abbrev].sort().join('_');
      const stableId  = dynamicMap[sortedKey];
      if (!stableId || !seriesMap[stableId]) return;

      const sm = seriesMap[stableId];
      teams.forEach(t => {
        if (!t.winner) return;
        if (t.abbrev === sm.t1abbrev)      sm.t1wins++;
        else if (t.abbrev === sm.t2abbrev) sm.t2wins++;
      });
    });

    // Write to sheet
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SeriesWins');
    if (!sh) { Logger.log('autoUpdateWins: SeriesWins sheet not found.'); return; }
    const rows = sh.getDataRange().getValues();
    let updated = 0;

    for (let i = 1; i < rows.length; i++) {
      const sid = String(rows[i][0]);
      const sm  = seriesMap[sid];
      if (!sm) continue;
      if (sm.t1wins === 0 && sm.t2wins === 0) continue; // not started

      const cur1 = parseInt(rows[i][1])||0;
      const cur2 = parseInt(rows[i][2])||0;

      if (sm.t1wins !== cur1 || sm.t2wins !== cur2) {
        sh.getRange(i+1, 2).setValue(sm.t1wins);
        sh.getRange(i+1, 3).setValue(sm.t2wins);
        Logger.log('autoUpdateWins: updated ' + sid + ' ' + cur1+'-'+cur2 + ' -> ' + sm.t1wins+'-'+sm.t2wins);
        updated++;
      }
    }

    Logger.log('autoUpdateWins done. Updated: ' + updated);
  } catch(e) {
    Logger.log('autoUpdateWins error: ' + e);
  }
}

// ============================================================
// MIGRATION UTILITY — run once manually if needed
// ============================================================
function migratePickIds() {
  const allMigration = {
    'e1':'e1','e2':'e2','e3':'e3','e4':'e4','w1':'w1','w2':'w2','w3':'w3','w4':'w4',
    'DET_ORL':'e1','ORL_DET':'e1','BOS_PHI':'e2','PHI_BOS':'e2',
    'ATL_NY':'e3','ATL_NYK':'e3','NY_ATL':'e3','NYK_ATL':'e3',
    'CLE_TOR':'e4','TOR_CLE':'e4','OKC_PHX':'w1','PHX_OKC':'w1',
    'POR_SA':'w2','POR_SAS':'w2','SA_POR':'w2','SAS_POR':'w2',
    'DEN_MIN':'w3','MIN_DEN':'w3','HOU_LAL':'w4','LAL_HOU':'w4',
  };
  let pm=0, om=0, rm=0;
  [['Picks',2],['SeriesOdds',0],['SeriesResults',0]].forEach(([name, col]) => {
    const sh = getSheet(name), data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const oldId = String(data[i][col]), newId = allMigration[oldId];
      if (newId && newId !== oldId) {
        sh.getRange(i+1, col+1).setValue(newId);
        if (name==='Picks') pm++; else if (name==='SeriesOdds') om++; else rm++;
      }
    }
  });
  Logger.log('Migration: Picks=' + pm + ' Odds=' + om + ' Results=' + rm);
}

// ============================================================
// SHEET BACKUP — daily JSON snapshot to Drive
//
// Snapshots every sheet (Players, Picks, SeriesOdds, SeriesResults,
// SeriesWins) as a JSON file in a "NBA Pool Backups" folder on Drive.
// Pruned to the most recent BACKUP_KEEP_COUNT files.
//
// SETUP (run once each, in this order, from the Apps Script editor):
//   1. backupToDrive()         — first run authorizes the Drive scope
//                                and produces an initial backup file
//   2. installBackupTrigger()  — schedules a daily run at 3am Phoenix
//
// Restore is intentionally manual. Open the JSON, copy the relevant
// sheet's array-of-arrays, and paste back into the sheet by hand. An
// auto-restore is more likely to make a bad day worse than to help.
// ============================================================

const BACKUP_FOLDER_NAME = 'NBA Pool Backups';
const BACKUP_KEEP_COUNT  = 30;
const BACKUP_SHEETS      = ['Players', 'Picks', 'SeriesOdds', 'SeriesResults', 'SeriesWins'];

function backupToDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = {
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    backupAt: new Date().toISOString(),
    schemaVersion: 1,
    sheets: {}
  };

  BACKUP_SHEETS.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) { Logger.log('Sheet missing, skipped: ' + name); return; }
    data.sheets[name] = sh.getDataRange().getValues();
  });

  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);

  const dateStr  = Utilities.formatDate(new Date(), 'America/Phoenix', 'yyyy-MM-dd_HHmm');
  const filename = 'nba-pool-backup_' + dateStr + '.json';
  const file     = folder.createFile(filename, JSON.stringify(data, null, 2), 'application/json');
  Logger.log('Wrote: ' + filename + ' (' + file.getSize() + ' bytes)');

  const candidates = [];
  const it = folder.getFilesByType('application/json');
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('nba-pool-backup_') === 0) {
      candidates.push({ file: f, created: f.getDateCreated() });
    }
  }
  candidates.sort((a, b) => b.created - a.created);
  let pruned = 0;
  candidates.slice(BACKUP_KEEP_COUNT).forEach(c => { c.file.setTrashed(true); pruned++; });
  Logger.log('Kept: ' + Math.min(candidates.length, BACKUP_KEEP_COUNT) + ', pruned: ' + pruned);

  return { ok: true, filename: filename, kept: Math.min(candidates.length, BACKUP_KEEP_COUNT), pruned: pruned };
}

function installBackupTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'backupToDrive')
    .forEach(t => { ScriptApp.deleteTrigger(t); removed++; });

  ScriptApp.newTrigger('backupToDrive')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone('America/Phoenix')
    .create();

  const msg = 'Backup trigger installed: daily at 3am Phoenix'
    + (removed ? ' (removed ' + removed + ' previous trigger(s))' : '');
  Logger.log(msg);
  return msg;
}
