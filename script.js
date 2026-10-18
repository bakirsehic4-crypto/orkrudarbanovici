// ORK Rudar Banovići - glavna skripta (usklađena sa index.html)
'use strict';

const API_BASE = 'https://orkrudarbanovici-1.onrender.com/api';
const SESSION_USER_KEY = 'club_session_user';
const CLUB_NAME = 'ORK Rudar Banovići';
const CLUB_BADGE = 'rudar.png';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Stanje
// ---------------------------------------------------------------------------
let currentView = 'announcements';
let authMode = 'login';
let myAvatar = '';
let chatTimer = null;
let lastChatSignature = '';
let activeGeneration = '2010/11';
const avatarCache = {};
const avatarPending = {};

// ---------------------------------------------------------------------------
// Pomoćne funkcije
// ---------------------------------------------------------------------------
function currentUser() {
  try { return (sessionStorage.getItem(SESSION_USER_KEY) || '').trim(); } catch (e) { return ''; }
}

function setCurrentUser(name) {
  try {
    if (name) sessionStorage.setItem(SESSION_USER_KEY, name);
    else sessionStorage.removeItem(SESSION_USER_KEY);
  } catch (e) { /* ignore */ }
}

function isAdmin() {
  return currentUser().toLowerCase() === 'admin';
}

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - Number(ts)) / 1000);
  if (diff < 60) return 'Upravo sada';
  if (diff < 3600) return `Prije ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Prije ${Math.floor(diff / 3600)} h`;
  return new Date(Number(ts)).toLocaleDateString('bs-BA');
}

function showLoader(show, text) {
  const loader = $('globalLoader');
  if (!loader) return;
  if (text && $('globalLoaderText')) $('globalLoaderText').textContent = text;
  loader.hidden = !show;
  loader.setAttribute('aria-busy', String(!!show));
}

