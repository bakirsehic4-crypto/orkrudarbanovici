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
  matches: 'viewMatches'
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
  const row = h('div', 'match-item');
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
  left.append(title, h('div', 'match-meta', parts.join(' • ')));

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
