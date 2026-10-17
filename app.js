import { firebaseConfig } from './firebase-config.js';
const DEMO = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('YOUR_');
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
let fb = null, user = null, data = { rosters: [] };
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); };

// ---------- Templates ----------
const F = (label, type = 'text', extra = {}) => ({ id: uid(), label, type, ...extra });
const TEMPLATES = {
  dating: { name: 'Dating', emoji: '💘', blurb: 'Your dating roster: photos, socials, first-date ratings, vibes, and friend feedback.',
    fields: () => [F('LinkedIn', 'text', { link: 1 }), F('Facebook', 'text', { link: 1 }), F('Instagram', 'text', { link: 1 }),
      F('Seen on a dating app', 'checkbox'), F('Which app', 'select', { options: ['Hinge', 'Bumble', 'Tinder', 'Raya', 'The League', 'Coffee Meets Bagel', 'Other'] }),
      F('Where we met', 'text'), F('First date', 'date'), F('How was the first date', 'rating'), F('First date notes', 'notes'), F('Notes', 'notes')],
    prefs: ['Height', 'Arms', 'Abs', 'Hair', 'Face', 'Overall looks', 'Clothing / style', 'Smell', 'Vibe'] },
  sports: { name: 'Sports Team', emoji: '🏀', blurb: 'Track players, positions, skill, and who can make game day.',
    fields: () => [F('Sport', 'select', { options: ['Soccer', 'Basketball', 'Baseball', 'Softball', 'Football', 'Volleyball', 'Hockey', 'Pickleball', 'Tennis', 'Other'] }),
      F('Position', 'text'), F('Skill level', 'select', { options: ['Beginner', 'Intermediate', 'Advanced', 'Elite'] }),
      F('Availability', 'text'), F('Jersey number', 'text'), F('Contact', 'text'), F('Notes', 'notes')] },
  friends: { name: 'Friends', emoji: '🫶', blurb: 'Remember birthdays, interests, and when you last hung out.',
    fields: () => [F('How we met', 'text'), F('Birthday', 'date'), F('Interests', 'text'), F('Last hangout', 'date'), F('Notes', 'notes')] },
  babysitters: { name: 'Babysitters', emoji: '🧸', blurb: 'Compare sitters by ages, certifications, rate, and references.',
    fields: () => [F('Infant OK', 'checkbox'), F('Toddler OK', 'checkbox'), F('School-age OK', 'checkbox'), F('Teen OK', 'checkbox'),
      F('Experience', 'notes'), F('CPR certified', 'checkbox'), F('First aid certified', 'checkbox'), F('Rate ($/hr)', 'text'),
      F('Availability', 'text'), F('References', 'notes'), F('Drives / has car', 'checkbox'), F('Rating', 'rating'), F('Notes', 'notes')] },
  custom: { name: 'Custom', emoji: '✨', blurb: 'Start blank and add whatever fields you want.', fields: () => [F('Notes', 'notes')] },
};
const FIELD_TYPES = ['text', 'notes', 'select', 'rating', 'checkbox', 'date'];

// ---------- Storage ----------
const LS = 'theroster_v1', LSS = 'theroster_shares';
// Migrate renamed categories (Stomach -> Abs), keeping saved votes
const RENAME = { Stomach: 'Abs' };
function migrate() {
  data.settings = Object.assign({ activeId: null, lastUsedId: null, defaultId: null, remember: false }, data.settings || {});

  const rk = o => { if (!o) return; for (const [a, b] of Object.entries(RENAME)) if (a in o) { if (!(b in o)) o[b] = o[a]; delete o[a]; } };
  for (const r of data.rosters || []) { for (const p of r.people || []) { p.status = p.status || 'active'; p.history = p.history || [{ at: p.addedAt || Date.now(), from: null, to: p.status }]; p.addedAt = p.addedAt || Date.now(); p.rankHist = p.rankHist || []; } if (r.type === 'dating' && r.prefs && !r.prefs.includes('Height')) r.prefs.unshift('Height'); if (!r.placed) { r.placed = 1; (r.people || []).filter(p => stOf(p) === 'active').sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9)).forEach((p, i) => p.place = i < 3 ? i + 1 : null); } if (r.people) renumber(r); if (r.prefs) r.prefs = r.prefs.map(k => RENAME[k] || k); for (const p of r.people || []) { rk(p.prefs); (p.feedback || []).forEach(f => rk(f.votes)); } }
}
async function load() {
  if (DEMO) { data = JSON.parse(localStorage.getItem(LS) || '{"rosters":[]}'); migrate(); return; }
  const s = await fb.getDoc(fb.doc(fb.db, 'users', user.uid));
  data = s.exists() ? JSON.parse(s.data().json || '{"rosters":[]}') : { rosters: [] };
  migrate();
  await pullFeedback();
}
let saveT;
function save() {
  if (DEMO) { localStorage.setItem(LS, JSON.stringify(data)); return; }
  clearTimeout(saveT);
  saveT = setTimeout(() => fb.setDoc(fb.doc(fb.db, 'users', user.uid), { json: JSON.stringify(data), updatedAt: Date.now() }).catch(e => toast('Save failed: ' + e.message)), 400);
}
const demoShares = () => JSON.parse(localStorage.getItem(LSS) || '{}');
async function createShare(rosterId, personId, card) {
  const code = uid() + uid();
  if (DEMO) { const s = demoShares(); s[code] = { ownerUid: 'demo', rosterId, personId, card, feedback: [] }; localStorage.setItem(LSS, JSON.stringify(s)); }
  else await fb.setDoc(fb.doc(fb.db, 'shares', code), { ownerUid: user.uid, rosterId, personId, card, createdAt: Date.now() });
  return code;
}
async function getShare(code) {
  if (DEMO) return demoShares()[code] || null;
  const s = await fb.getDoc(fb.doc(fb.db, 'shares', code)); return s.exists() ? s.data() : null;
}
async function sendFeedback(code, fbk) {
  if (DEMO) { const s = demoShares(); s[code].feedback.push(fbk); localStorage.setItem(LSS, JSON.stringify(s)); return; }
  await fb.addDoc(fb.collection(fb.db, 'shares', code, 'feedback'), fbk);
}
// Merge friend feedback into owner's people
async function pullFeedback() {
  for (const r of data.rosters) for (const p of r.people) for (const code of (p.shares || [])) {
    let list = [];
    if (DEMO) list = demoShares()[code]?.feedback || [];
    else { try { const q = await fb.getDocs(fb.collection(fb.db, 'shares', code, 'feedback')); list = q.docs.map(d => ({ ...d.data(), _id: d.id })); } catch (e) { } }
    p.feedback = p.feedback || [];
    for (const f of list) { const k = f._id || (f.at + f.from); if (!p.feedback.some(x => x.k === k)) p.feedback.push({ ...f, k }); }
  }
  migrate();
}

// ---------- Auth ----------
async function initFirebase() {
  const [{ initializeApp }, A, S] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  const app = initializeApp(firebaseConfig);
  fb = { ...A, ...S, auth: A.getAuth(app), db: S.getFirestore(app) };
  return new Promise(res => A.onAuthStateChanged(fb.auth, async u => { user = u; if (u) await load(); res(); route(); }));
}
async function signIn(provider) {
  if (DEMO) { user = { uid: 'demo', displayName: 'Demo user (' + provider + ')' }; sessionStorage.setItem('demoUser', provider); await load(); location.hash = '#home'; route(); return; }
  const p = provider === 'google' ? new fb.GoogleAuthProvider() : new fb.OAuthProvider('apple.com');
  if (provider === 'apple') { p.addScope('email'); p.addScope('name'); }
  try { await fb.signInWithPopup(fb.auth, p); location.hash = '#home'; } catch (e) { toast(e.code || e.message); }
}
async function signOut() { if (DEMO) { sessionStorage.removeItem('demoUser'); user = null; } else await fb.signOut(fb.auth); location.hash = ''; route(); }

