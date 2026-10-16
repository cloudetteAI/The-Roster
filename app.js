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
    prefs: ['Arms', 'Abs', 'Hair', 'Face', 'Overall looks', 'Clothing / style', 'Smell', 'Vibe'] },
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
  const rk = o => { if (!o) return; for (const [a, b] of Object.entries(RENAME)) if (a in o) { if (!(b in o)) o[b] = o[a]; delete o[a]; } };
  for (const r of data.rosters || []) { if (r.prefs) r.prefs = r.prefs.map(k => RENAME[k] || k); for (const p of r.people || []) { rk(p.prefs); (p.feedback || []).forEach(f => rk(f.votes)); } }
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
const header = () => `<div class="top"><div class="logo" onclick="location.hash='${user ? '#home' : ''}'"><span class="moon">☾</span> The <span>Roster</span>${DEMO ? '<span class="badge">DEMO MODE</span>' : ''}</div>
  <div>${user ? `<button class="btn ghost sm" id="out">Sign out</button>` : `<button class="btn sm" onclick="location.hash='#signin'">Sign in</button>`}</div></div>`;

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
function viewHome() {
  return `${header()}<div class="wrap"><h2>Your rosters</h2>
  <div class="grid">${data.rosters.map(r => `<div class="tcard" onclick="location.hash='#r/${r.id}'"><div class="em">${TEMPLATES[r.type]?.emoji || '✨'}</div><h3>${esc(r.name)}</h3><p>${r.people.length} people</p></div>`).join('') || '<p class="mut">No rosters yet — pick a template below.</p>'}</div>
  <h3 style="margin-top:28px">Start a new roster</h3><div class="grid">${Object.entries(TEMPLATES).map(([k, v]) => `<div class="tcard" data-start="${k}"><div class="em">${v.emoji}</div><h3>${v.name}</h3><p>${v.blurb}</p></div>`).join('')}</div></div>`;
}
let filterTag = null, groupBy = false;
function viewRoster(r) {
  const tags = [...new Set(r.people.flatMap(p => p.tags || []))].sort();
  let ppl = [...r.people].sort((a, b) => (a.rank || 999) - (b.rank || 999));
  if (filterTag) ppl = ppl.filter(p => (p.tags || []).includes(filterTag));
  const card = p => `<div class="pcard" onclick="location.hash='#p/${r.id}/${p.id}'"><div class="ph" style="${p.photos?.[0] ? `background-image:url(${p.photos[0]})` : ''}">${p.photos?.[0] ? '' : esc((p.name || '?')[0])}</div>
    <div class="b"><h4>${p.rank ? '#' + p.rank + ' ' : ''}${esc(p.name)}</h4>${(p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${p.feedback?.length ? `<div class="mut">💬 ${p.feedback.length} feedback</div>` : ''}</div></div>`;
  const body = groupBy && tags.length ? tags.map(t => { const g = ppl.filter(p => (p.tags || []).includes(t)); return g.length ? `<h3>#${esc(t)}</h3><div class="grid">${g.map(card).join('')}</div>` : ''; }).join('') + (() => { const u = ppl.filter(p => !(p.tags || []).length); return u.length ? `<h3>Untagged</h3><div class="grid">${u.map(card).join('')}</div>` : ''; })()
    : `<div class="grid">${ppl.map(card).join('') || '<p class="mut">Nobody here yet. Add your first code name ✦</p>'}</div>`;
  return `${header()}<div class="wrap"><div class="row"><h2 class="sp">${TEMPLATES[r.type]?.emoji} ${esc(r.name)}</h2>
  <button class="btn ghost sm" id="fields">⚙️ Fields</button><button class="btn ghost sm" id="rename">Rename</button><button class="btn danger sm" id="delr">Delete</button></div>
  <div class="row"><button class="btn" id="addp">+ Add a code name</button><span class="sp"></span><label class="chk mut"><input type="checkbox" id="grp" ${groupBy ? 'checked' : ''}> Group by tag</label></div>
  ${tags.length ? `<div style="margin:12px 0"><span class="mut">Filter: </span><span class="tag ${!filterTag ? 'on' : ''}" data-ft="">All</span>${tags.map(t => `<span class="tag ${filterTag === t ? 'on' : ''}" data-ft="${esc(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
  ${body}</div>`;
}
function fieldInput(f, v) {
  const n = `data-f="${f.id}"`;
  if (f.type === 'notes') return `<textarea ${n}>${esc(v)}</textarea>`;
  if (f.type === 'checkbox') return `<label class="chk"><input type="checkbox" ${n} ${v ? 'checked' : ''}> Yes</label>`;
  if (f.type === 'date') return `<input type="date" ${n} value="${esc(v)}">`;
  if (f.type === 'select') return `<select ${n}><option value="">—</option>${(f.options || []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  if (f.type === 'rating') return `<div class="stars" data-rate="${f.id}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" class="${i <= (v || 0) ? 'on' : ''}">★</button>`).join('')}</div>`;
  return `<input ${n} value="${esc(v)}" placeholder="${f.link ? 'https://…' : ''}">${f.link && v ? ` <a href="${esc(/^https?:/.test(v) ? v : 'https://' + v)}" target="_blank" rel="noopener">open ↗</a>` : ''}`;
}
function viewPerson(r, p) {
  const prefs = r.prefs || [];
  return `${header()}<div class="wrap"><div class="row"><a href="#r/${r.id}">← ${esc(r.name)}</a><span class="sp"></span><button class="btn sm" id="share">🔗 Get feedback</button><button class="btn danger sm" id="delp">Remove</button></div>
  <div class="panel"><label class="f"><span>Code name</span><input id="pname" value="${esc(p.name)}" placeholder="e.g. Mr. Tuesday, The Architect"></label><p class="hint">☾ Code names keep things private — skip real names.</p>
  <label class="f"><span>Overall ranking (1 = top)</span><input type="number" min="1" id="prank" value="${p.rank || ''}"></label>
  <label class="f"><span>Tags / labels (comma separated — e.g. tall, funny, local)</span><input id="ptags" value="${esc((p.tags || []).join(', '))}"></label></div>
  <div class="panel"><b>📸 Photos</b><div class="photos" style="margin:10px 0">${(p.photos || []).map((u, i) => `<div style="background-image:url(${u})"><button data-rmph="${i}">×</button></div>`).join('')}</div>
  <input type="file" accept="image/*" multiple id="phup"><p class="mut">${DEMO ? 'Demo mode: photos are resized and stored as data URLs in this browser.' : 'Photos are stored (resized) inside your private roster doc. Firebase Storage-ready: swap to Storage for full-size uploads.'}</p></div>
  <div class="panel"><b>Details</b>${r.fields.map(f => `<label class="f"><span>${esc(f.label)}</span>${fieldInput(f, p.values?.[f.id])}</label>`).join('')}</div>
  ${prefs.length ? `<div class="panel"><b>Physical preferences</b><p class="mut">Thumbs up or down — private to you.</p><div class="thumbs">${prefs.map(k => `<div class="thumb"><span>${esc(k)}</span><span><button data-pref="${esc(k)}" data-v="up" class="${p.prefs?.[k] === 'up' ? 'up' : ''}">👍</button><button data-pref="${esc(k)}" data-v="down" class="${p.prefs?.[k] === 'down' ? 'down' : ''}">👎</button></span></div>`).join('')}</div></div>` : ''}
  <div class="panel"><div class="row"><b class="sp">💬 Friend feedback</b><button class="btn ghost sm" id="refresh">Refresh</button></div>${(p.feedback || []).map(f => `<div class="fb"><b>${esc(f.from || 'A friend')}</b> ${f.knows ? '· knows them personally' : ''}<div>${Object.entries(f.votes || {}).map(([k, v]) => `<span class="tag">${esc(k)} ${v === 'up' ? '👍' : '👎'}</span>`).join('')}</div>${f.comment ? `<div>“${esc(f.comment)}”</div>` : ''}</div>`).join('') || '<p class="mut">No feedback yet. Tap “Get feedback” to share a limited card with a friend.</p>'}</div></div>`;
}
function viewFriend(code, s) {
  if (!s) return `${header()}<div class="wrap"><div class="panel">This share link isn't valid (or, in demo mode, was created in another browser).</div></div>`;
  const c = s.card;
  return `${header()}<div class="wrap" style="max-width:560px"><h2>Your friend wants your take 👀</h2>
  <div class="pcard" style="cursor:default">${c.photo ? `<div class="ph" style="background-image:url(${c.photo})"></div>` : ''}<div class="b"><div class="cn">Code name</div><h3>${esc(c.name)}</h3>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
  ${(c.fields || []).map(f => `<div><span class="mut">${esc(f.label)}:</span> ${esc(f.value === true ? 'Yes' : f.value)}</div>`).join('')}</div></div>
  <div class="panel"><label class="f"><span>Your name (optional)</span><input id="ffrom"></label><label class="chk"><input type="checkbox" id="fknows"> I know this person personally</label>
  <p class="mut">Based on what you know, are they good for your friend?</p><div class="thumbs">${(c.categories || []).map(k => RENAME[k] || k).map(k => `<div class="thumb"><span>${esc(k)}</span><span><button data-fv="${esc(k)}" data-v="up">👍</button><button data-fv="${esc(k)}" data-v="down">👎</button></span></div>`).join('')}</div>
  <label class="f"><span>Comment</span><textarea id="fcom"></textarea></label><button class="btn" id="fsend">Send feedback</button></div></div>`;
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
async function route() {
  const h = location.hash.slice(1), [v, a, b] = h.split('/'), app = $('#app');
  if (v === 'share') { const s = await getShare(a); app.innerHTML = viewFriend(a, s); bindFriend(a); return bindCommon(); }
  if (!user && ['home', 'r', 'p'].includes(v)) { location.hash = '#signin'; return; }
  const r = data.rosters.find(x => x.id === a), p = r?.people.find(x => x.id === b);
  if (v === 'signin') app.innerHTML = viewSignin();
  else if (v === 'home') app.innerHTML = viewHome();
  else if (v === 'r' && r) { app.innerHTML = viewRoster(r); bindRoster(r); }
  else if (v === 'p' && p) { app.innerHTML = viewPerson(r, p); bindPerson(r, p); }
  else app.innerHTML = viewLanding();
  bindCommon(); window.scrollTo(0, 0);
}
function bindCommon() {
  $('#out') && ($('#out').onclick = signOut);
  document.querySelectorAll('[data-signin]').forEach(b => b.onclick = () => signIn(b.dataset.signin));
  document.querySelectorAll('[data-start]').forEach(c => c.onclick = () => {
    if (!user) { sessionStorage.setItem('pendingStart', c.dataset.start); location.hash = '#signin'; return; }
    const k = c.dataset.start, t = TEMPLATES[k];
    const r = { id: uid(), type: k, name: 'My ' + t.name + ' Roster', fields: t.fields(), prefs: t.prefs ? [...t.prefs] : [], people: [] };
    data.rosters.push(r); save(); location.hash = '#r/' + r.id;
  });
}
function bindRoster(r) {
  $('#addp').onclick = () => modal(`<h3>✦ Add a code name</h3><label class="f"><span>Code name</span><input id="ncode" placeholder="e.g. Mr. Tuesday, The Architect" autocomplete="off"></label><p class="hint">☾ Code names keep things private — avoid real names.</p><div class="row"><span class="sp"></span><button class="btn ghost sm" id="ncancel">Cancel</button><button class="btn" id="nadd">Add</button></div>`, m => {
    const i = m.querySelector('#ncode'); i.focus();
    const go = () => { const n = i.value.trim(); if (!n) return; const p = { id: uid(), name: n, values: {}, tags: [], photos: [], prefs: {}, feedback: [] }; r.people.push(p); save(); m.remove(); location.hash = `#p/${r.id}/${p.id}`; };
    m.querySelector('#nadd').onclick = go; i.onkeydown = e => { if (e.key === 'Enter') go(); }; m.querySelector('#ncancel').onclick = () => m.remove();
  });
  $('#fields').onclick = () => fieldsModal(r);
  $('#rename').onclick = () => { const n = prompt('Roster name', r.name); if (n) { r.name = n; save(); route(); } };
  $('#delr').onclick = () => { if (confirm('Delete this roster?')) { data.rosters = data.rosters.filter(x => x !== r); save(); location.hash = '#home'; } };
  $('#grp').onchange = e => { groupBy = e.target.checked; route(); };
  document.querySelectorAll('[data-ft]').forEach(t => t.onclick = () => { filterTag = t.dataset.ft || null; route(); });
}
function bindPerson(r, p) {
  p.values = p.values || {}; p.prefs = p.prefs || {};
  $('#pname').oninput = e => { p.name = e.target.value; save(); };
  $('#prank').oninput = e => { p.rank = +e.target.value || null; save(); };
  $('#ptags').onchange = e => { p.tags = [...new Set(e.target.value.split(',').map(s => s.trim()).filter(Boolean))]; save(); };
  document.querySelectorAll('[data-f]').forEach(e => { const ev = e.tagName === 'SELECT' || e.type === 'checkbox' || e.type === 'date' ? 'onchange' : 'oninput'; e[ev] = () => { p.values[e.dataset.f] = e.type === 'checkbox' ? e.checked : e.value; save(); }; });
  document.querySelectorAll('[data-rate]').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => { p.values[s.dataset.rate] = +b.dataset.v; save(); s.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.v <= +b.dataset.v)); }));
  document.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => { const k = b.dataset.pref; p.prefs[k] = p.prefs[k] === b.dataset.v ? null : b.dataset.v; save(); route(); });
  $('#phup').onchange = async e => { for (const f of e.target.files) p.photos.push(await resize(f)); save(); route(); };
  document.querySelectorAll('[data-rmph]').forEach(b => b.onclick = () => { p.photos.splice(+b.dataset.rmph, 1); save(); route(); });
  $('#delp').onclick = () => { if (confirm('Remove ' + p.name + '?')) { r.people = r.people.filter(x => x !== p); save(); location.hash = '#r/' + r.id; } };
  $('#share').onclick = () => shareModal(r, p);
  $('#refresh').onclick = async () => { await pullFeedback(); save(); route(); toast('Feedback refreshed'); };
}
function bindFriend(code) {
  const votes = {};
  document.querySelectorAll('[data-fv]').forEach(b => b.onclick = () => { votes[b.dataset.fv] = b.dataset.v; b.parentNode.querySelectorAll('button').forEach(x => x.className = ''); b.className = b.dataset.v; });
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
