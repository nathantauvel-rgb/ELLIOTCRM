// Script de génération des données CRM depuis les fichiers CSV
const fs = require('fs');
const path = require('path');

const DOWNLOADS = path.join(process.env.USERPROFILE || 'C:/Users/natha', 'Downloads');

// ── HELPERS ──────────────────────────────────────────────
function readCSV(filename) {
  const filePath = path.join(DOWNLOADS, filename);
  try {
    return fs.readFileSync(filePath, 'latin1')
      .split('\n')
      .map(l => l.replace(/\r/g, '').split(';').map(c => c.trim().replace(/^"|"$/g, '')));
  } catch(e) {
    console.error('Impossible de lire:', filename, e.message);
    return [];
  }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 4);
}

function extractEmail(str) {
  const m = str.match(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

function extractPhone(str) {
  const m = str.match(/(?:0|\+33\s?)[0-9][\s.\-]?(?:[0-9]{2}[\s.\-]?){4}/);
  return m ? m[0].replace(/[\s.-]/g, ' ').trim() : '';
}

function normalizeStatus(col2, col3, col4) {
  const all = [col2, col3, col4].join(' ').toLowerCase();
  const s4 = col4.toLowerCase().trim();
  const s2 = col2.toLowerCase().trim();

  // Aurélie → skip (handled outside)
  if (/aur[ée]lie/i.test(all)) return '__skip__';

  // Signed
  if (/contrat sign[ée]|^oui$|partenaire confirm/i.test(all)) return 'signe';

  // RDV fixé
  if (/rdv (le |mercredi|jeudi|vendredi|lundi|mardi|\d)/i.test(all)) return 'rdv_fixe';

  // Offre envoyée
  if (/j'ai envoy[ée]|envoy[ée] (l'offre|la plaquette|offre de partenariat)|envoi plaquette/i.test(all)) return 'offre_envoyee';

  // Saison prochaine
  if (/saison pro|saison prochaine|revenir (en |pour la saison|vers mars|vers f[ée]vrier|en janvier|en mai)/i.test(all)) return 'saison_pro';

  // Perdu - col4 has "X" or clear refusal
  if (/^x$/.test(s4)) return 'perdu';
  if (/^x\s+(ne font pas|de budget|concurrent|pas int[ée]ress|pas la mm|ferm[ée]|n'existe|d[ée]finitivement|si[èe]ge|loi|interdit)/i.test(s4)) return 'perdu';
  if (/^(ferm[ée]|n'existe plus|d[ée]finitivement ferm)/i.test(s4)) return 'perdu';
  // col2 has explicit refusal text
  if (/^x\s+(ne font pas|de budget|concurrent|pas int[ée]ress|ferm[ée]|n'existe|loi|interdit)/i.test(s2)) return 'perdu';

  // Contacté - visited (X alone in type col), or has email/phone noted, or "rappeler"
  if (/^x$/.test(s2)) return 'contacte';
  if (/rappeler|recontacter|relance|donn[ée] ma carte|laiss[ée] ma carte|a pris (mes coord|mon num)|transmis|transmet/i.test(all)) return 'contacte';
  if (/pas de r[ée]ponse|pas dispo|ne r[ée]pond pas/i.test(all)) return 'contacte';

  // Has contact info = was visited
  if (extractEmail(all) || extractPhone(all)) return 'contacte';

  return 'a_contacter';
}

function skipRow(name, col2, col4, all) {
  if (!name || name.length < 2) return true;
  // Section headers / empty
  if (/^(semaine|jeudi|vendredi|lundi|mardi|mercredi|samedi|dimanche|suite|parc d|zone de|vdr\s*:|rouen\/|oissel|sous-total|technopole|entreprise zone|loisirs|salle de|t[ée]l[ée]communications|partenaires du r)/i.test(name)) return true;
  // Aurélie entries
  if (/aur[ée]lie dessus|d[ée]j[àa] dessus/i.test(all)) return true;
  return false;
}

const companies = [];
const seen = new Set();

function addCompany(obj) {
  const key = obj.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (seen.has(key)) return;
  seen.add(key);
  companies.push({ id: genId(), ...obj });
}

// ── PARSE: Contrats signés ──────────────────────────────
console.log('\n📂 Lecture Contrats signés...');
const signed = readCSV('Contrat signé(Feuil1).csv');
const signedByName = {};

for (let i = 1; i < signed.length; i++) {
  const row = signed[i];
  const name = row[0]?.trim();
  if (!name || name.length < 2) continue;

  const dateStr = row[1] || '';
  const sector  = row[2] || '';
  const offer   = row[3] || '';
  const amount  = parseFloat(row[4]) || 0;

  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!signedByName[key]) {
    signedByName[key] = { name, sector, offers: [], totalAmount: 0, dates: [] };
  }
  signedByName[key].offers.push({ offer, amount, date: dateStr });
  signedByName[key].totalAmount += amount;
  if (dateStr) signedByName[key].dates.push(dateStr);
}

for (const key of Object.keys(signedByName)) {
  const s = signedByName[key];
  const p = { led: 0, led_d: '', vip: 0, vip_d: '', bodega: 0, bodega_d: '', bache: 0, bache_d: '', autre: 0 };
  const details = [];

  for (const o of s.offers) {
    const ol = o.offer.toLowerCase();
    if (/led|visibilit[ée]/.test(ol))      { p.led += o.amount; details.push(o.offer); p.led_d = o.offer; }
    else if (/vip/.test(ol))               { p.vip += o.amount; details.push(o.offer); p.vip_d = (p.vip_d ? p.vip_d + ' + ' : '') + o.offer; }
    else if (/bodega/.test(ol))            { p.bodega += o.amount; details.push(o.offer); p.bodega_d = (p.bodega_d ? p.bodega_d + ' + ' : '') + o.offer; }
    else if (/b[âa]che|panneau/.test(ol)) { p.bache += o.amount; details.push(o.offer); p.bache_d = o.offer; }
    else                                   { p.autre += o.amount; details.push(o.offer); }
  }

  const history = s.offers.map(o => ({
    date: parseDate(o.date) || new Date().toISOString(),
    type: 'note',
    note: `Contrat signé — ${o.offer} — ${o.amount} €`
  }));

  addCompany({
    name: s.name, status: 'signe', saison: '2025-2026', source: '',
    info: { sector: s.sector, size: '', zone: '', address: '', notes: '' },
    contact: { name: '', role: '', phone: '', email: '' },
    partnership: p,
    history,
    createdAt: new Date().toISOString()
  });
}

console.log(`  ✅ ${Object.keys(signedByName).length} contrats signés`);

function parseDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`).toISOString();
  return null;
}

// ── PARSE: Prospect vu le Terrain ─────────────────────
console.log('\n📂 Lecture Prospects Terrain...');
const terrain = readCSV('Prospect vu le Terrain(Feuil1).csv');
let terrainCount = 0;

// Current section/zone tracker
let currentZone = 'Rouen Centre';
const zonePatterns = [
  [/tourville/i, 'Tourville'],
  [/mont[- ]st[- ]aignan|mont saint aignan/i, 'Mont-Saint-Aignan'],
  [/maromme/i, 'Maromme'],
  [/barentin/i, 'Autre'],
  [/petit[- ]quevilly/i, 'Petit-Quevilly'],
  [/grand[- ]quevilly/i, 'Grand-Quevilly'],
  [/sotteville/i, 'Sotteville'],
  [/technopole|madrillet/i, 'Technopôle'],
  [/oissel|poudrerie/i, 'Autre'],
];

for (let i = 1; i < terrain.length; i++) {
  const row = terrain[i];
  // row[0] is empty (leading ;), name is row[1]
  const name   = row[1]?.trim() || '';
  const col2   = row[2]?.trim() || '';  // Type / note
  const col3   = row[3]?.trim() || '';  // Sector
  const col4   = row[4]?.trim() || '';  // Statut
  const col6   = row[6]?.trim() || '';  // Contact email/phone
  const col7   = row[7]?.trim() || '';  // Address

  // Detect zone from section headers
  for (const [pat, zone] of zonePatterns) {
    if (pat.test(name) && name.length < 40) { currentZone = zone; break; }
  }
  if (/vendredi|jeudi|lundi|mardi|mercredi|octobre|novembre|janvier|f[ée]vrier|mars|avril|semaine|parc d|suite/i.test(name) && name.length < 60) continue;

  const all = [name, col2, col3, col4, col6, col7].join(' ');
  if (skipRow(name, col2, col4, all)) continue;

  const status = normalizeStatus(col2, col3, col4);
  if (status === '__skip__') continue;

  const email = extractEmail(col6) || extractEmail(col2) || extractEmail(col4);
  const phone = extractPhone(col6) || extractPhone(col2) || extractPhone(col4);
  const note  = [col2, col4].filter(Boolean).join(' — ') || '';
  const raison = /perdu|^x/.test(status) ? (col2 || col4).slice(0, 100) : '';

  addCompany({
    name, status, saison: '2025-2026', source: 'terrain',
    raison_refus: raison,
    info: { sector: col3 || '', size: '', zone: currentZone, address: col7, notes: note },
    contact: { name: '', role: '', phone, email },
    partnership: { led: 0, vip: 0, bodega: 0, bache: 0, autre: 0 },
    history: note ? [{ date: new Date().toISOString(), type: 'note', note }] : [],
    createdAt: new Date().toISOString()
  });
  terrainCount++;
}
console.log(`  ✅ ${terrainCount} prospects terrain`);

// ── PARSE: Téléphone Prospect ─────────────────────────
console.log('\n📂 Lecture Prospects Téléphone...');
const tel = readCSV('Telephone Prospect(Feuil1).csv');
let telCount = 0;
let telZone = 'Rouen Centre';

for (let i = 1; i < tel.length; i++) {
  const row = tel[i];
  const name   = row[0]?.trim() || '';
  const col2   = row[1]?.trim() || '';  // type
  const sector = row[2]?.trim() || '';
  const col3   = row[3]?.trim() || '';  // niveau / note
  const col4   = row[4]?.trim() || '';  // statut
  const phone  = row[6]?.trim() || '';  // phone
  const addr   = row[7]?.trim() || '';

  // Zone detection from section headers
  for (const [pat, zone] of zonePatterns) {
    if (pat.test(name) && name.length < 60) { telZone = zone; break; }
  }
  if (/semaine|jeudi|vendredi|lundi|mardi|mercredi|octobre|novembre|janvier|f[ée]vrier|mars|loisirs|salle de|t[ée]l[ée]com|partenaires du r|entreprise zone/i.test(name) && name.length < 80) continue;

  const all = [name, col2, col3, col4, phone, addr].join(' ');
  if (skipRow(name, col3, col4, all)) continue;

  const status = normalizeStatus(col3, col2, col4);
  if (status === '__skip__') continue;

  const email = extractEmail(col3) || extractEmail(col4);
  const ph    = extractPhone(phone) || extractPhone(col3) || extractPhone(col4);
  const note  = [col3, col4].filter(Boolean).join(' — ') || '';
  const raison = status === 'perdu' ? (col3 || col4).slice(0, 100) : '';

  addCompany({
    name, status, saison: '2025-2026', source: 'téléphone',
    raison_refus: raison,
    info: { sector, size: '', zone: telZone, address: addr, notes: note },
    contact: { name: '', role: '', phone: ph, email },
    partnership: { led: 0, vip: 0, bodega: 0, bache: 0, autre: 0 },
    history: note ? [{ date: new Date().toISOString(), type: 'note', note }] : [],
    createdAt: new Date().toISOString()
  });
  telCount++;
}
console.log(`  ✅ ${telCount} prospects téléphone`);

// ── WRITE OUTPUT ──────────────────────────────────────
const output = `// Données CRM générées automatiquement — ${new Date().toLocaleString('fr-FR')}
// ${companies.length} entreprises importées depuis vos fichiers CSV
window.CRM_INITIAL_DATA = ${JSON.stringify(companies, null, 2)};
`;

const outPath = path.join(__dirname, 'initial-data.js');
fs.writeFileSync(outPath, output, 'utf8');

const signed_count   = companies.filter(c => c.status === 'signe').length;
const contact_count  = companies.filter(c => c.status === 'contacte').length;
const offre_count    = companies.filter(c => c.status === 'offre_envoyee').length;
const rdv_count      = companies.filter(c => c.status === 'rdv_fixe').length;
const saison_count   = companies.filter(c => c.status === 'saison_pro').length;
const perdu_count    = companies.filter(c => c.status === 'perdu').length;
const acontact_count = companies.filter(c => c.status === 'a_contacter').length;

console.log(`
✅ Fichier généré : initial-data.js
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total entreprises : ${companies.length}
  ✓ Signés          : ${signed_count}
  ● RDV fixé        : ${rdv_count}
  ● Offre envoyée   : ${offre_count}
  ● Contacté        : ${contact_count}
  ● À contacter     : ${acontact_count}
  ◌ Saison pro      : ${saison_count}
  ✗ Perdu           : ${perdu_count}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