// ---------- Views ----------
const activeRoster = () => data.rosters.find(r => r.id === data.settings?.activeId) || data.rosters.find(r => r.id === data.settings?.lastUsedId) || data.rosters[0] || null;
function setActive(id, silent) {
  if (!data.rosters.some(r => r.id === id)) return;
  data.settings = data.settings || {}; data.settings.activeId = id; data.settings.lastUsedId = id; save();
}
function switcherHTML(active) {
  if (!user || !active) return '';
  const t = TEMPLATES[active.type] || TEMPLATES.custom;
  return `<div class="swrow"><button id="swBtn" class="swpill" aria-haspopup="true" aria-expanded="false"><span class="swic">${t.emoji}</span><span class="swtxt"><b>${esc(active.name)}</b><small>${esc(t.name)} · ${active.people.length} people</small></span><span class="swchev">▾</span></button>
  <div id="swMenu" class="swmenu" hidden>
    <div class="swmh">Switch roster</div>
    ${data.rosters.map(r => { const rt = TEMPLATES[r.type] || TEMPLATES.custom; return `<button class="switem ${r.id === active.id ? 'on' : ''}" data-sw="${r.id}"><span>${rt.emoji}</span><span class="swtxt"><b>${esc(r.name)}</b><small>${esc(rt.name)} · ${r.people.length} people</small></span>${r.id === active.id ? '<em>●</em>' : ''}</button>`; }).join('')}
    <div class="swdiv"></div>
    <button class="switem" data-swnew="1"><span>✦</span><span class="swtxt"><b>New roster…</b><small>Create from a template</small></span></button>
    <a class="switem" href="#all"><span>🗂️</span><span class="swtxt"><b>All rosters</b><small>Overview of every roster</small></span></a>
    <a class="switem" href="#settings"><span>⚙️</span><span class="swtxt"><b>Settings</b><small>Default landing roster</small></span></a>
  </div></div>`;
}
const header = (active = null) => `<div class="top"><div class="trow"><div class="logo" onclick="location.hash='${user ? '#home' : ''}'"><span class="moon">☾</span> The <span>Roster</span>${DEMO ? '<span class="badge">DEMO</span>' : ''}</div>
  <div>${user ? `<button class="btn ghost sm" id="out">Sign out</button>` : `<button class="btn sm" onclick="location.hash='#signin'">Sign in</button>`}</div></div>${active ? switcherHTML(active) : ''}</div>`;

function topOne(r) { return [...(r.people || [])].filter(p => stOf(p) === 'active').sort((a, b) => (a.place || 99) - (b.place || 99) || (a.rank || 999) - (b.rank || 999))[0] || null; }
function rosterCard(r, landing) {
  const t = TEMPLATES[r.type] || TEMPLATES.custom, c = { active: 0, penalty: 0, struck: 0, blocked: 0 };
  (r.people || []).forEach(p => c[stOf(p)]++); const one = topOne(r);
  return `<div class="tcard rcard ${landing ? 'landcard' : ''}" data-open="${r.id}" tabindex="0"><div class="em">${t.emoji}</div><h3>${esc(r.name)}</h3><p>${esc(t.name)} · ${r.people.length} people</p>
  <div class="bc" style="margin-top:10px">${one ? `<span>🥇 ${esc(one.name)}</span>` : '<span>No #1 yet</span>'}<span>✦ ${c.active} active</span>${c.penalty ? `<span>⏸ ${c.penalty}</span>` : ''}${c.struck ? `<span>✕ ${c.struck}</span>` : ''}${c.blocked ? `<span>⛔ ${c.blocked}</span>` : ''}</div>
  <div class="mut" style="margin-top:10px">${landing ? 'Tap to land here →' : 'Open board →'}</div></div>`;
}
function viewOverview() {
  return `${header(activeRoster())}<div class="wrap"><div class="row"><h2 class="sp">🗂️ All rosters</h2><span class="mut">Overview only — open one to work inside it</span></div>
  <div class="grid">${data.rosters.map(r => rosterCard(r, false)).join('') || '<p class="mut">No rosters yet — pick a template below.</p>'}</div>
  <h3 style="margin-top:28px">Start a new roster</h3><div class="grid">${Object.entries(TEMPLATES).map(([k, v]) => `<div class="tcard" data-start="${k}"><div class="em">${v.emoji}</div><h3>${v.name}</h3><p>${v.blurb}</p></div>`).join('')}</div></div>`;
}
let landingPick = null;
function viewWelcome() {
  const pick = data.rosters.find(r => r.id === landingPick) || activeRoster();
  return `${header(null)}<div class="wrap"><div class="hero" style="padding-top:28px"><div class="sparkle">✦ ☾ ✦</div><h1 style="font-size:clamp(32px,7vw,48px)">Where do you want to <em>land?</em></h1><p>Pick a roster to enter. Everything inside — board, people, Reports and sharing — stays scoped to that one roster.</p></div>
  <div class="grid">${data.rosters.map(r => `<div class="landwrap ${pick && r.id === pick.id ? 'sel' : ''}">${rosterCard(r, true)}</div>`).join('')}</div>
  <div class="panel landbar"><label class="chk"><input type="checkbox" id="rememberPick" ${data.settings?.remember ? 'checked' : ''}> Remember my choice — land here next time</label>
  <div class="row" style="margin-top:12px"><a class="btn ghost sm" href="#all">All rosters overview</a><span class="sp"></span><button class="btn" id="enterPick" ${pick ? '' : 'disabled'}>Enter ${pick ? esc(pick.name) : 'a roster'} ✦</button></div>
  <p class="mut" style="margin-top:10px">You can change this anytime in Settings. Your last-used roster is always remembered${data.settings?.remember ? ' and used as your landing spot' : ' for the switcher'}.</p></div></div>`;
}
function viewSettings() {
  const st = data.settings || {}, last = data.rosters.find(r => r.id === st.lastUsedId);
  return `${header(activeRoster())}<div class="wrap"><h2>⚙️ Settings</h2>
  <div class="panel"><b>Default landing roster</b><p class="mut">After sign-in, land in this roster when “Remember my choice” is on. Otherwise we ask where you want to land (if you have more than one).</p>
  <label class="f"><span>Landing roster</span><select id="setDefault"><option value="">Last used roster</option>${data.rosters.map(r => `<option value="${r.id}" ${st.defaultId === r.id ? 'selected' : ''}>${esc((TEMPLATES[r.type]?.emoji || '✨') + ' ' + r.name)}</option>`).join('')}</select></label>
  <label class="chk"><input type="checkbox" id="setRemember" ${st.remember ? 'checked' : ''}> Remember my choice — skip the landing prompt</label>
  ${last ? `<p class="mut" style="margin-top:10px">Last used: <b>${esc(last.name)}</b>${activeRoster() ? ` · Currently inside: <b>${esc(activeRoster().name)}</b>` : ''}</p>` : ''}
  <div class="row" style="margin-top:14px"><a class="btn ghost sm" href="#welcome">Change landing choice</a><a class="btn ghost sm" href="#all">All rosters</a>${activeRoster() ? `<a class="btn sm" href="#r/${activeRoster().id}">Back to board</a>` : ''}</div></div>
  <div class="panel"><b>Scope</b><p class="mut">Board, people, Reports (by default) and share links are scoped to the roster shown in the switcher at the top. Use Reports → “All rosters” only when you want a combined view.</p></div></div>`;
}