async function fetchJson(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        // encodeURIComponent: imena sa č, ć, š, đ, ž inače ruše fetch
        'X-Club-User': encodeURIComponent(currentUser()),
        ...(options.headers || {})
      }
    });
  } catch (e) {
    throw new Error('Server nije dostupan. Provjerite internet vezu ili pokušajte ponovo za minutu.');
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Greška servera: ${res.status}`);
  }
  return res.json();
}

// Smanjuje sliku prije slanja (manje podataka, brže učitavanje)
function fileToResizedDataUrl(file, maxSize, type = 'image/jpeg', quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nije moguće pročitati sliku.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Datoteka nije ispravna slika.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const hgt = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hgt;
        const ctx = canvas.getContext('2d');
        if (type === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, hgt);
        }
        ctx.drawImage(img, 0, 0, w, hgt);
        resolve(canvas.toDataURL(type, quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Avatari
// ---------------------------------------------------------------------------
function paintAvatar(el, name, src) {
  el.textContent = '';
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = name;
    el.appendChild(img);
  } else {
    el.textContent = ((name || '?').trim().charAt(0) || '?').toUpperCase();
  }
}

function updateHeaderAvatar() {
  const el = $('avatar');
  if (!el) return;
  paintAvatar(el, currentUser() || 'A', myAvatar);
  el.title = currentUser() || 'Korisnik';
  const wrap = el.closest('.avatar-wrap');
  if (wrap) wrap.classList.toggle('has-image', !!myAvatar);
}

function fetchAvatar(name) {
  const key = name.toLowerCase();
  if (key in avatarCache) return Promise.resolve(avatarCache[key]);
  if (!avatarPending[key]) {
    avatarPending[key] = fetchJson(API_BASE + '/users/' + encodeURIComponent(name))
      .then(r => { avatarCache[key] = r.avatar || ''; return avatarCache[key]; })
      .catch(() => { avatarCache[key] = ''; return ''; });
  }
  return avatarPending[key];
}

function fillAvatar(el, name) {
  const key = name.toLowerCase();
  paintAvatar(el, name, avatarCache[key] || '');
  if (!(key in avatarCache)) {
    fetchAvatar(name).then(src => { if (src) paintAvatar(el, name, src); });
  }
}

async function saveAvatar(dataUrl) {
  const user = currentUser();
  if (!user) return;
  await fetchJson(API_BASE + '/users/' + encodeURIComponent(user) + '/avatar', {
    method: 'PUT',
    body: JSON.stringify({ avatar: dataUrl })
  });
  myAvatar = dataUrl;
  avatarCache[user.toLowerCase()] = dataUrl;
  updateHeaderAvatar();
}

// ---------------------------------------------------------------------------
// Prijava / registracija
// ---------------------------------------------------------------------------
function lockApp(locked) {
  const overlay = $('loginOverlay');
  if (overlay) {
    overlay.style.display = locked ? 'flex' : 'none';
    overlay.setAttribute('aria-hidden', String(!locked));
  }
  document.body.classList.toggle('locked', locked);
}

function setAuthHint(message, isError) {
  const hint = $('authHint');
  if (!hint) return;
  hint.textContent = message;
  hint.style.color = isError ? '#f87171' : '';
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  if ($('loginTabBtn')) $('loginTabBtn').classList.toggle('active', isLogin);
  if ($('signupTabBtn')) $('signupTabBtn').classList.toggle('active', !isLogin);
  if ($('authTitle')) $('authTitle').textContent = isLogin ? 'Prijava' : 'Registracija';
  if ($('authSubmitBtn')) $('authSubmitBtn').textContent = isLogin ? 'Uđi' : 'Registruj se';
  setAuthHint(isLogin ? 'Prijavite se da nastavite.' : 'Kreirajte nalog da nastavite.', false);
}

function applyRoleUi() {
  const admin = isAdmin();
  const show = (id, visible, display = 'block') => { const n = $(id); if (n) n.style.display = visible ? display : 'none'; };
  show('announcementAdminBlock', admin);
  show('galleryAdminBlock', admin);
  show('matchForm', admin, '');
  show('matchAdminNotice', !admin);
}

async function onLoggedIn(user) {
  setCurrentUser(user.username);
  myAvatar = user.profileImage || '';
  avatarCache[user.username.toLowerCase()] = myAvatar;
  lockApp(false);
  updateHeaderAvatar();
  applyRoleUi();
  showView('announcements');
}

function logOut() {
  setCurrentUser('');
  myAvatar = '';
  lastChatSignature = '';
  stopChatRefresh();
  closeMenu();
  updateHeaderAvatar();
  applyRoleUi();
  lockApp(true);
  setAuthMode('login');
}

// ---------------------------------------------------------------------------
// Navigacija
// ---------------------------------------------------------------------------
const VIEWS = {
  announcements: 'viewAnnouncements',
  chat: 'viewChat',
  gallery: 'viewGallery',
  termini: 'viewTermini',
  matches: 'viewMatches',
  matchDetail: 'viewMatchDetail'
};

function closeMenu() {
  const list = $('menuList');
  if (list) list.classList.remove('show');
  const btn = $('menuBtn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function showView(name) {
  if (!VIEWS[name]) name = 'announcements';
  currentView = name;
  Object.keys(VIEWS).forEach(key => {
    const panel = $(VIEWS[key]);
    if (panel) panel.classList.toggle('active', key === name);
  });
  closeMenu();

  if (name === 'chat') startChatRefresh(); else stopChatRefresh();
  if (name === 'announcements') renderAnnouncements();
  if (name === 'gallery') renderGallery();
  if (name === 'matches') renderMatches();
  if (name === 'matchDetail') renderMatchDetail();
}

// ---------------------------------------------------------------------------
// Obavijesti
// ---------------------------------------------------------------------------
async function renderAnnouncements() {
  const list = $('announcements');
  if (!list) return;
  try {
    const items = await fetchJson(API_BASE + '/announcements');
    list.innerHTML = '';
    if (!Array.isArray(items) || !items.length) {
      list.appendChild(h('li', 'chat-empty', 'Trenutno nema novih obavijesti.'));
      return;
    }
    items.forEach(item => {
      const li = h('li', 'announcement');
      li.appendChild(h('div', 'meta', `${item.author || 'Admin'} · ${formatRelativeTime(item.ts)}`));
      const body = h('div', '', [item.title, item.content].filter(Boolean).join('\n'));
      body.style.whiteSpace = 'pre-wrap';
      body.style.overflowWrap = 'anywhere';
      li.appendChild(body);

      if (isAdmin()) {
        const del = h('button', 'btn secondary small', 'Obriši');
        del.type = 'button';
        del.style.marginTop = '10px';
        del.addEventListener('click', async () => {
          if (!confirm('Obrisati ovu obavijest?')) return;
          try {
            await fetchJson(API_BASE + '/announcements/' + encodeURIComponent(item.id), { method: 'DELETE' });
            renderAnnouncements();
          } catch (err) {
            alert('Brisanje nije uspjelo: ' + err.message);
          }
        });
        li.appendChild(del);
      }
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = '';
    list.appendChild(h('li', 'chat-empty', 'Nije moguće učitati obavijesti. ' + err.message));
  }
}

// ---------------------------------------------------------------------------
// Galerija
// ---------------------------------------------------------------------------
async function saveGalleryItem(item, withImage) {
  try {
    await fetchJson(API_BASE + '/gallery', {
      method: 'POST',
      body: JSON.stringify(withImage ? item : { ...item, image: '' })
    });
  } catch (err) {
    alert('Spremanje nije uspjelo: ' + err.message);
  }
}

function buildGalleryCard(item) {
  const card = h('article', 'gallery-card');

  const img = document.createElement('img');
  img.className = 'gallery-image';
  img.src = item.image;
  img.alt = item.description || 'Galerija slika';

  const body = h('div', 'gallery-body');
  body.appendChild(h('div', 'gallery-meta', `${item.author || 'Admin'} · ${formatRelativeTime(item.ts)}`));
  body.appendChild(h('p', 'gallery-description', item.description || 'Bez opisa.'));

  const actions = h('div', 'gallery-actions');
  const likeBtn = h('button', 'gallery-action', `👍 ${Number(item.likes || 0)}`);
  likeBtn.type = 'button';
  likeBtn.addEventListener('click', async () => {
    item.likes = Number(item.likes || 0) + 1;
    likeBtn.textContent = `👍 ${item.likes}`;
    await saveGalleryItem(item, false);
  });
  const dislikeBtn = h('button', 'gallery-action', `👎 ${Number(item.dislikes || 0)}`);
  dislikeBtn.type = 'button';
  dislikeBtn.addEventListener('click', async () => {
    item.dislikes = Number(item.dislikes || 0) + 1;
    dislikeBtn.textContent = `👎 ${item.dislikes}`;
    await saveGalleryItem(item, false);
  });
  actions.append(likeBtn, dislikeBtn);

  const commentsList = h('div', 'gallery-comments');
  const addCommentRow = (comment) => {
    const row = h('div', 'gallery-comment');
    row.appendChild(h('strong', '', (comment.user || 'Korisnik') + ': '));
    row.appendChild(document.createTextNode(comment.text || ''));
    commentsList.appendChild(row);
  };
  (Array.isArray(item.comments) ? item.comments : []).forEach(addCommentRow);

  const commentWrap = h('div', 'gallery-comment-wrap');
  const commentInput = document.createElement('input');
  commentInput.type = 'text';
  commentInput.placeholder = 'Dodaj komentar...';
  commentInput.maxLength = 200;
  commentInput.className = 'gallery-comment-input';
  const commentBtn = h('button', 'btn secondary small', 'Komentiraj');
  commentBtn.type = 'button';
  commentBtn.addEventListener('click', async () => {
    const text = (commentInput.value || '').trim();
    if (!text) return;
    item.comments = Array.isArray(item.comments) ? item.comments : [];
    const comment = { user: currentUser() || 'Korisnik', text, ts: Date.now() };
    item.comments.push(comment);
    addCommentRow(comment);
    commentInput.value = '';
    await saveGalleryItem(item, false);
  });
  commentWrap.append(commentInput, commentBtn);

  body.append(actions, commentWrap, commentsList);
  card.append(img, body);
  return card;
}

async function renderGallery() {
  const feed = $('galleryFeed');
  if (!feed) return;
  try {
    const items = await fetchJson(API_BASE + '/gallery');
    feed.innerHTML = '';
    if (!Array.isArray(items) || !items.length) {
      feed.appendChild(h('div', 'gallery-empty', 'Još nema slika u galeriji.'));
      return;
    }
    items.forEach(item => feed.appendChild(buildGalleryCard(item)));
  } catch (err) {
    feed.innerHTML = '';
    feed.appendChild(h('div', 'gallery-empty', 'Nije moguće učitati galeriju. ' + err.message));
  }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
function startChatRefresh() {
  stopChatRefresh();
  renderChat();
  chatTimer = setInterval(renderChat, 4000);
}

function stopChatRefresh() {
  if (chatTimer) {
    clearInterval(chatTimer);
    chatTimer = null;
  }
}

async function renderChat() {
  const container = $('chatMessages');
  if (!container || currentView !== 'chat') return;
  try {
    const messages = await fetchJson(API_BASE + '/chat');
    const signature = messages.map(m => m.id).join(',');
    if (signature === lastChatSignature) return;
    lastChatSignature = signature;

    container.innerHTML = '';
    if (!messages.length) {
      container.appendChild(h('li', 'chat-empty', 'Još nema poruka. Budite prvi!'));
      return;
    }

    const me = currentUser().toLowerCase();
    messages.forEach(msg => {
      const mine = String(msg.sender || '').toLowerCase() === me;
      const li = h('li', 'chat-message' + (mine ? ' own-message' : ''));

      const identity = h('div', 'chat-identity');
      const avatar = h('div', 'chat-avatar');
      fillAvatar(avatar, msg.sender || '?');
      identity.appendChild(avatar);

      const content = document.createElement('div');
      content.appendChild(h('div', 'meta', `${msg.sender} · ${formatRelativeTime(msg.ts)}`));
      if (msg.text) content.appendChild(h('div', 'msg', msg.text));
      if (msg.hasImage) {
        const img = document.createElement('img');
        img.className = 'chat-message-image';
        img.alt = 'Slika u poruci';
        img.loading = 'lazy';
        img.src = API_BASE + '/chat/' + encodeURIComponent(msg.id) + '/image';
        content.appendChild(img);
      }

      li.append(identity, content);
      container.appendChild(li);
    });
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('Greška pri učitavanju poruka:', err);
  }
}

function initChat() {
  const form = $('chatForm');
  const textEl = $('chatMessage');
  const imageEl = $('chatImage');
  const hint = $('chatImageHint');
  const defaultHint = hint ? hint.textContent : '';
  if (!form) return;

  if (imageEl && hint) {
    imageEl.addEventListener('change', () => {
      hint.textContent = imageEl.files[0]
        ? `Slika odabrana: ${imageEl.files[0].name}. Kliknite „Pošalji“.`
        : defaultHint;
    });
  }

  if (textEl) {
    textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser()) return;
    const text = (textEl ? textEl.value : '').trim();
    const file = imageEl && imageEl.files[0];
    if (!text && !file) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      let image = '';
      if (file) image = await fileToResizedDataUrl(file, 1024, 'image/jpeg', 0.8);
      await fetchJson(API_BASE + '/chat', {
        method: 'POST',
        body: JSON.stringify({ sender: currentUser(), text, image, ts: Date.now() })
      });
      if (textEl) textEl.value = '';
      if (imageEl) imageEl.value = '';
      if (hint) hint.textContent = defaultHint;
      lastChatSignature = '';
      renderChat();
    } catch (err) {
      alert('Nije moguće poslati poruku: ' + err.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Utakmice
// ---------------------------------------------------------------------------
async function loadMatches() {
  const data = await fetchJson(API_BASE + '/matches');
  return Array.isArray(data) ? data : [];
}

async function loadTeams() {
  const data = await fetchJson(API_BASE + '/teams');
  return data && typeof data === 'object' ? data : {};
}

async function upsertMatch(match) {
  if (!isAdmin()) return false;
  try {
    await fetchJson(API_BASE + '/matches', { method: 'POST', body: JSON.stringify(match) });
    return true;
  } catch (err) {
    alert('Utakmica nije spremljena: ' + err.message);
    return false;
  }
}

async function deleteMatch(id) {
  if (!isAdmin()) return false;
  try {
    await fetchJson(API_BASE + '/matches/' + encodeURIComponent(id), { method: 'DELETE' });
    return true;
  } catch (err) {
    alert('Brisanje nije uspjelo: ' + err.message);
    return false;
  }
}

async function saveTeam(name, badge) {
  if (!isAdmin()) return false;
  try {
    await fetchJson(API_BASE + '/teams', { method: 'POST', body: JSON.stringify({ [name]: badge }) });
    return true;
  } catch (err) {
    alert('Tim nije spremljen: ' + err.message);
    return false;
  }
}

function teamLabel(name, teams) {
  const span = h('span');
  const badge = name === CLUB_NAME ? (teams[name] || CLUB_BADGE) : teams[name];
  if (badge) {
    const img = document.createElement('img');
    img.className = 'team-badge';
    img.alt = '';
    img.src = badge;
    span.appendChild(img);
  }
  span.appendChild(document.createTextNode(name));
  return span;
}

function showResultInputs(row, match) {
  const actions = row.querySelector('.match-actions');
  actions.innerHTML = '';
  const homeName = match.location === 'home' ? CLUB_NAME : match.opponent;
  const awayName = match.location === 'home' ? match.opponent : CLUB_NAME;

  const wrap = h('div', 'result-inputs');
  const homeInput = document.createElement('input');
  homeInput.type = 'number';
  homeInput.min = 0;
  homeInput.placeholder = homeName;
  const awayInput = document.createElement('input');
  awayInput.type = 'number';
  awayInput.min = 0;
  awayInput.placeholder = awayName;
  const save = h('button', 'small', 'Spremi');
  save.type = 'button';
  const cancel = h('button', 'small', 'Odustani');
  cancel.type = 'button';

  wrap.append(homeInput, document.createTextNode('-'), awayInput, save, cancel);
  actions.appendChild(wrap);

  save.addEventListener('click', async () => {
    const homeScore = parseInt(homeInput.value, 10);
    const awayScore = parseInt(awayInput.value, 10);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return alert('Unesite oba rezultata.');
    if (await upsertMatch({ ...match, played: true, homeScore, awayScore })) renderMatches();
  });
  cancel.addEventListener('click', renderMatches);
}

function buildMatchItem(it, teams) {
  const row = h('div', 'match-item clickable');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.addEventListener('click', (e) => {
    if (e.target.closest('button, input')) return;
    openMatchDetail(it.id);
  });
  row.addEventListener('keydown', (e) => {
    if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openMatchDetail(it.id);
    }
  });
  const left = document.createElement('div');
  const homeName = it.location === 'home' ? CLUB_NAME : it.opponent;
  const awayName = it.location === 'home' ? it.opponent : CLUB_NAME;

  const title = document.createElement('strong');
  title.appendChild(teamLabel(homeName, teams));
  title.appendChild(document.createTextNode(it.played ? `  ${it.homeScore} - ${it.awayScore}  ` : '  vs  '));
  title.appendChild(teamLabel(awayName, teams));

  const when = new Date(it.datetime).toLocaleString('bs-BA');
  const parts = [when];
  if (!it.played) parts.push(it.location === 'home' ? 'Kući' : 'Gostujuća');
  if (it.competition) parts.push(it.competition);
  if (it.generation) parts.push(it.generation);
  left.append(title, h('div', 'match-meta', parts.join(' • ')), h('div', 'match-open-hint', 'Detalji ›'));

  const actions = h('div', 'match-actions');
  if (isAdmin()) {
    if (!it.played) {
      const play = h('button', 'small', 'Unesi rezultat');
      play.type = 'button';
      play.addEventListener('click', () => showResultInputs(row, it));
      actions.appendChild(play);
    }
    const del = h('button', 'small', 'Obriši');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm('Obrisati ovu utakmicu?')) return;
      if (await deleteMatch(it.id)) renderMatches();
    });
    actions.appendChild(del);
  }

  row.append(left, actions);
  return row;
}

function populateOpponentSelect(teams) {
  const sel = $('opponentSelect');
  if (!sel) return;
  const previous = sel.value;
  sel.innerHTML = '';
  const choose = h('option', '', 'Odaberi postojeći tim...');
  choose.value = '';
  sel.appendChild(choose);
  Object.keys(teams).filter(name => name !== CLUB_NAME).forEach(name => {
    const o = h('option', '', name);
    o.value = name;
    sel.appendChild(o);
  });
  const add = h('option', '', 'Dodaj novi tim...');
  add.value = '__new';
  sel.appendChild(add);
  if ([...sel.options].some(o => o.value === previous)) sel.value = previous;
}

async function renderMatches() {
  const upcomingList = $('upcomingList');
  const resultsList = $('resultsList');
  if (!upcomingList || !resultsList) return;
  applyRoleUi();

  let items;
  let teams;
  try {
    [items, teams] = await Promise.all([loadMatches(), loadTeams()]);
  } catch (err) {
    upcomingList.innerHTML = '';
    resultsList.innerHTML = '';
    upcomingList.appendChild(h('div', 'match-meta', 'Nije moguće učitati utakmice. ' + err.message));
    return;
  }

  populateOpponentSelect(teams);
  upcomingList.innerHTML = '';
  resultsList.innerHTML = '';

  const upcoming = items.filter(m => !m.played).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const results = items
    .filter(m => m.played && m.generation === activeGeneration)
    .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

  upcoming.forEach(m => upcomingList.appendChild(buildMatchItem(m, teams)));
  results.forEach(m => resultsList.appendChild(buildMatchItem(m, teams)));

  if (!upcoming.length) upcomingList.appendChild(h('div', 'match-meta', 'Nema predstojećih utakmica.'));
  if (!results.length) resultsList.appendChild(h('div', 'match-meta', 'Još nema rezultata za ovu generaciju.'));
}

function initMatches() {
  const form = $('matchForm');
  if (!form) return;

  const select = $('opponentSelect');
  if (select) {
    select.addEventListener('change', () => {
      const box = $('newTeam');
      if (box) box.style.display = select.value === '__new' ? 'block' : 'none';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isAdmin()) return;

    let opponent = select.value;
    const datetime = $('datetime').value;
    if (!datetime) return alert('Unesite datum i vrijeme.');

    if (opponent === '__new' || opponent === '') {
      const newName = $('newOpponent').value.trim();
      if (!newName) return alert('Unesite naziv novog tima.');
      const badgeFile = $('newBadge').files[0];
      let badge = '';
      if (badgeFile) {
        try { badge = await fileToResizedDataUrl(badgeFile, 160, 'image/png'); } catch (err) { badge = ''; }
      }
      if (!(await saveTeam(newName, badge))) return;
      opponent = newName;
    }

    const match = {
      id: 'm_' + Date.now(),
      opponent,
      datetime,
      location: $('location').value,
      competition: $('competition').value.trim(),
      generation: $('generation').value,
      played: false
    };

    if (await upsertMatch(match)) {
      form.reset();
      $('newTeam').style.display = 'none';
      renderMatches();
    }
  });

  const clear = $('clearMatches');
  if (clear) {
    clear.addEventListener('click', () => {
      form.reset();
      $('newTeam').style.display = 'none';
    });
  }

  // Tabovi
  const tabUpcoming = $('tabUpcoming');
  const tabResults = $('tabResultsBtn');
  const panelUpcoming = $('panelUpcoming');
  const panelResults = $('panelResults');
  const showPanel = (which) => {
    const up = which === 'upcoming';
    panelUpcoming.style.display = up ? 'block' : 'none';
    panelResults.style.display = up ? 'none' : 'block';
    tabUpcoming.classList.toggle('active', up);
    tabResults.classList.toggle('active', !up);
  };
  if (tabUpcoming && tabResults && panelUpcoming && panelResults) {
    tabUpcoming.addEventListener('click', () => showPanel('upcoming'));
    tabResults.addEventListener('click', () => showPanel('results'));
  }

  // Filter generacija za rezultate
  document.querySelectorAll('.generation-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeGeneration = btn.dataset.generation;
      document.querySelectorAll('.generation-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderMatches();
    });
  });
}

// ---------------------------------------------------------------------------
// Detalji utakmice
// ---------------------------------------------------------------------------
let currentMatchId = null;

function openMatchDetail(id) {
  currentMatchId = id;
  showView('matchDetail');
  window.scrollTo(0, 0);
}

// "club" = ORK Rudar, "opp" = protivnik (ne mijenja se kad se promijeni domaćin/gost)
function matchSides(m) {
  return m.location === 'home' ? { home: 'club', away: 'opp' } : { home: 'opp', away: 'club' };
}

function matchTeamInfo(m, teams) {
  return {
    club: { name: CLUB_NAME, badge: teams[CLUB_NAME] || CLUB_BADGE },
    opp: { name: m.opponent, badge: teams[m.opponent] || '' }
  };
}

function clubOppScore(m) {
  const homeIsClub = m.location === 'home';
  return {
    club: Number(homeIsClub ? m.homeScore : m.awayScore) || 0,
    opp: Number(homeIsClub ? m.awayScore : m.homeScore) || 0
  };
}

function formatDate(dt) {
  const x = new Date(dt);
  return isNaN(x) ? '' : x.toLocaleDateString('bs-BA');
}

function formatTime(dt) {
  const x = new Date(dt);
  return isNaN(x) ? '' : x.toLocaleTimeString('bs-BA', { hour: '2-digit', minute: '2-digit' });
}

function mdCard(title) {
  const card = h('div', 'md-card');
  card.appendChild(h('div', 'md-card-title', title));
  card.appendChild(h('div', 'md-card-body'));
  return card;
}

function heroTeam(key, info, timeoutsUsed, showTimeouts) {
  const box = h('div', 'md-team');
  const team = info[key];
  if (team.badge) {
    const img = document.createElement('img');
    img.src = team.badge;
    img.alt = '';
    box.appendChild(img);
  } else {
    box.appendChild(h('div', 'md-team-initial', (team.name || '?').charAt(0).toUpperCase()));
  }
  box.appendChild(h('div', 'md-team-name', team.name));
  if (showTimeouts) {
    const to = h('div', 'md-timeouts');
    to.appendChild(document.createTextNode('TIMEOUTI:'));
    for (let i = 0; i < 3; i++) to.appendChild(h('span', 'md-dot' + (i < timeoutsUsed ? ' used' : '')));
    box.appendChild(to);
  }
  return box;
}

function buildMatchHero(m, teams) {
  const d = m.details || {};
  const sides = matchSides(m);
  const info = matchTeamInfo(m, teams);
  const hero = h('div', 'md-hero');

  const tags = h('div', 'md-tags');
  [m.generation, m.competition, `${formatDate(m.datetime)} · ${formatTime(m.datetime)}`]
    .filter(Boolean)
    .forEach(t => tags.appendChild(h('span', 'md-tag', t)));
  hero.appendChild(tags);

  const timeoutsOf = (key) => Number(key === 'club' ? d.timeoutsClub : d.timeoutsOpp) || 0;
  const halfOf = (key) => (key === 'club' ? d.halfClub : d.halfOpp);

  const line = h('div', 'md-scoreline');
  line.appendChild(heroTeam(sides.home, info, timeoutsOf(sides.home), m.played));

  const score = h('div', 'md-score');
  if (m.played) {
    score.appendChild(h('div', '', `${m.homeScore} : ${m.awayScore}`));
    const hh = halfOf(sides.home);
    const ha = halfOf(sides.away);
    if (hh != null && ha != null) score.appendChild(h('small', '', `(${hh}:${ha})`));
  } else {
    score.appendChild(h('div', '', 'vs'));
  }
  line.appendChild(score);
  line.appendChild(heroTeam(sides.away, info, timeoutsOf(sides.away), m.played));
  hero.appendChild(line);

  if (d.venue) hero.appendChild(h('div', 'md-venue', '📍 ' + d.venue));
  return hero;
}

function buildMatchInfo(m) {
  const box = h('div', 'md-info');
  [
    ['Datum', formatDate(m.datetime)],
    ['Vrijeme', formatTime(m.datetime)],
    ['Takmičenje', m.competition || '—'],
    ['Uzrast', m.generation || '—']
  ].forEach(([label, value]) => {
    const cell = document.createElement('div');
    cell.appendChild(h('label', '', label));
    cell.appendChild(h('strong', '', value));
    box.appendChild(cell);
  });
  return box;
}

function buildHalvesCard(m, d, info) {
  const card = mdCard('GOLOVI PO POLUVREMENIMA');
  const body = card.querySelector('.md-card-body');
  const final = clubOppScore(m);

  const legend = h('div', 'md-legend');
  legend.appendChild(h('span', 'club', info.club.name));
  legend.appendChild(h('span', 'opp', info.opp.name));
  body.appendChild(legend);

  if (d.halfClub == null || d.halfOpp == null) {
    body.appendChild(h('div', 'md-empty', 'Rezultat poluvremena još nije unesen.'));
    return card;
  }

  const halves = [
    { title: '1. POLUVRIJEME', club: d.halfClub, opp: d.halfOpp },
    { title: '2. POLUVRIJEME', club: Math.max(0, final.club - d.halfClub), opp: Math.max(0, final.opp - d.halfOpp) }
  ];
  const wrap = h('div', 'md-halves');
  halves.forEach(half => {
    const col = document.createElement('div');
    col.appendChild(h('div', 'md-col-title', half.title));
    const max = Math.max(half.club, half.opp, 1);
    [['club', half.club], ['opp', half.opp]].forEach(([key, value]) => {
      const row = h('div', 'md-bar-row');
      row.appendChild(h('div', 'md-bar-val', String(value)));
      const bar = h('div', 'md-bar' + (key === 'opp' ? ' opp' : ''));
      const fill = document.createElement('span');
      fill.style.width = Math.round((value / max) * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      col.appendChild(row);
    });
    wrap.appendChild(col);
  });
  body.appendChild(wrap);
  return card;
}

function buildPlayerColumns(m, info, sides, entries, renderRight, emptyText) {
  const cols = h('div', 'md-cols');
  [sides.home, sides.away].forEach(key => {
    const col = h('div', key === 'opp' ? 'opp-col' : 'club-col');
    col.appendChild(h('div', 'md-col-title', info[key].name));
    const list = entries.filter(e => e.side === key);
    if (!list.length) col.appendChild(h('div', 'md-empty', emptyText));
    list.forEach(entry => {
      const row = h('div', 'md-player');
      row.appendChild(h('span', 'md-num', entry.number || ''));
      row.appendChild(h('span', 'md-pname', entry.name || '—'));
      renderRight(row, entry);
      col.appendChild(row);
    });
    cols.appendChild(col);
  });
  return cols;
}

function buildScorersCard(m, d, info, sides) {
  const card = mdCard('LISTA STRIJELACA');
  const scorers = (Array.isArray(d.scorers) ? d.scorers : []).slice().sort((a, b) => b.goals - a.goals);
  card.querySelector('.md-card-body').appendChild(
    buildPlayerColumns(m, info, sides, scorers, (row, e) => row.appendChild(h('span', 'md-val', String(e.goals))), 'Nema upisanih strijelaca.')
  );
  return card;
}

function buildSuspensionsCard(m, d, info, sides) {
  const card = mdCard('ISKLJUČENJA');
  const items = Array.isArray(d.suspensions) ? d.suspensions : [];
  card.querySelector('.md-card-body').appendChild(
    buildPlayerColumns(m, info, sides, items, (row, e) => {
      if (e.count) row.appendChild(h('span', 'md-val', `${e.count}× 2 min`));
      if (e.red) row.appendChild(h('span', 'md-tagmini', 'CRVENI'));
    }, 'Nema isključenja.')
  );
  return card;
}

// ----- Uređivanje detalja (samo admin) -----
function inputEl(className, type, value, placeholder, attrs = {}) {
  const el = document.createElement('input');
  el.className = className;
  el.type = type;
  if (value != null && value !== '') el.value = value;
  if (placeholder) el.placeholder = placeholder;
  Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
  return el;
}

function sideSelect(info, value) {
  const sel = document.createElement('select');
  [['club', info.club.name], ['opp', info.opp.name]].forEach(([key, label]) => {
    const o = h('option', '', label);
    o.value = key;
    sel.appendChild(o);
  });
  sel.value = value === 'opp' ? 'opp' : 'club';
  return sel;
}

function timeoutSelect(value) {
  const sel = document.createElement('select');
  [0, 1, 2, 3].forEach(n => {
    const o = h('option', '', String(n));
    o.value = String(n);
    sel.appendChild(o);
  });
  sel.value = String(Number(value) || 0);
  return sel;
}

function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function buildDetailsEditor(m, teams) {
  const d = m.details || {};
  const info = matchTeamInfo(m, teams);
  const final = clubOppScore(m);
  const card = mdCard('UREDI DETALJE (ADMIN)');
  const body = card.querySelector('.md-card-body');
  body.classList.add('md-editor');

  const lab = (text) => body.appendChild(h('label', 'md-lab', text));

  lab('Gol razlika na poluvremenu (golovi u 1. poluvremenu)');
  const halfRow = h('div', 'md-row');
  const halfClub = inputEl('in-small', 'number', d.halfClub, info.club.name.slice(0, 10), { min: 0 });
  const halfOpp = inputEl('in-small', 'number', d.halfOpp, info.opp.name.slice(0, 10), { min: 0 });
  halfRow.append(h('span', 'md-empty', info.club.name + ':'), halfClub, h('span', 'md-empty', info.opp.name + ':'), halfOpp);
  body.appendChild(halfRow);

  lab('Iskorišteni timeouti');
  const toRow = h('div', 'md-row');
  const toClub = timeoutSelect(d.timeoutsClub);
  const toOpp = timeoutSelect(d.timeoutsOpp);
  toRow.append(h('span', 'md-empty', info.club.name + ':'), toClub, h('span', 'md-empty', info.opp.name + ':'), toOpp);
  body.appendChild(toRow);

  lab('Dvorana / mjesto (opcionalno)');
  const venue = inputEl('in-name', 'text', d.venue || '', 'npr. SKC Banovići, Banovići', { maxlength: 80 });
  venue.style.width = '100%';
  body.appendChild(venue);

  // Strijelci
  lab('Strijelci');
  const scorerBox = document.createElement('div');
  body.appendChild(scorerBox);
  const sumNote = h('div', 'md-sum');

  const updateSum = () => {
    const sums = { club: 0, opp: 0 };
    scorerBox.querySelectorAll('.md-row').forEach(row => {
      sums[row.querySelector('select').value] += parseInt(row.querySelector('.in-goals').value, 10) || 0;
    });
    sumNote.textContent = `Zbir golova strijelaca: ${info.club.name} ${sums.club}/${final.club} · ${info.opp.name} ${sums.opp}/${final.opp}`;
    sumNote.classList.toggle('bad', sums.club !== final.club || sums.opp !== final.opp);
  };

  const addScorerRow = (data = {}) => {
    const row = h('div', 'md-row');
    const goals = inputEl('in-small in-goals', 'number', data.goals || 1, 'golovi', { min: 1, max: 99 });
    goals.addEventListener('input', updateSum);
    const sel = sideSelect(info, data.side);
    sel.addEventListener('change', updateSum);
    const remove = h('button', 'btn secondary small', '×');
    remove.type = 'button';
    remove.addEventListener('click', () => { row.remove(); updateSum(); });
    row.append(
      sel,
      inputEl('in-num in-number', 'text', data.number, 'br.', { maxlength: 4 }),
      inputEl('in-name in-pname', 'text', data.name, 'Ime i prezime', { maxlength: 60 }),
      goals,
      remove
    );
    scorerBox.appendChild(row);
    updateSum();
  };
  (Array.isArray(d.scorers) && d.scorers.length ? d.scorers : [{}]).forEach(addScorerRow);

  const addScorer = h('button', 'btn secondary small', '+ Dodaj strijelca');
  addScorer.type = 'button';
  addScorer.addEventListener('click', () => addScorerRow());
  body.append(addScorer, sumNote);

  // Isključenja
  lab('Isključenja');
  const suspBox = document.createElement('div');
  body.appendChild(suspBox);

  const addSuspRow = (data = {}) => {
    const row = h('div', 'md-row');
    const red = document.createElement('input');
    red.type = 'checkbox';
    red.className = 'in-red';
    red.checked = !!data.red;
    const redLabel = h('label', 'md-check');
    redLabel.append(red, document.createTextNode('Crveni'));
    const remove = h('button', 'btn secondary small', '×');
    remove.type = 'button';
    remove.addEventListener('click', () => row.remove());
    row.append(
      sideSelect(info, data.side),
      inputEl('in-num in-number', 'text', data.number, 'br.', { maxlength: 4 }),
      inputEl('in-name in-pname', 'text', data.name, 'Ime i prezime', { maxlength: 60 }),
      inputEl('in-small in-count', 'number', data.count != null ? data.count : 1, '2 min', { min: 0, max: 9 }),
      h('span', 'md-empty', '× 2 min'),
      redLabel,
      remove
    );
    suspBox.appendChild(row);
  };
  (Array.isArray(d.suspensions) ? d.suspensions : []).forEach(addSuspRow);

  const addSusp = h('button', 'btn secondary small', '+ Dodaj isključenje');
  addSusp.type = 'button';
  addSusp.addEventListener('click', () => addSuspRow());
  body.appendChild(addSusp);

  // Spremanje
  const actions = h('div', 'md-actions');
  const save = h('button', 'btn', 'Spremi detalje');
  save.type = 'button';
  actions.appendChild(save);
  body.appendChild(actions);

  save.addEventListener('click', async () => {
    const hc = intOrNull(halfClub.value);
    const ho = intOrNull(halfOpp.value);
    if ((hc == null) !== (ho == null)) return alert('Unesite golove u 1. poluvremenu za oba tima (ili ostavite oba prazna).');
    if (hc != null && (hc > final.club || ho > final.opp)) return alert('Golovi u 1. poluvremenu ne mogu biti veći od konačnog rezultata.');

    const collect = (box, extra) => [...box.querySelectorAll('.md-row')]
      .map(row => ({
        side: row.querySelector('select').value,
        number: row.querySelector('.in-number').value.trim(),
        name: row.querySelector('.in-pname').value.trim(),
        ...extra(row)
      }))
      .filter(x => x.name || x.number);

    const details = {
      venue: venue.value.trim(),
      halfClub: hc,
      halfOpp: ho,
      timeoutsClub: parseInt(toClub.value, 10) || 0,
      timeoutsOpp: parseInt(toOpp.value, 10) || 0,
      scorers: collect(scorerBox, row => ({ goals: parseInt(row.querySelector('.in-goals').value, 10) || 0 })).filter(x => x.goals > 0),
      suspensions: collect(suspBox, row => ({
        count: parseInt(row.querySelector('.in-count').value, 10) || 0,
        red: row.querySelector('.in-red').checked
      }))
    };

    save.disabled = true;
    const ok = await upsertMatch({ ...m, details });
    save.disabled = false;
    if (ok) renderMatchDetail();
  });

  return card;
}

async function renderMatchDetail() {
  const body = $('matchDetailBody');
  if (!body) return;
  body.innerHTML = '';
  body.appendChild(h('div', 'match-meta', 'Učitavanje...'));

  let items;
  let teams;
  try {
    [items, teams] = await Promise.all([loadMatches(), loadTeams()]);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(h('div', 'md-note', 'Nije moguće učitati utakmicu. ' + err.message));
    return;
  }

  const m = items.find(x => x.id === currentMatchId);
  body.innerHTML = '';
  if (!m) {
    body.appendChild(h('div', 'md-note', 'Utakmica nije pronađena (možda je obrisana).'));
    return;
  }

  const d = m.details || {};
  const info = matchTeamInfo(m, teams);
  const sides = matchSides(m);

  body.appendChild(buildMatchHero(m, teams));
  body.appendChild(buildMatchInfo(m));

  if (m.played) {
    const grid = h('div', 'md-grid');
    grid.appendChild(buildHalvesCard(m, d, info));
    grid.appendChild(buildScorersCard(m, d, info, sides));
    body.appendChild(grid);
    body.appendChild(buildSuspensionsCard(m, d, info, sides));
    if (isAdmin()) body.appendChild(buildDetailsEditor(m, teams));
  } else {
    body.appendChild(h('div', 'md-note', 'Strijelci, timeouti i isključenja bit će dostupni nakon što se upiše rezultat utakmice.'));
  }
}

// ---------------------------------------------------------------------------
// Pokretanje
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Prijava / registracija
  if ($('loginTabBtn')) $('loginTabBtn').addEventListener('click', () => setAuthMode('login'));
  if ($('signupTabBtn')) $('signupTabBtn').addEventListener('click', () => setAuthMode('signup'));

  const authForm = $('authForm');
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('authName').value.trim();
      const password = $('authPass').value.trim();
      if (!username || !password) return setAuthHint('Unesite ime i lozinku.', true);

      const submitBtn = $('authSubmitBtn');
      if (submitBtn) submitBtn.disabled = true;
      setAuthHint('', false);
      showLoader(true, 'Povezivanje sa serverom...');
      try {
        if (authMode === 'signup') {
          await fetchJson(API_BASE + '/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password })
          });
        }
        const res = await fetchJson(API_BASE + '/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        if (!res.ok || !res.user) throw new Error('Prijava nije uspjela.');
        authForm.reset();
        await onLoggedIn(res.user);
      } catch (err) {
        setAuthHint(err.message, true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
        showLoader(false);
      }
    });
  }

  // Meni
  const menuBtn = $('menuBtn');
  const menuList = $('menuList');
  if (menuBtn && menuList) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menuList.classList.toggle('show');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!menuList.contains(e.target) && e.target !== menuBtn) closeMenu();
    });
  }
  const nav = { announcementsBtn: 'announcements', chatBtn: 'chat', galleryBtn: 'gallery', terminiBtn: 'termini', matchesBtn: 'matches' };
  Object.keys(nav).forEach(id => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', () => showView(nav[id]));
  });
  if ($('logoutBtn')) $('logoutBtn').addEventListener('click', logOut);

  // Avatar
  const avatar = $('avatar');
  const upload = $('profileUpload');
  if (avatar && upload) {
    avatar.addEventListener('click', () => upload.click());
    avatar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); upload.click(); }
    });
    upload.addEventListener('change', async () => {
      const file = upload.files[0];
      if (!file) return;
      try {
        await saveAvatar(await fileToResizedDataUrl(file, 192));
      } catch (err) {
        alert('Slika profila nije spremljena: ' + err.message);
      }
      upload.value = '';
    });
  }
  if ($('removeAvatarBtn')) {
    $('removeAvatarBtn').addEventListener('click', async () => {
      try { await saveAvatar(''); } catch (err) { alert('Nije moguće ukloniti sliku: ' + err.message); }
    });
  }

  // Obavijesti (admin)
  const annForm = $('announcementForm');
  if (annForm) {
    annForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isAdmin()) return;
      const content = $('message').value.trim();
      if (!content) return;
      try {
        await fetchJson(API_BASE + '/announcements', {
          method: 'POST',
          body: JSON.stringify({ title: '', content, author: currentUser(), ts: Date.now() })
        });
        annForm.reset();
        renderAnnouncements();
      } catch (err) {
        alert('Obavijest nije objavljena: ' + err.message);
      }
    });
  }
  if ($('clearBtn')) $('clearBtn').addEventListener('click', () => { if ($('message')) $('message').value = ''; });

  // Galerija (admin)
  const galForm = $('galleryForm');
  if (galForm) {
    galForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isAdmin()) return;
      const file = $('galleryImage').files[0];
      if (!file) return;
      const btn = galForm.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        const image = await fileToResizedDataUrl(file, 1280, 'image/jpeg', 0.82);
        await fetchJson(API_BASE + '/gallery', {
          method: 'POST',
          body: JSON.stringify({
            id: 'gal_' + Date.now(),
            image,
            description: ($('galleryDescription').value || '').trim(),
            author: currentUser(),
            ts: Date.now(),
            likes: 0,
            dislikes: 0,
            comments: []
          })
        });
        galForm.reset();
        renderGallery();
      } catch (err) {
        alert('Slika nije objavljena: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // Klik na naziv kluba -> Obavijesti
  const brand = document.querySelector('.app-header .brand');
  if (brand) {
    brand.setAttribute('role', 'button');
    brand.tabIndex = 0;
    brand.addEventListener('click', () => { if (currentUser()) showView('announcements'); });
    brand.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && currentUser()) { e.preventDefault(); showView('announcements'); }
    });
  }

  // Povratak sa detalja utakmice
  if ($('matchDetailBack')) $('matchDetailBack').addEventListener('click', () => showView('matches'));

  initChat();
  initMatches();
  setAuthMode('login');

  // Početno stanje: ako je korisnik već prijavljen u ovom tabu, nastavi; inače traži prijavu
  const user = currentUser();
  if (user) {
    lockApp(false);
    updateHeaderAvatar();
    applyRoleUi();
    fetchAvatar(user).then(src => { myAvatar = src; updateHeaderAvatar(); });
    showView('announcements');
  } else {
    applyRoleUi();
    updateHeaderAvatar();
    lockApp(true);
  }
});