function viewLanding() {
  const t = TEMPLATES;
  return `${header()}<div class="wrap"><div class="hero"><div class="sparkle">✦ ☾ ✦</div><h1>Build <em>any</em> roster.</h1>
  <p>Dates, teams, friends, babysitters — or anything you can dream up. Rank them, tag them, and ask your friends what they think.</p>
  <button class="btn" onclick="location.hash='${user ? '#home' : '#signin'}'">Get started ✦</button></div>
  <div class="grid">${Object.entries(t).map(([k, v]) => `<div class="tcard ${k === 'dating' ? 'feat' : ''}" data-start="${k}"><div class="em">${v.emoji}</div><h3>${v.name}${k === 'dating' ? ' · Featured' : ''}</h3><p>${v.blurb}</p></div>`).join('')}</div>
  <div class="panel" style="margin-top:24px"><b>🔒 Private by default.</b> <span class="mut">Your roster is saved to your account only. Share a single limited card with a friend to get their take — they never see your rankings or notes.</span></div></div>`;
}
function viewSignin() {
  return `${header()}<div class="wrap"><div class="signin panel"><div class="moonbig">☾</div><h2>Welcome to The Roster</h2><p class="mut">Sign in to save your rosters.</p>
  <button class="btn google" data-signin="google">🟦 Continue with Google</button><button class="btn apple" data-signin="apple"> Continue with Apple</button>
  ${DEMO ? '<p class="mut">Demo mode: Firebase isn\'t configured yet, so either button signs you into a local demo account saved in this browser.</p>' : ''}</div></div>`;
}
function fieldInput(f, v) {
  const n = `data-f="${f.id}"`;
  if (f.type === 'notes') return `<textarea ${n}>${esc(v)}</textarea>`;
  if (f.type === 'checkbox') return `<label class="sw"><input type="checkbox" ${n} ${v ? 'checked' : ''}><i></i><b>${v ? 'Yes' : 'No'}</b></label>`;
  if (f.type === 'date') return `<input type="date" ${n} value="${esc(v)}">`;
  if (f.type === 'select') return `<div class="seg">${(f.options || []).map(o => `<label><input type="radio" name="s_${f.id}" ${n} value="${esc(o)}" ${o === v ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
  if (f.type === 'rating') return `<div class="stars" data-rate="${f.id}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" class="${i <= (v || 0) ? 'on' : ''}">★</button>`).join('')}</div>`;
  return `<input ${n} value="${esc(v)}" placeholder="${f.link ? 'https://…' : ''}">${f.link && v ? ` <a href="${esc(/^https?:/.test(v) ? v : 'https://' + v)}" target="_blank" rel="noopener">open ↗</a>` : ''}`;
}
function viewPerson(r, p) {
  const prefs = r.prefs || [];
  return `${header(r)}<div class="wrap"><div class="row"><a class="back" href="#r/${r.id}">← ${esc(r.name)}</a><span class="sp"></span><button class="btn sm" id="share">🔗 Get feedback</button><button class="btn danger sm" id="delp">Remove</button></div>
  <div class="pgrid"><div class="pane"><div class="panel hero-p"><div class="avatar" style="${p.photos?.[0] ? `background-image:url(${p.photos[0]})` : ''}">${p.photos?.[0] ? '' : esc((p.name || '?')[0])}</div><label class="f"><span>Code name</span><input id="pname" value="${esc(p.name)}" placeholder="e.g. Mr. Tuesday, The Architect"></label><p class="hint">☾ Code names keep things private — skip real names.</p>
  <label class="f"><span>Work / company</span><input id="pwork" value="${esc(p.work || '')}" placeholder="e.g. Architect at a design studio"></label><div class="stpill st-${stOf(p)}">${STATUSES[stOf(p)].ic} ${STATUSES[stOf(p)].l}${stOf(p) === 'active' ? (p.place ? ` · ${PLACES[p.place][0]} ${PLACES[p.place][1]}` : ` · In the pile (#${p.rank})`) : ''}</div>
  ${stOf(p) === 'active' ? `<label class="f"><span>Placement</span></label><div class="seg place-seg">${[1, 2, 3].map(k => `<label><input type="radio" name="pp" value="${k}" ${p.place === k ? 'checked' : ''}><span>${PLACES[k][0]} ${PLACES[k][1]}</span></label>`).join('')}<label><input type="radio" name="pp" value="" ${!p.place ? 'checked' : ''}><span>🗂️ In the pile</span></label></div>` : ''}
  <label class="f"><span>Tags / labels (comma separated — e.g. tall, funny, local)</span><input id="ptags" value="${esc((p.tags || []).join(', '))}"></label><div class="chips">${(p.tags || []).map(t => `<button class="tag chip" data-rmtag="${esc(t)}">#${esc(t)} <i>×</i></button>`).join('')}</div></div>
  <div class="panel"><b>📸 Photos</b><div class="photos" style="margin:10px 0">${(p.photos || []).map((u, i) => `<div style="background-image:url(${u})"><button data-rmph="${i}">×</button></div>`).join('')}</div>
  <input type="file" accept="image/*" multiple id="phup"><p class="mut">${DEMO ? 'Demo mode: photos are resized and stored as data URLs in this browser.' : 'Photos are stored (resized) inside your private roster doc. Firebase Storage-ready: swap to Storage for full-size uploads.'}</p></div></div><div class="pane">
  <div class="panel"><b class="ph2">{ details }</b><div class="kv">${r.fields.map(f => `<label class="f bub ${f.type === 'notes' ? 'wide' : ''}"><span>${esc(f.label)}</span>${fieldInput(f, p.values?.[f.id])}</label>`).join('')}</div></div>
  ${prefs.length ? `<div class="panel"><b>Physical preferences</b><p class="mut">Tap to cycle 👍 yes → meh → 👎 no. Private to you.</p><div class="tcs">${prefs.map(k => tcBtn('data-pref', k, p.prefs?.[k])).join('')}</div></div>` : ''}
  <div class="panel"><b>Status</b><div class="seg" style="margin:10px 0">${Object.entries(STATUSES).map(([k, v]) => `<label><input type="radio" name="pst" data-st="${k}" ${stOf(p) === k ? 'checked' : ''}><span>${v.ic} ${v.l}</span></label>`).join('')}</div>
  ${p.penalty ? `<p class="hint">⏸ ${esc(p.penalty.reason || 'No reason')}${p.penalty.returnBy ? ' · back by ' + fmtD(p.penalty.returnBy + 'T12:00') : ''}</p>` : ''}
  <div class="tl">${[...(p.history || [])].reverse().map(h => `<div class="tli"><i style="background:${SC[h.to]}"></i><div>${h.from ? STATUSES[h.from]?.l + ' → ' : 'Added as '}${STATUSES[h.to]?.l}${h.reason ? ` · “${esc(h.reason)}”` : ''}<div class="mut">${new Date(h.at).toLocaleString()}</div></div></div>`).join('')}</div></div>
  <div class="panel"><div class="row"><b class="sp">💬 Friend feedback</b><button class="btn ghost sm" id="refresh">Refresh</button></div>${(p.feedback || []).map(f => `<div class="fb"><b>${esc(f.from || 'A friend')}</b> ${f.knows ? '· knows them personally' : ''}<div>${Object.entries(f.votes || {}).map(([k, v]) => `<span class="tag">${esc(k)} ${tIcon(v)}</span>`).join('')}</div>${f.comment ? `<div>“${esc(f.comment)}”</div>` : ''}</div>`).join('') || '<p class="mut">No feedback yet. Tap “Get feedback” to share a limited card with a friend.</p>'}</div></div></div>
  <div class="savebar"><span id="sstate" class="${ed?.dirty ? 'dirty' : ''}">${ed?.dirty ? '● Unsaved changes' : '✓ All changes saved'}</span><span class="sp"></span><button class="btn ghost sm" id="pcancel">Cancel</button><button class="btn" id="psave">Save</button></div></div>`;
}
function viewFriend(code, s) {
  if (!s) return `${header()}<div class="wrap"><div class="panel">This share link isn't valid (or, in demo mode, was created in another browser).</div></div>`;
  const c = s.card;
  return `${header()}<div class="wrap" style="max-width:560px"><h2>Your friend wants your take 👀</h2>
  <div class="pcard" style="cursor:default">${c.photo ? `<div class="ph" style="background-image:url(${c.photo})"></div>` : ''}<div class="b"><div class="cn">Code name</div><h3>${esc(c.name)}</h3>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
  ${(c.fields || []).map(f => `<div><span class="mut">${esc(f.label)}:</span> ${esc(f.value === true ? 'Yes' : f.value)}</div>`).join('')}</div></div>
  <div class="panel"><label class="f"><span>Your name (optional)</span><input id="ffrom"></label><label class="chk"><input type="checkbox" id="fknows"> I know this person personally</label>
  <p class="mut">Based on what you know, are they good for your friend?</p><p class="hint">Tap to cycle 👍 yes → meh → 👎 no.</p><div class="tcs">${(c.categories || []).map(k => RENAME[k] || k).map(k => tcBtn('data-fv', k, null)).join('')}</div>
  <label class="f"><span>Comment</span><textarea id="fcom"></textarea></label><button class="btn" id="fsend">Send feedback</button></div></div>`;
}

// ---------- Thumbs (tap-cycle) ----------
const CYCLE = [null, 'up', 'meh', 'down'], nextV = v => CYCLE[(CYCLE.indexOf(v ?? null) + 1) % 4];
const TLBL = { up: 'Yes', meh: 'Meh', down: 'No' };
const tcBtn = (attr, k, v) => `<button type="button" class="tc s-${v || 'none'}" ${attr}="${esc(k)}" aria-label="${esc(k)}: ${TLBL[v] || 'not rated'}"><span class="tl">${esc(k)}</span><span class="ti">👍</span><em>${TLBL[v] || 'Tap'}</em></button>`;
const tIcon = v => `<span class="tmini s-${v}">👍</span>`;
function cycleBtn(b, get, set) { const v = nextV(get()); set(v); b.className = 'tc pop s-' + (v || 'none'); b.querySelector('em').textContent = TLBL[v] || 'Tap'; b.setAttribute('aria-label', b.querySelector('.tl').textContent + ': ' + (TLBL[v] || 'not rated')); }
// ---------- Placement (1st/2nd/3rd/pile) ----------
const PLACES = { 1: ['🥇', '1st'], 2: ['🥈', '2nd'], 3: ['🥉', '3rd'] };
function assignPlace(r, p, k) {
  k = k ? +k : null; if ((p.place || null) === k) return true;
  const holder = k && r.people.find(x => x !== p && x.place === k && stOf(x) === 'active');
  if (holder && !confirm(`${holder.name} is in ${PLACES[k][1]} place. Bump them to the pile?`)) return false;
  if (holder) { holder.place = null; holder.rank = -1; }
  if (!k) p.rank = 0; p.place = k; if (stOf(p) !== 'active') setStatus(r, p, 'active');
  renumber(r); save(); toast(k ? `${PLACES[k][0]} ${p.name} is ${PLACES[k][1]}` : `${p.name} moved to the pile`); return true;
}
// ---------- Status / ranking ----------
const STATUSES = { active: { l: 'Active', ic: '✦' }, penalty: { l: 'Penalty Box', ic: '⏸' }, struck: { l: 'Struck', ic: '✕' }, blocked: { l: 'Blocked', ic: '⛔' } };
const DAY = 864e5, stOf = p => p.status || 'active';
const fmtD = t => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
function renumber(r, at = Date.now()) {
  const act = r.people.filter(p => stOf(p) === 'active'), seen = {};
  act.filter(p => p.place).sort((a, b) => a.place - b.place).forEach(p => { if (seen[p.place]) p.place = null; else seen[p.place] = 1; });
  const top = act.filter(p => p.place).sort((a, b) => a.place - b.place), pile = act.filter(p => !p.place).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (a.addedAt || 0) - (b.addedAt || 0));
  [...top, ...pile].forEach((p, i) => p.rank = i + 1);
  r.people.forEach(p => { if (stOf(p) !== 'active') p.rank = null; p.rankHist = p.rankHist || []; const l = p.rankHist[p.rankHist.length - 1]; if (!l || l.rank !== p.rank) p.rankHist.push({ at, rank: p.rank }); });
}
function setStatus(r, p, to, extra = {}) {
  const from = stOf(p); p.history = p.history || [];
  p.history.push({ at: Date.now(), from, to, ...extra }); p.status = to;
  if (to === 'penalty') p.penalty = { reason: extra.reason || '', returnBy: extra.returnBy || '' }; else delete p.penalty;
  if (to === 'active' && from !== 'active') p.rank = 1e8; if (to !== 'active') p.place = null;
  renumber(r); save();
}
function penaltyModal(r, p) {
  modal(`<h3>⏸ Penalty Box: ${esc(p.name)}</h3><p class="mut">Temporarily off the stack ranking. You can bring them back anytime.</p>
  <label class="f"><span>Reason (optional)</span><input id="pr" placeholder="e.g. Late twice, mixed signals"></label>
  <label class="f"><span>Return by (optional)</span><input type="date" id="pd"></label>
  <div class="row"><span class="sp"></span><button class="btn ghost sm" id="pc">Cancel</button><button class="btn" id="pk">Send to Penalty Box</button></div>`, m => {
    m.querySelector('#pc').onclick = () => m.remove();
    m.querySelector('#pk').onclick = () => { setStatus(r, p, 'penalty', { reason: m.querySelector('#pr').value.trim(), returnBy: m.querySelector('#pd').value }); m.remove(); route(); toast('Sent to the Penalty Box ⏸'); };
  });
}
function placeModal(r, p) {
  modal(`<h3>🏅 Placement: ${esc(p.name)}</h3><p class="mut">Only one person per podium spot. Picking a taken spot bumps them to the pile.</p><div class="seg place-seg">${[1, 2, 3].map(k => `<label><input type="radio" name="pm" value="${k}" ${p.place === k ? 'checked' : ''}><span>${PLACES[k][0]} ${PLACES[k][1]}</span></label>`).join('')}<label><input type="radio" name="pm" value="" ${!p.place ? 'checked' : ''}><span>🗂️ In the pile</span></label></div><div class="row" style="margin-top:14px"><span class="sp"></span><button class="btn ghost sm" id="pmc">Close</button></div>`, m => {
    m.querySelector('#pmc').onclick = () => m.remove();
    m.querySelectorAll('input[name=pm]').forEach(i => i.onchange = () => { if (assignPlace(r, p, i.value)) { m.remove(); route(); } else m.querySelectorAll('input[name=pm]').forEach(x => x.checked = String(p.place || '') === x.value); });
  });
}
const qualities = r => [['manual', 'Overall'], ['thumbs', 'Thumbs score'], ...r.fields.filter(f => f.type === 'rating').map(f => ['f:' + f.id, f.label]), ...(r.prefs || []).map(k => ['p:' + k, k])];
function score(p, q) {
  const t = v => v === 'up' ? 1 : v === 'down' ? -1 : 0; // meh = 0
  if (q === 'thumbs') return Object.values(p.prefs || {}).reduce((s, v) => s + t(v), 0);
  if (q.startsWith('f:')) return +(p.values?.[q.slice(2)] || 0);
  if (q.startsWith('p:')) return t(p.prefs?.[q.slice(2)]);
  return 0;
}
function cardChips(r, p) {
  const c = [], v = p.values || {};
  const appF = r.fields.find(f => /which app/i.test(f.label)), seenF = r.fields.find(f => /dating app/i.test(f.label)), rf = r.fields.find(f => f.type === 'rating');
  if (appF && v[appF.id]) c.push('📱 ' + v[appF.id]); else if (seenF && v[seenF.id]) c.push('📱 On an app');
  if (rf && v[rf.id]) c.push('★ ' + v[rf.id] + '/5');
  (p.tags || []).forEach(t => c.push('#' + t));
  return c.slice(0, 3);
}
function bizCard(r, p, manual) {
  const st = stOf(p), ph = p.photos?.[0], b = (a, ic, l) => `<button data-act="${a}" data-pid="${p.id}" aria-label="${l}" title="${l}">${ic}</button>`;
  const acts = st === 'active' ? b('place', '🏅', 'Set placement') + (manual && !p.place ? b('up', '▲', 'Move up') + b('down', '▼', 'Move down') : '') + b('pen', '⏸', 'Penalty Box') + b('strike', '✕', 'Strike') + b('block', '⛔', 'Block')
    : st === 'penalty' ? b('ret', '↩', 'Return to roster') + b('strike', '✕', 'Strike') + b('block', '⛔', 'Block')
    : st === 'struck' ? b('ret', '↩', 'Restore') + b('block', '⛔', 'Block') : b('ret', '↩', 'Unblock & restore');
  const due = p.penalty?.returnBy, over = due && new Date(due + 'T23:59') < new Date();
  const pl = st === 'active' && p.place;
  return `<div class="biz st-${st} ${pl ? 'place-' + pl : ''}" data-pid="${p.id}">${pl === 1 ? '<div class="crown">♛</div>' : ''}
    ${st === 'active' && manual && !pl ? '<div class="handle" aria-label="Drag to reorder">⋮⋮</div>' : ''}
    <div class="bph" style="${ph ? `background-image:url(${ph})` : ''}">${ph ? '' : esc((p.name || '?')[0])}</div>
    <div class="bi"><div class="bn">${esc(p.name)}</div><div class="bw">${esc(p.work || 'Work / company not set')}</div>
    <div class="bc">${cardChips(r, p).map(c => `<span>${esc(c)}</span>`).join('')}</div>
    ${st === 'penalty' ? `<div class="pen ${over ? 'over' : ''}">⏸ ${esc(p.penalty?.reason || 'No reason given')}${due ? ` · back by ${fmtD(due + 'T12:00')}${over ? ' (overdue)' : ''}` : ''}</div>` : ''}
    </div><div class="qa">${acts}</div>
    <div class="rk ${pl ? 'medal' : ''}">${pl ? PLACES[pl][0] : st === 'active' ? p.rank : STATUSES[st].ic}</div></div>`;
}
let filterTag = null, lane = 'active';
function viewRoster(r) {
  const by = r.rankBy || 'manual', manual = by === 'manual' && !filterTag;
  const tags = [...new Set(r.people.flatMap(p => p.tags || []))].sort();
  const L = s => r.people.filter(p => stOf(p) === s && (!filterTag || (p.tags || []).includes(filterTag)));
  const actAll = L('active'), podium = actAll.filter(p => p.place).sort((a, b) => a.place - b.place);
  const act = actAll.filter(p => !p.place).sort(by === 'manual' ? (a, b) => a.rank - b.rank : (a, b) => score(b, by) - score(a, by) || a.rank - b.rank);
  const col = (s, list, empty) => `<section class="lane lane-${s} ${lane === s ? 'on' : ''}"><h3>${STATUSES[s].ic} ${STATUSES[s].l} <span class="cnt">${s === 'active' ? actAll.length : list.length}</span></h3>
    ${s === 'active' ? `<div class="podium">${[1, 2, 3].map(k => { const q = podium.find(x => x.place === k); return q ? bizCard(r, q, manual) : `<div class="slot place-${k}">${PLACES[k][0]} ${PLACES[k][1]} place is open — tap 🏅 on someone</div>`; }).join('')}</div><div class="pileh">The pile <span class="cnt">${list.length}</span></div>` : ''}
    <div class="stack" ${s === 'active' && manual ? 'id="stack"' : ''}>${list.map(p => bizCard(r, p, manual)).join('') || `<p class="mut empty">${empty}</p>`}</div></section>`;
  const cnt = s => r.people.filter(p => stOf(p) === s).length;
  const ql = qualities(r).find(q => q[0] === by)?.[1] || 'Overall';
  return `${header(r)}<div class="wrap"><div class="row rhead"><h2 class="sp">${TEMPLATES[r.type]?.emoji} ${esc(r.name)}</h2>
  <button class="btn ghost sm" id="fields">⚙️ Fields</button><button class="btn ghost sm" id="rename">Rename</button><button class="btn danger sm" id="delr">Delete</button><button id="addp" hidden></button></div>
  <div class="lanesw seg">${Object.entries(STATUSES).map(([k, v]) => `<label><input type="radio" name="lane" data-lane="${k}" ${lane === k ? 'checked' : ''}><span>${v.ic} ${v.l} <b>${cnt(k)}</b></span></label>`).join('')}</div>
  <div class="rankby"><span class="mut">Rank by</span><div class="seg scroll">${qualities(r).map(([k, l]) => `<label><input type="radio" name="rb" value="${k}" ${k === by ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div></div>
  ${by !== 'manual' ? `<p class="hint">Pile sorted by <b>${esc(ql)}</b> (top three stay pinned). Your manual order is saved; switch to <b>Overall</b> to drag.</p>` : filterTag ? '<p class="hint">Clear the tag filter to drag and reorder.</p>' : '<p class="hint">🏅 Pick your top three. Drag ⋮⋮ or tap ▲▼ to order the pile.</p>'}
  ${tags.length ? `<div class="chips scroll"><span class="tag ${!filterTag ? 'on' : ''}" data-ft="">All</span>${tags.map(t => `<span class="tag ${filterTag === t ? 'on' : ''}" data-ft="${esc(t)}">#${esc(t)}</span>`).join('')}</div>` : ''}
  <div class="board">${col('active', act, 'Nobody active yet. Tap ＋ to add a code name.')}${col('penalty', L('penalty'), 'No one in the Penalty Box.')}${col('struck', L('struck'), 'No one struck.')}${col('blocked', L('blocked'), 'No one blocked.')}</div></div>`;
}
function enableDrag(r, stack) {
  stack.querySelectorAll('.handle').forEach(h => h.onpointerdown = e => {
    e.preventDefault(); const card = h.closest('.biz'); card.classList.add('drag');
    const move = ev => { const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('#stack .biz'); if (over && over !== card) { const rc = over.getBoundingClientRect(); stack.insertBefore(card, ev.clientY < rc.top + rc.height / 2 ? over : over.nextSibling); } };
    const up = () => { ['pointermove', 'pointerup', 'pointercancel'].forEach((t, i) => window.removeEventListener(t, i ? up : move)); card.classList.remove('drag');
      [...stack.querySelectorAll('.biz')].forEach((c, i) => { r.people.find(x => x.id === c.dataset.pid).rank = 10 + i; }); renumber(r); save(); route(); toast('Ranking saved ✦'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}
function bindRoster(r) {
  $('#addp').onclick = () => modal(`<h3>✦ Add a code name</h3><label class="f"><span>Code name</span><input id="ncode" placeholder="e.g. Mr. Tuesday, The Architect" autocomplete="off"></label><label class="f"><span>Work / company (optional)</span><input id="nwork" placeholder="e.g. Architect at a big firm"></label><p class="hint">☾ Code names keep things private — avoid real names.</p><div class="row"><span class="sp"></span><button class="btn ghost sm" id="ncancel">Cancel</button><button class="btn" id="nadd">Add</button></div>`, m => {
    const i = m.querySelector('#ncode'); i.focus();
    const go = () => { const n = i.value.trim(); if (!n) return; const now = Date.now(); const p = { id: uid(), name: n, work: m.querySelector('#nwork').value.trim(), values: {}, tags: [], photos: [], prefs: {}, feedback: [], status: 'active', rank: 1e8, addedAt: now, history: [{ at: now, from: null, to: 'active' }], rankHist: [] }; r.people.push(p); renumber(r); save(); m.remove(); location.hash = `#p/${r.id}/${p.id}`; };
    m.querySelector('#nadd').onclick = go; i.onkeydown = e => { if (e.key === 'Enter') go(); }; m.querySelector('#ncancel').onclick = () => m.remove();
  });
  $('#fields').onclick = () => fieldsModal(r);
  $('#rename').onclick = () => { const n = prompt('Roster name', r.name); if (n) { r.name = n; save(); route(); } };
  $('#delr').onclick = () => { if (confirm('Delete this roster?')) { data.rosters = data.rosters.filter(x => x !== r); ['activeId','lastUsedId','defaultId'].forEach(k => { if (data.settings?.[k] === r.id) data.settings[k] = null; }); save(); location.hash = '#all'; } };
  document.querySelectorAll('[data-ft]').forEach(t => t.onclick = () => { filterTag = t.dataset.ft || null; route(); });
  document.querySelectorAll('[data-lane]').forEach(t => t.onchange = () => { lane = t.dataset.lane; route(); });
  document.querySelectorAll('input[name=rb]').forEach(t => t.onchange = () => { r.rankBy = t.value; save(); route(); });
  document.querySelectorAll('.biz').forEach(c => c.onclick = e => { if (!e.target.closest('button,.handle')) location.hash = `#p/${r.id}/${c.dataset.pid}`; });
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = e => {
    e.stopPropagation(); const p = r.people.find(x => x.id === b.dataset.pid), a = b.dataset.act;
    if (a === 'up' || a === 'down') { p.rank += a === 'up' ? -1.5 : 1.5; renumber(r); save(); route(); return; }
    if (a === 'pen') return penaltyModal(r, p);
    if (a === 'place') return placeModal(r, p);
    if (a === 'strike') { setStatus(r, p, 'struck'); toast('Struck ✕ (restorable)'); }
    if (a === 'block') { if (!confirm('Block ' + p.name + '? They\'ll be hidden from the board (restorable from Blocked).')) return; setStatus(r, p, 'blocked'); toast('Blocked ⛔'); }
    if (a === 'ret') { setStatus(r, p, 'active'); toast('Back on the roster ✦'); }
    route();
  });
  $('#stack') && enableDrag(r, $('#stack'));
}
// ---------- Reports ----------
let repYear = new Date().getFullYear(), repScope = 'this';
const SC = { active: '#f5a524', penalty: '#ff8a1f', struck: '#8a7766', blocked: '#9b3a55' };
function donut(counts) {
  const tot = Object.values(counts).reduce((a, b) => a + b, 0) || 1, R = 42, C = 2 * Math.PI * R; let off = 0;
  const arcs = Object.entries(counts).map(([k, n]) => { const len = n / tot * C, s = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${SC[k]}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return n ? s : ''; }).join('');
  return `<svg viewBox="0 0 120 120" class="donut"><circle r="${R}" cx="60" cy="60" fill="none" stroke="#2a1c2d" stroke-width="16"/>${arcs}<text x="60" y="58" text-anchor="middle" class="dn">${Object.values(counts).reduce((a, b) => a + b, 0)}</text><text x="60" y="74" text-anchor="middle" class="dl">people</text></svg>`;
}
function bars(vals) {
  const mx = Math.max(1, ...vals), M = 'JFMAMJJASOND';
  return `<svg viewBox="0 0 320 150" class="bars"><defs><linearGradient id="gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#d9741a"/></linearGradient></defs>
  ${[0, .5, 1].map(f => `<line x1="10" x2="310" y1="${120 - f * 100}" y2="${120 - f * 100}" stroke="#3a2733" stroke-dasharray="2 4"/>`).join('')}
  ${vals.map((v, i) => { const h = v / mx * 100, x = 14 + i * 25; return `<rect x="${x}" y="${120 - h}" width="17" height="${Math.max(h, 1)}" rx="5" fill="url(#gg)"><title>${v}</title></rect>${v ? `<text x="${x + 8.5}" y="${114 - h}" text-anchor="middle" class="bv">${v}</text>` : ''}<text x="${x + 8.5}" y="138" text-anchor="middle" class="bl">${M[i]}</text>`; }).join('')}</svg>`;
}
function spark(h) {
  const pts = h.filter(x => x.rank).slice(-12); if (pts.length < 2) return '<span class="mut">—</span>';
  const mx = Math.max(...pts.map(x => x.rank)), mn = Math.min(...pts.map(x => x.rank)), w = 110, ht = 30;
  const xy = pts.map((x, i) => [i / (pts.length - 1) * (w - 6) + 3, mx === mn ? ht / 2 : 3 + (x.rank - mn) / (mx - mn) * (ht - 6)]);
  return `<svg viewBox="0 0 ${w} ${ht}" class="spark"><polyline points="${xy.map(p => p.join(',')).join(' ')}" fill="none" stroke="#f5a524" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="3" fill="#ffd98a"/></svg>`;
}
function viewReports() {
  const active = activeRoster(); if (repScope === 'this' && !active) repScope = 'all';
  const rs = repScope === 'all' ? data.rosters : [active].filter(Boolean), now = Date.now();
  const ppl = rs.flatMap(r => r.people.map(p => [r, p]));
  const years = [...new Set([new Date().getFullYear(), ...ppl.map(([, p]) => new Date(p.addedAt || now).getFullYear())])].sort((a, b) => b - a);
  const months = Array(12).fill(0); ppl.forEach(([, p]) => { const d = new Date(p.addedAt || now); if (d.getFullYear() === repYear) months[d.getMonth()]++; });
  const counts = { active: 0, penalty: 0, struck: 0, blocked: 0 }; ppl.forEach(([, p]) => counts[stOf(p)]++);
  const on = ppl.filter(([, p]) => ['active', 'penalty'].includes(stOf(p))).map(([r, p]) => [r, p, Math.floor((now - (p.addedAt || now)) / DAY)]).sort((a, b) => b[2] - a[2]);
  const avg = on.length ? Math.round(on.reduce((s, x) => s + x[2], 0) / on.length) : 0, mxd = Math.max(1, ...on.map(x => x[2]));
  const moves = ppl.filter(([, p]) => (p.rankHist || []).filter(x => x.rank).length > 1).map(([r, p]) => { const h = p.rankHist.filter(x => x.rank), d = h[0].rank - h.at(-1).rank; return [r, p, d]; });
  const tl = ppl.flatMap(([r, p]) => (p.history || []).map(h => ({ ...h, p, r }))).sort((a, b) => b.at - a.at).slice(0, 25);
  const ints = [['📅', 'Google Calendar', 'Log dates & first-date reminders'], ['🍎', 'Apple Calendar', 'Sync date nights to iCloud'], ['📸', 'Instagram', 'Pull a profile photo by handle'], ['💼', 'LinkedIn', 'Fill in the work / company line']];
  return `${header(active)}<div class="wrap"><div class="row"><h2 class="sp">📊 Reports <small class="mut" style="font-family:Inter;font-size:14px">${repScope === 'all' ? '· All rosters' : '· ' + esc(active?.name || '')}</small></h2>${DEMO ? '<button class="btn ghost sm" id="sample">✦ Load sample data</button>' : ''}</div>
  <div class="row"><div class="seg" role="tablist"><label><input type="radio" name="repscope" value="this" ${repScope === 'this' ? 'checked' : ''}><span>✦ This roster${active ? ': ' + esc(active.name) : ''}</span></label><label><input type="radio" name="repscope" value="all" ${repScope === 'all' ? 'checked' : ''}><span>🗂️ All rosters</span></label></div></div>
  <div class="rgrid">
  <div class="panel"><div class="row"><b class="sp">Adds over time</b><div class="seg">${years.map(y => `<label><input type="radio" name="yr" value="${y}" ${y === repYear ? 'checked' : ''}><span>${y}</span></label>`).join('')}</div></div>${bars(months)}<p class="mut">${months.reduce((a, b) => a + b, 0)} added in ${repYear}</p></div>
  <div class="panel"><b>Status breakdown</b><div class="drow">${donut(counts)}<div class="legend">${Object.entries(counts).map(([k, n]) => `<div><i style="background:${SC[k]}"></i>${STATUSES[k].l}<b>${n}</b></div>`).join('')}</div></div></div>
  <div class="panel"><div class="row"><b class="sp">Time on roster</b><span class="kpi">${avg}<small> days avg</small></span></div>${on.slice(0, 8).map(([, p, d]) => `<div class="ten"><span>${esc(p.name)}</span><div><i style="width:${d / mxd * 100}%"></i></div><b>${d}d</b></div>`).join('') || '<p class="mut">No one on the roster yet.</p>'}</div>
  <div class="panel"><b>Rank movement</b><p class="mut">From every reorder snapshot. ▲ means they climbed.</p>${moves.map(([, p, d]) => `<div class="mv"><span>${esc(p.name)}</span>${spark(p.rankHist)}<b class="${d > 0 ? 'upc' : d < 0 ? 'dnc' : ''}">${d > 0 ? '▲' + d : d < 0 ? '▼' + -d : '–'}</b></div>`).join('') || '<p class="mut">Reorder your roster to start tracking movement.</p>'}</div>
  <div class="panel wide"><b>Status changes</b><div class="tl">${tl.map(h => `<div class="tli"><i style="background:${SC[h.to] || '#f5a524'}"></i><div><b>${esc(h.p.name)}</b> ${h.from ? `${STATUSES[h.from]?.l} → ` : 'added as '}${STATUSES[h.to]?.l}${h.reason ? ` · “${esc(h.reason)}”` : ''}<div class="mut">${fmtD(h.at)}</div></div></div>`).join('') || '<p class="mut">No status changes yet.</p>'}</div></div>
  <div class="panel wide"><b>🔌 Integrations</b> <span class="soon">coming soon</span><div class="ints">${ints.map(([i, n, d]) => `<div class="int"><span>${i}</span><div><b>${n}</b><div class="mut">${d}</div></div><em>Soon</em></div>`).join('')}
  <div class="int live"><span>📄</span><div><b>CSV export</b><div class="mut">Download every code name, status, and field</div></div><button class="btn sm" id="csv">Export</button></div></div></div>
  </div></div>`;
}
function exportCSV(scopeRosters) { const csvRosters = scopeRosters || data.rosters;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, rows = [];
  const labels = [...new Set(csvRosters.flatMap(r => r.fields.map(f => f.label)))];
  rows.push(['Roster', 'Code name', 'Work / company', 'Status', 'Rank', 'Added', 'Days on roster', 'Tags', 'Penalty reason', 'Return by', 'Thumbs up', 'Meh', 'Thumbs down', ...labels]);
  csvRosters.forEach(r => r.people.forEach(p => { const v = l => { const f = r.fields.find(x => x.label === l); return f ? p.values?.[f.id] ?? '' : ''; }; const pr = Object.entries(p.prefs || {});
    rows.push([r.name, p.name, p.work, STATUSES[stOf(p)].l, p.rank || '', p.addedAt ? new Date(p.addedAt).toISOString().slice(0, 10) : '', p.addedAt ? Math.floor((Date.now() - p.addedAt) / DAY) : '', (p.tags || []).join('; '), p.penalty?.reason, p.penalty?.returnBy, pr.filter(x => x[1] === 'up').map(x => x[0]).join('; '), pr.filter(x => x[1] === 'meh').map(x => x[0]).join('; '), pr.filter(x => x[1] === 'down').map(x => x[0]).join('; '), ...labels.map(v)]); }));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' })); a.download = `the-roster-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); toast('CSV downloaded ✦');
}
function loadSample() {
  data.rosters = data.rosters.filter(r => r.id !== 'sample');
  const t = TEMPLATES.dating, fields = t.fields(), fid = l => fields.find(f => f.label === l).id, now = Date.now(), y = new Date().getFullYear();
  let s = 7; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const names = [['The Architect', 'Architect at a design studio'], ['Mr. Tuesday', 'Product manager, fintech'], ['Saxophone', 'Jazz musician & teacher'], ['Gym Rat', 'Personal trainer'], ['Dr. Smooth', 'Dentist'], ['The Chef', 'Sous chef downtown'], ['Pilot', 'Regional airline pilot'], ['Silicon', 'Software engineer'], ['Brunch Guy', 'Realtor'], ['Mystery Man', 'Says he works "in consulting"'], ['Captain', 'Firefighter'], ['Poet', 'High school English teacher']];
  const apps = ['Hinge', 'Bumble', 'Raya', 'The League', 'Tinder'], tags = ['tall', 'funny', 'local', 'ambitious', 'great texter', 'faith', 'kids-ok'];
  const st = ['active', 'active', 'active', 'active', 'active', 'active', 'active', 'penalty', 'penalty', 'struck', 'struck', 'blocked'];
  const people = names.map(([n, w], i) => { const added = new Date(y, Math.min(new Date().getMonth(), Math.floor(rnd() * 10)), 1 + Math.floor(rnd() * 27)).getTime(); const a = Math.min(added, now - DAY * (3 + i));
    const pr = {}; t.prefs.forEach(k => { const x = rnd(); pr[k] = x < .5 ? 'up' : x < .65 ? 'meh' : x < .8 ? 'down' : null; });
    const rh = []; let rk = 1 + Math.floor(rnd() * 7); for (let k = 0; k < 6; k++) { rh.push({ at: a + k * DAY * 6, rank: rk }); rk = Math.max(1, Math.min(9, rk + Math.round((rnd() - .5) * 3))); }
    const p = { id: 's' + i, name: n, work: w, tags: [tags[i % 7], tags[(i * 3 + 1) % 7]].filter((v, j, A) => A.indexOf(v) === j), photos: [], prefs: pr, feedback: [], addedAt: a, rankHist: rh, status: 'active', rank: rk + rnd(),
      values: { [fid('Seen on a dating app')]: i % 3 !== 2, [fid('Which app')]: i % 3 !== 2 ? apps[i % 5] : '', [fid('Where we met')]: i % 3 === 2 ? 'Friend\'s party' : '', [fid('How was the first date')]: 2 + Math.floor(rnd() * 4) }, history: [{ at: a, from: null, to: 'active' }] };
    if (st[i] !== 'active') { const at = a + DAY * (2 + Math.floor(rnd() * 20)); const reason = st[i] === 'penalty' ? ['Cancelled last minute', 'Took 3 days to text back'][i % 2] : st[i] === 'struck' ? 'Not a match' : 'Red flag'; p.history.push({ at: Math.min(at, now - DAY), from: 'active', to: st[i], reason }); p.status = st[i];
      if (st[i] === 'penalty') p.penalty = { reason, returnBy: new Date(now + (i % 2 ? -2 : 9) * DAY).toISOString().slice(0, 10) }; }
    return p; });
  const r = { id: 'sample', type: 'dating', name: 'Sample Dating Roster ✦', fields, prefs: [...t.prefs], people, placed: 1 }; people.filter(p => p.status === 'active').sort((a, b) => a.rank - b.rank).slice(0, 3).forEach((p, i) => p.place = i + 1); renumber(r); data.rosters.unshift(r); data.settings = data.settings || {}; data.settings.activeId = r.id; data.settings.lastUsedId = r.id; repScope = 'this'; save(); toast('Sample data loaded ✦');
}
function bindReports() {
  $('#sample') && ($('#sample').onclick = () => { loadSample(); route(); });
  $('#csv').onclick = () => exportCSV(repScope === 'all' ? data.rosters : [activeRoster()].filter(Boolean));
  document.querySelectorAll('input[name=repscope]').forEach(i => i.onchange = () => { repScope = i.value; route(); });
  document.querySelectorAll('input[name=yr]').forEach(i => i.onchange = () => { repYear = +i.value; route(); });
}

// ---------- Modals ----------
function modal(html, onMount) { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div>${html}</div>`; m.onclick = e => { if (e.target === m) m.remove(); }; document.body.appendChild(m); onMount?.(m); return m; }
function fieldsModal(r) {
  const draw = m => {
    m.firstChild.innerHTML = `<h3>Fields for ${esc(r.name)}</h3>${r.fields.map((f, i) => `<div class="row" style="margin:6px 0"><input data-lab="${i}" value="${esc(f.label)}" style="flex:2"><select data-typ="${i}" style="flex:1">${FIELD_TYPES.map(t => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn danger sm" data-rm="${i}">×</button>
    ${f.type === 'select' ? `<input data-opt="${i}" placeholder="options, comma separated" value="${esc((f.options || []).join(', '))}">` : ''}</div>`).join('')}
    <div class="row" style="margin-top:12px"><button class="btn ghost" id="addf">+ Add field</button><span class="sp"></span><button class="btn" id="donef">Done</button></div>`;
    m.querySelectorAll('[data-lab]').forEach(e => e.oninput = () => { r.fields[e.dataset.lab].label = e.value; save(); });
    m.querySelectorAll('[data-typ]').forEach(e => e.onchange = () => { r.fields[e.dataset.typ].type = e.value; save(); draw(m); });
    m.querySelectorAll('[data-opt]').forEach(e => e.oninput = () => { r.fields[e.dataset.opt].options = e.value.split(',').map(s => s.trim()).filter(Boolean); save(); });
    m.querySelectorAll('[data-rm]').forEach(e => e.onclick = () => { if (confirm('Remove this field?')) { r.fields.splice(e.dataset.rm, 1); save(); draw(m); } });
    m.querySelector('#addf').onclick = () => { r.fields.push(F('New field')); save(); draw(m); };
    m.querySelector('#donef').onclick = () => { m.remove(); route(); };
  };
  modal('', draw);
}
function shareModal(r, p) {
  const opts = [{ id: '_photo', label: 'First photo', def: true }, { id: '_tags', label: 'Tags', def: true }, { id: '_rank', label: 'My ranking', def: false },
    ...r.fields.filter(f => p.values?.[f.id] !== undefined && p.values?.[f.id] !== '').map(f => ({ id: f.id, label: f.label, def: f.link || f.type === 'select' }))];
  const cats = r.type === 'dating' ? ['Good for me', 'Trustworthy', 'Kind', 'Fun', 'Long-term potential', 'Vibe'] : ['Good fit', 'Reliable', 'Trustworthy', 'Recommend'];
  modal(`<h3>Get feedback on ${esc(p.name)}</h3><p class="mut">Pick what your friend can see. Rankings and notes are hidden by default.</p>
  ${opts.map(o => `<label class="chk"><input type="checkbox" data-so="${o.id}" ${o.def && !/note/i.test(o.label) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}
  <label class="f"><span>Categories your friend votes on (comma separated)</span><input id="scats" value="${cats.join(', ')}"></label>
  <button class="btn" id="mk">Create share link</button><div id="sout"></div>`, m => {
    m.querySelector('#mk').onclick = async () => {
      const on = new Set([...m.querySelectorAll('[data-so]:checked')].map(e => e.dataset.so));
      const card = { name: p.name, categories: m.querySelector('#scats').value.split(',').map(s => s.trim()).filter(Boolean),
        photo: on.has('_photo') ? (p.photos?.[0] || null) : null, tags: on.has('_tags') ? (p.tags || []) : [],
        fields: [...(on.has('_rank') && p.rank ? [{ label: 'Ranking', value: '#' + p.rank }] : []), ...r.fields.filter(f => on.has(f.id)).map(f => ({ label: f.label, value: p.values[f.id] }))] };
      try {
        const code = await createShare(r.id, p.id, card); p.shares = [...(p.shares || []), code]; save();
        const url = location.href.split('#')[0] + '#share/' + code;
        m.querySelector('#sout').innerHTML = `<label class="f"><span>Share link</span><input value="${url}" readonly onclick="this.select()"></label><button class="btn ghost sm" id="cp">Copy</button> <a class="btn ghost sm" href="#share/${code}" target="_blank">Preview friend view</a>
        ${DEMO ? '<p class="mut">Demo mode: the link works in this browser only (simulated share). Feedback submitted there appears on this card after Refresh.</p>' : ''}`;
        m.querySelector('#cp').onclick = () => navigator.clipboard?.writeText(url).then(() => toast('Copied!'));
      } catch (e) { toast(e.message); }
    };
  });
}
function resize(file) { return new Promise(res => { const fr = new FileReader(); fr.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 640 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .8)); }; img.src = fr.result; }; fr.readAsDataURL(file); }); }

// ---------- Router ----------
let ed = null;
function revertEd() { if (!ed) return; const o = JSON.parse(ed.orig); Object.keys(ed.p).forEach(k => delete ed.p[k]); Object.assign(ed.p, o); ed = null; }
window.addEventListener('beforeunload', e => { if (ed?.dirty) { e.preventDefault(); e.returnValue = ''; } });
async function route() {
  if (ed && location.hash !== `#p/${ed.r.id}/${ed.p.id}`) {
    if (ed.dirty && !confirm('You have unsaved changes. Leave without saving?')) { history.replaceState(null, '', `#p/${ed.r.id}/${ed.p.id}`); return; }
    if (ed.dirty) revertEd(); else ed = null;
  }
  const h = location.hash.slice(1), [v, a, b] = h.split('/'), app = $('#app');
  if (v === 'share') { const s = await getShare(a); app.innerHTML = viewFriend(a, s); bindFriend(a); document.body.classList.remove('hasnav'); return bindCommon(); }
  if (!user && ['home', 'r', 'p', 'reports', 'all', 'settings', 'welcome'].includes(v)) { location.hash = '#signin'; return; }
  const r = data.rosters.find(x => x.id === a), p = r?.people.find(x => x.id === b);
  const finish = (view) => { if (user && !['landing','signin','welcome'].includes(view)) app.insertAdjacentHTML('beforeend', nav(view, activeRoster())); if (view === 'r' && activeRoster()) { const f = $('#fab'); f && (f.onclick = () => $('#addp').click()); } document.body.classList.toggle('hasnav', !!user && !['landing','signin','welcome'].includes(view)); bindCommon(); if (h !== lastHash) window.scrollTo(0, 0); lastHash = h; };
  if (v === 'signin') { app.innerHTML = viewSignin(); return finish('signin'); }
  if (user && (v === '' || v === 'home')) {
    if (!data.rosters.length) { app.innerHTML = viewOverview(); return finish('all'); }
    const st = data.settings || {};
    const remembered = st.remember && data.rosters.find(x => x.id === (st.defaultId || st.lastUsedId));
    if (remembered) { location.hash = '#r/' + remembered.id; return; }
    if (data.rosters.length > 1) { app.innerHTML = viewWelcome(); bindWelcome(); return finish('welcome'); }
    location.hash = '#r/' + data.rosters[0].id; return;
  }
  if (!user) { app.innerHTML = viewLanding(); return finish('landing'); }
  if (v === 'welcome') { if (!data.rosters.length) { location.hash = '#all'; return; } app.innerHTML = viewWelcome(); bindWelcome(); return finish('welcome'); }
  if (v === 'all') { app.innerHTML = viewOverview(); bindOverview(); return finish('all'); }
  if (v === 'settings') { app.innerHTML = viewSettings(); bindSettings(); return finish('settings'); }
  if (v === 'reports') { app.innerHTML = viewReports(); bindReports(); return finish('reports'); }
  if (v === 'r' && r) { setActive(r.id); app.innerHTML = viewRoster(r); bindRoster(r); return finish('r'); }
  if (v === 'p' && r && p) { setActive(r.id); app.innerHTML = viewPerson(r, p); bindPerson(r, p); return finish('p'); }
  if (v === 'r' || v === 'p') { const act = activeRoster(); location.hash = act ? '#r/' + act.id : '#all'; return; }
  app.innerHTML = viewLanding(); return finish('landing');
}
let lastHash = null;
function nav(v, r) {
  const it = (h, ic, l, on) => `<a href="${h}" class="${on ? 'on' : ''}"><span>${ic}</span><em>${l}</em></a>`;
  return `<nav class="tabs">${it(r ? '#r/' + r.id : '#all', '✦', 'Board', v === 'r' || v === 'p')}${it('#all', '🗂️', 'Rosters', v === 'all' || v === 'welcome')}${it('#reports', '📊', 'Reports', v === 'reports')}${it('#settings', '⚙️', 'Settings', v === 'settings')}<a href="#" id="out2"><span>⏻</span><em>Sign out</em></a></nav>${v === 'r' && r ? '<button class="fab" id="fab" aria-label="Add a code name">＋<em> Code name</em></button>' : ''}`;
}
function bindWelcome() {
  document.querySelectorAll('[data-open]').forEach(c => { const go = () => { landingPick = c.dataset.open; document.querySelectorAll('.landwrap').forEach(w => w.classList.toggle('sel', w.contains(c))); const b = $('#enterPick'); if (b) { b.disabled = false; b.textContent = 'Enter ' + (data.rosters.find(r => r.id === landingPick)?.name || '') + ' ✦'; } }; c.onclick = go; c.onkeydown = e => { if (e.key === 'Enter') go(); }; });
  const enter = $('#enterPick'); enter && (enter.onclick = () => { const id = landingPick || activeRoster()?.id; if (!id) return; const rem = $('#rememberPick')?.checked; data.settings.remember = !!rem; if (rem) data.settings.defaultId = id; setActive(id); location.hash = '#r/' + id; });
}
function bindOverview() { document.querySelectorAll('[data-open]').forEach(c => { const go = () => { setActive(c.dataset.open); location.hash = '#r/' + c.dataset.open; }; c.onclick = go; c.onkeydown = e => { if (e.key === 'Enter') go(); }; }); }
function bindSettings() {
  $('#setDefault') && ($('#setDefault').onchange = e => { data.settings.defaultId = e.target.value || null; save(); toast('Landing roster saved ✦'); });
  $('#setRemember') && ($('#setRemember').onchange = e => { data.settings.remember = e.target.checked; save(); toast(e.target.checked ? 'Landing choice remembered ✦' : 'We will ask where to land'); });
}
function newRosterModal() {
  modal(`<h3>✦ New roster</h3><p class="mut">Pick a template — you will land inside the new roster.</p>${Object.entries(TEMPLATES).map(([k, v]) => `<button class="switem tpl" data-tpl="${k}"><span>${v.emoji}</span><span class="swtxt"><b>${v.name}</b><small>${v.blurb}</small></span></button>`).join('')}<div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn ghost sm" id="nrc">Cancel</button></div>`, m => {
    m.querySelector('#nrc').onclick = () => m.remove();
    m.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => { const k = b.dataset.tpl, t = TEMPLATES[k]; const r = { id: uid(), type: k, name: 'My ' + t.name + ' Roster', fields: t.fields(), prefs: t.prefs ? [...t.prefs] : [], people: [] }; data.rosters.push(r); setActive(r.id); m.remove(); location.hash = '#r/' + r.id; route(); });
  });
}
function bindCommon() {
  const swb = $('#swBtn'), swm = $('#swMenu');
  if (swb && swm) { swb.onclick = e => { e.stopPropagation(); const open = swm.hidden; swm.hidden = !open; swb.setAttribute('aria-expanded', String(open)); }; document.addEventListener('click', e => { if (!e.target.closest('.swrow')) swm.hidden = true; }, { once: true }); }
  document.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { const id = b.dataset.sw; setActive(id); const cur = location.hash.slice(1).split('/')[0]; location.hash = cur === 'reports' ? '#reports' : '#r/' + id; if (cur === 'reports') route(); });
  document.querySelectorAll('[data-swnew]').forEach(b => b.onclick = () => newRosterModal());
  $('#out') && ($('#out').onclick = signOut);
  $('#out2') && ($('#out2').onclick = e => { e.preventDefault(); signOut(); });
  document.querySelectorAll('[data-signin]').forEach(b => b.onclick = () => signIn(b.dataset.signin));
  document.querySelectorAll('[data-start]').forEach(c => c.onclick = () => {
    if (!user) { sessionStorage.setItem('pendingStart', c.dataset.start); location.hash = '#signin'; return; }
    const k = c.dataset.start, t = TEMPLATES[k];
    const r = { id: uid(), type: k, name: 'My ' + t.name + ' Roster', fields: t.fields(), prefs: t.prefs ? [...t.prefs] : [], people: [] };
    data.rosters.push(r); setActive(r.id); location.hash = '#r/' + r.id;
  });
}
function bindPerson(r, p) {
  if (!ed || ed.p !== p) ed = { r, p, orig: JSON.stringify(p), dirty: false };
  const dirty = () => { ed.dirty = true; const s = $('#sstate'); if (s) { s.textContent = '● Unsaved changes'; s.className = 'dirty'; } };
  $('#psave').onclick = () => { save(); ed.orig = JSON.stringify(p); ed.dirty = false; $('#sstate').textContent = '✓ All changes saved'; $('#sstate').className = ''; toast('Saved ✓'); };
  $('#pcancel').onclick = () => { if (ed.dirty && !confirm('Discard unsaved changes?')) return; revertEd(); location.hash = '#r/' + r.id; };
  document.querySelectorAll('input[name=pp]').forEach(i => i.onchange = () => { if (ed.dirty) { save(); ed.dirty = false; } assignPlace(r, p, i.value); ed.orig = JSON.stringify(p); route(); });
  p.values = p.values || {}; p.prefs = p.prefs || {};
  $('#pname').oninput = e => { p.name = e.target.value; dirty(); };
  $('#pwork').oninput = e => { p.work = e.target.value; dirty(); };
  document.querySelectorAll('[data-st]').forEach(i => i.onchange = () => { const to = i.dataset.st; ed.dirty = false; ed.orig = JSON.stringify(p); if (to === 'penalty') { penaltyModal(r, p); route(); return; } if (to === 'blocked' && !confirm('Block ' + p.name + '?')) return route(); setStatus(r, p, to); route(); });
  $('#ptags').onchange = e => { p.tags = [...new Set(e.target.value.split(',').map(s => s.trim()).filter(Boolean))]; dirty(); };
  document.querySelectorAll('[data-f]').forEach(e => { const ev = e.tagName === 'SELECT' || e.type === 'checkbox' || e.type === 'date' ? 'onchange' : 'oninput'; e[ev] = () => { p.values[e.dataset.f] = e.type === 'checkbox' ? e.checked : e.value; dirty(); }; });
  document.querySelectorAll('[data-rate]').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => { p.values[s.dataset.rate] = +b.dataset.v; dirty(); s.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.v <= +b.dataset.v)); }));
  document.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => cycleBtn(b, () => p.prefs[b.dataset.pref], v => { p.prefs[b.dataset.pref] = v; dirty(); }));
  document.querySelectorAll('[data-rmtag]').forEach(b => b.onclick = () => { p.tags = p.tags.filter(t => t !== b.dataset.rmtag); dirty(); route(); });
  document.querySelectorAll('.sw input').forEach(i => i.addEventListener('change', () => i.parentNode.querySelector('b').textContent = i.checked ? 'Yes' : 'No'));
  $('#phup').onchange = async e => { for (const f of e.target.files) p.photos.push(await resize(f)); dirty(); route(); };
  document.querySelectorAll('[data-rmph]').forEach(b => b.onclick = () => { p.photos.splice(+b.dataset.rmph, 1); dirty(); route(); });
  $('#delp').onclick = () => { if (confirm('Remove ' + p.name + '?')) { r.people = r.people.filter(x => x !== p); save(); location.hash = '#r/' + r.id; } };
  $('#share').onclick = () => shareModal(r, p);
  $('#refresh').onclick = async () => { await pullFeedback(); save(); route(); toast('Feedback refreshed'); };
}
function bindFriend(code) {
  const votes = {};
  document.querySelectorAll('[data-fv]').forEach(b => b.onclick = () => cycleBtn(b, () => votes[b.dataset.fv], v => { if (v) votes[b.dataset.fv] = v; else delete votes[b.dataset.fv]; }));
  $('#fsend') && ($('#fsend').onclick = async () => {
    try { await sendFeedback(code, { knows: $('#fknows').checked, votes, comment: $('#fcom').value, from: $('#ffrom').value, at: Date.now() });
      $('#app').querySelector('.wrap').innerHTML = '<div class="panel"><h2>Thanks! 💜</h2><p>Your feedback was sent privately to your friend.</p></div>'; } catch (e) { toast(e.message); }
  });
}
window.addEventListener('hashchange', route);
(async () => {
  if (DEMO) { if (sessionStorage.getItem('demoUser')) { user = { uid: 'demo' }; await load(); } route(); }
  else { route(); await initFirebase(); }
})();
