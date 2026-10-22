// ORK Rudar Banovići - glavna skripta (usklađena sa index.html)
'use strict';

const API_BASE = 'https://orkrudarbanovici-1.onrender.com/api';
const SESSION_USER_KEY = 'club_session_user';
const CLUB_NAME = 'ORK Rudar Banovići';
const CLUB_BADGE = 'rudar.png';

const PLAYER_POSITIONS = ['Golman', 'Lijevo krilo', 'Desno krilo', 'Lijevi vanjski', 'Srednji vanjski', 'Desni vanjski', 'Pivot'];
const PLAYER_GENERATIONS = ['2010/11', '2012/13', '2014/15', 'Mini Rukomet'];

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Stanje
// ---------------------------------------------------------------------------
let currentView = 'announcements';
let authMode = 'login';
let myAvatar = '';
let chatTimer = null;
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 18/10/2026
function formatDate(value) {
  const x = new Date(value);
  return isNaN(x) ? '' : `${pad2(x.getDate())}/${pad2(x.getMonth() + 1)}/${x.getFullYear()}`;
}

// 10:30
function formatTime(value) {
  const x = new Date(value);
  return isNaN(x) ? '' : `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - Number(ts)) / 1000);
  if (diff < 60) return 'Upravo sada';
  if (diff < 3600) return `Prije ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Prije ${Math.floor(diff / 3600)} h`;
  return formatDate(Number(ts));
}

let loaderDepth = 0;
let loaderTimer = null;

function revealLoader() {
  const loader = $('globalLoader');
  if (!loader) return;
  loader.hidden = false;
  loader.setAttribute('aria-busy', 'true');
}

// show=true/false dolaze u parovima. delay (ms) sprečava treperenje kad se nešto učita brzo.
function showLoader(show, text, delay = 0) {
  const loader = $('globalLoader');
  if (!loader) return;
  if (show) {
    loaderDepth++;
    if (text && $('globalLoaderText')) $('globalLoaderText').textContent = text;
    if (!loader.hidden) return;
    if (delay > 0) {
      if (!loaderTimer) {
        loaderTimer = setTimeout(() => {
          loaderTimer = null;
          if (loaderDepth > 0) revealLoader();
        }, delay);
      }
      return;
    }
    clearTimeout(loaderTimer);
    loaderTimer = null;
    revealLoader();
  } else {
    loaderDepth = Math.max(0, loaderDepth - 1);
    if (loaderDepth === 0) {
      clearTimeout(loaderTimer);
      loaderTimer = null;
      loader.hidden = true;
      loader.setAttribute('aria-busy', 'false');
    }
  }
}

async function withLoader(task, text = 'Podaci se učitavaju...') {
  showLoader(true, text, 250);
  try {
    return await task();
  } finally {
    showLoader(false);
  }
}

async function fetchJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  let res;
  try {
    if (method === 'GET') {
      // Obični GET bez posebnih zaglavlja: preglednik ne šalje dodatni OPTIONS upit (brže).
      // Ime korisnika ide kao ?u=
      const user = currentUser();
      const target = user ? url + (url.includes('?') ? '&' : '?') + 'u=' + encodeURIComponent(user) : url;
      res = await fetch(target, options);
    } else {
      res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          // encodeURIComponent: imena sa č, ć, š, đ, ž inače ruše fetch
          'X-Club-User': encodeURIComponent(currentUser()),
          ...(options.headers || {})
        }
      });
    }
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

// Slika profila se šalje kao obična slika (preglednik je pamti), ne kao dugačak tekst
function avatarUrl(name, version) {
  return API_BASE + '/avatar?name=' + encodeURIComponent(name) + '&v=' + (version || 0);
}

function fetchAvatar(name) {
  const key = name.toLowerCase();
  if (key in avatarCache) return Promise.resolve(avatarCache[key]);
  if (!avatarPending[key]) {
    avatarPending[key] = fetchJson(API_BASE + '/users/' + encodeURIComponent(name))
      .then(r => { avatarCache[key] = r.hasAvatar ? avatarUrl(r.username || name, r.avatarV) : ''; return avatarCache[key]; })
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
  const res = await fetchJson(API_BASE + '/users/' + encodeURIComponent(user) + '/avatar', {
    method: 'PUT',
    body: JSON.stringify({ avatar: dataUrl })
  });
  myAvatar = dataUrl ? avatarUrl(user, res.v) : '';
  avatarCache[user.toLowerCase()] = myAvatar;
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
  myAvatar = user.hasAvatar ? avatarUrl(user.username, user.avatarV) : '';
  avatarCache[user.username.toLowerCase()] = myAvatar;
  lockApp(false);
  updateHeaderAvatar();
  applyRoleUi();
  showView('announcements');
}

// Push notifikacije (OneSignal). Na iPhone-u rade samo kad je sajt dodan na početni ekran.
function enablePushNotifications() {
  closeMenu();
  const appId = window.ONESIGNAL_APP_ID || '';
  if (!appId || appId.indexOf('PASTE') === 0) {
    alert('Notifikacije još nisu podešene na sajtu.');
    return;
  }
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isIos && !standalone) {
    alert('Na iPhone-u prvo dodajte sajt na početni ekran (Dijeli > Dodaj na početni ekran), otvorite ga odatle pa ponovo odaberite "Uključi notifikacije".');
    return;
  }
  if (!('Notification' in window)) {
    alert('Ovaj preglednik ne podržava notifikacije.');
    return;
  }
  if (Notification.permission === 'denied') {
    alert('Notifikacije su blokirane. Dozvolite ih u postavkama preglednika/telefona za ovaj sajt.');
    return;
  }
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function (OneSignal) {
    try {
      await OneSignal.Notifications.requestPermission();
      if (!OneSignal.Notifications.permission) {
        alert('Dozvola za notifikacije nije data.');
        return;
      }
      try { await OneSignal.User.PushSubscription.optIn(); } catch (e) { /* ignore */ }
      // sačekaj da OneSignal napravi pretplatu (do 8 s)
      let subId = OneSignal.User.PushSubscription.id;
      for (let i = 0; i < 16 && !subId; i++) {
        await new Promise(r => setTimeout(r, 500));
        subId = OneSignal.User.PushSubscription.id;
      }
      if (subId) {
        alert('Notifikacije su uključene.');
      } else {
        alert('Dozvola je data, ali OneSignal nije napravio pretplatu. Provjerite Site URL u OneSignal postavkama i da je OneSignalSDKWorker.js dostupan na sajtu.' + (window.ONESIGNAL_INIT_ERROR ? '\n\nGreška: ' + window.ONESIGNAL_INIT_ERROR : ''));
      }
    } catch (e) {
      alert('Notifikacije nije moguće uključiti: ' + (e && e.message ? e.message : e));
    }
  });
}

function logOut() {
  setCurrentUser('');
  myAvatar = '';
  if (rec.active) stopRecording(false);
  stopChatRefresh();
  resetChatState();
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
  matchDetail: 'viewMatchDetail',
  players: 'viewPlayers',
  player: 'viewPlayer'
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

  if (name !== 'chat' && typeof rec !== 'undefined' && rec.active) stopRecording(false);
  if (name === 'chat') startChatRefresh(); else stopChatRefresh();
  if (name === 'announcements') renderAnnouncements();
  if (name === 'gallery') renderGallery();
  if (name === 'matches') renderMatches();
  if (name === 'matchDetail') renderMatchDetail();
  if (name === 'players') renderPlayersList();
  if (name === 'player') renderPlayerPage();
}

// ---------------------------------------------------------------------------
// Obavijesti
// ---------------------------------------------------------------------------
async function renderAnnouncements() {
  const list = $('announcements');
  if (!list) return;
  try {
    const items = await withLoader(() => fetchJson(API_BASE + '/announcements'));
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
// Povećanje slika (lightbox): zumiranje, pomjeranje, listanje
// ---------------------------------------------------------------------------
const lb = {
  root: null, stage: null, img: null, caption: null, counter: null, zoomLabel: null,
  prev: null, next: null,
  items: [], index: 0, scale: 1, x: 0, y: 0,
  pointers: new Map(), pinchDist: 0, moved: false, swipeStart: null, lastTap: 0
};

function lbClamp() {
  const W = lb.stage.clientWidth;
  const H = lb.stage.clientHeight;
  const maxX = Math.max(0, (lb.img.clientWidth * lb.scale - W) / 2);
  const maxY = Math.max(0, (lb.img.clientHeight * lb.scale - H) / 2);
  lb.x = Math.min(maxX, Math.max(-maxX, lb.x));
  lb.y = Math.min(maxY, Math.max(-maxY, lb.y));
}

function lbApply() {
  lbClamp();
  lb.img.style.transform = `translate(${lb.x}px, ${lb.y}px) scale(${lb.scale})`;
  lb.zoomLabel.textContent = Math.round(lb.scale * 100) + '%';
  lb.root.classList.toggle('zoomed', lb.scale > 1.01);
}

function lbZoomAt(cx, cy, newScale) {
  const rect = lb.stage.getBoundingClientRect();
  const target = Math.min(6, Math.max(1, newScale));
  const px = (cx - rect.left - rect.width / 2 - lb.x) / lb.scale;
  const py = (cy - rect.top - rect.height / 2 - lb.y) / lb.scale;
  lb.x = cx - rect.left - rect.width / 2 - px * target;
  lb.y = cy - rect.top - rect.height / 2 - py * target;
  lb.scale = target;
  if (target === 1) { lb.x = 0; lb.y = 0; }
  lbApply();
}

function lbZoomCenter(factor) {
  const rect = lb.stage.getBoundingClientRect();
  lbZoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, lb.scale * factor);
}

function lbShow(index) {
  const n = lb.items.length;
  if (!n) return;
  lb.index = (index + n) % n;
  const item = lb.items[lb.index];
  lb.scale = 1;
  lb.x = 0;
  lb.y = 0;
  lb.img.style.transform = '';
  lb.img.src = item.src;
  lb.caption.textContent = item.caption || '';
  lb.caption.style.display = item.caption ? '' : 'none';
  lb.counter.textContent = n > 1 ? `${lb.index + 1} / ${n}` : '';
  lb.prev.style.display = lb.next.style.display = n > 1 ? '' : 'none';
  lbApply();
  if (n > 1) {
    [lb.index + 1, lb.index - 1].forEach(i => { new Image().src = lb.items[(i + n) % n].src; });
  }
}

function closeLightbox() {
  if (!lb.root || lb.root.hidden) return;
  lb.root.hidden = true;
  document.body.classList.remove('lb-open');
  lb.img.removeAttribute('src');
}

function ensureLightbox() {
  if (lb.root) return;
  const mk = (cls, text, label) => {
    const b = h('button', cls, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  };

  const root = h('div', 'lightbox');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const stage = h('div', 'lb-stage');
  const img = document.createElement('img');
  img.className = 'lb-img';
  img.alt = '';
  img.draggable = false;
  stage.appendChild(img);

  const closeBtn = mk('lb-btn lb-close', '×', 'Zatvori');
  const prev = mk('lb-btn lb-nav lb-prev', '‹', 'Prethodna slika');
  const next = mk('lb-btn lb-nav lb-next', '›', 'Sljedeća slika');
  const counter = h('div', 'lb-counter');
  const caption = h('div', 'lb-caption');
  const zoomBar = h('div', 'lb-zoom');
  const zoomOut = mk('lb-btn', '−', 'Smanji');
  const zoomLabel = mk('lb-btn lb-zoom-label', '100%', 'Vrati na 100%');
  const zoomIn = mk('lb-btn', '+', 'Povećaj');
  zoomBar.append(zoomOut, zoomLabel, zoomIn);

  root.append(stage, closeBtn, prev, next, counter, caption, zoomBar);
  document.body.appendChild(root);
  Object.assign(lb, { root, stage, img, caption, counter, zoomLabel, prev, next });

  closeBtn.addEventListener('click', closeLightbox);
  prev.addEventListener('click', () => lbShow(lb.index - 1));
  next.addEventListener('click', () => lbShow(lb.index + 1));
  zoomIn.addEventListener('click', () => lbZoomCenter(1.4));
  zoomOut.addEventListener('click', () => lbZoomCenter(1 / 1.4));
  zoomLabel.addEventListener('click', () => { lb.scale = 1; lb.x = 0; lb.y = 0; lbApply(); });

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    lbZoomAt(e.clientX, e.clientY, lb.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
  }, { passive: false });

  const pointerDistance = () => {
    const [a, b] = [...lb.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    lb.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lb.moved = false;
    if (lb.pointers.size === 2) lb.pinchDist = pointerDistance();
    lb.swipeStart = lb.pointers.size === 1 ? { x: e.clientX, y: e.clientY } : null;
  });

  stage.addEventListener('pointermove', (e) => {
    const p = lb.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (lb.pointers.size === 2) {
      const [a, b] = [...lb.pointers.values()];
      const d = pointerDistance();
      if (lb.pinchDist) lbZoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, lb.scale * d / lb.pinchDist);
      lb.pinchDist = d;
      lb.moved = true;
      return;
    }
    if (lb.swipeStart && Math.hypot(e.clientX - lb.swipeStart.x, e.clientY - lb.swipeStart.y) > 8) lb.moved = true;
    if (lb.scale > 1.01) {
      lb.x += dx;
      lb.y += dy;
      lbApply();
    }
  });

  const pointerEnd = (e) => {
    const start = lb.swipeStart;
    lb.pointers.delete(e.pointerId);
    lb.pinchDist = 0;
    if (!start || lb.pointers.size > 0) { lb.swipeStart = null; return; }
    lb.swipeStart = null;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    if (lb.scale <= 1.01 && Math.abs(dx) > 60 && Math.abs(dy) < 60) {
      lbShow(lb.index + (dx < 0 ? 1 : -1));
      return;
    }
    if (lb.moved) return;

    // dodir / klik
    const overImage = document.elementFromPoint(e.clientX, e.clientY) === lb.img;
    if (!overImage && lb.scale <= 1.01) { closeLightbox(); return; }
    const now = Date.now();
    if (now - lb.lastTap < 300) {
      lbZoomAt(e.clientX, e.clientY, lb.scale > 1.01 ? 1 : 2.5);
      lb.lastTap = 0;
    } else {
      lb.lastTap = now;
    }
  };
  stage.addEventListener('pointerup', pointerEnd);
  stage.addEventListener('pointercancel', (e) => { lb.pointers.delete(e.pointerId); lb.pinchDist = 0; lb.swipeStart = null; });

  document.addEventListener('keydown', (e) => {
    if (lb.root.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') lbShow(lb.index + 1);
    else if (e.key === 'ArrowLeft') lbShow(lb.index - 1);
    else if (e.key === '+' || e.key === '=') lbZoomCenter(1.4);
    else if (e.key === '-') lbZoomCenter(1 / 1.4);
    else if (e.key === '0') { lb.scale = 1; lb.x = 0; lb.y = 0; lbApply(); }
  });
  window.addEventListener('resize', () => { if (!lb.root.hidden) lbApply(); });
}

// items: [{ src, caption }]
function openLightbox(items, index = 0) {
  if (!items || !items.length) return;
  ensureLightbox();
  lb.items = items;
  lb.root.hidden = false;
  document.body.classList.add('lb-open');
  lbShow(index);
}

// ---------------------------------------------------------------------------
// Galerija
// ---------------------------------------------------------------------------
let galleryItems = [];

// "Prije 5 min" za novo, a za starije 18/10/2026 10:30
function formatStamp(ts) {
  if (Date.now() - Number(ts) < 24 * 3600 * 1000) return formatRelativeTime(ts);
  return `${formatDate(ts)} ${formatTime(ts)}`;
}

function galleryImageUrl(id) {
  return API_BASE + '/gallery/' + encodeURIComponent(id) + '/image';
}

function buildGalleryCard(item, index) {
  const card = h('article', 'gallery-card');

  const img = document.createElement('img');
  img.className = 'gallery-image';
  img.loading = 'lazy';
  img.alt = item.description || 'Galerija slika';
  img.src = galleryImageUrl(item.id);
  img.title = 'Kliknite za povećanje';
  img.addEventListener('click', () => openLightbox(galleryItems, index));

  const body = h('div', 'gallery-body');
  body.appendChild(h('div', 'gallery-meta', `${item.author || 'Admin'} · ${formatStamp(item.ts)}`));
  if (item.description) body.appendChild(h('p', 'gallery-description', item.description));

  // --- reakcije: jedna po korisniku ---
  const actions = h('div', 'gallery-actions');
  const likeBtn = h('button', 'gallery-action');
  const dislikeBtn = h('button', 'gallery-action');
  likeBtn.type = dislikeBtn.type = 'button';
  const paint = () => {
    likeBtn.textContent = `👍 ${item.likes}`;
    dislikeBtn.textContent = `👎 ${item.dislikes}`;
    likeBtn.classList.toggle('active', item.myReaction === 'like');
    dislikeBtn.classList.toggle('active', item.myReaction === 'dislike');
  };
  let busy = false;
  const react = async (value) => {
    if (busy) return;
    busy = true;
    const before = { likes: item.likes, dislikes: item.dislikes, my: item.myReaction };
    const next = item.myReaction === value ? '' : value;
    if (item.myReaction === 'like') item.likes--;
    if (item.myReaction === 'dislike') item.dislikes--;
    if (next === 'like') item.likes++;
    if (next === 'dislike') item.dislikes++;
    item.myReaction = next;
    paint();
    try {
      const res = await fetchJson(API_BASE + '/gallery/' + encodeURIComponent(item.id) + '/react', {
        method: 'POST',
        body: JSON.stringify({ value: next })
      });
      item.likes = res.likes;
      item.dislikes = res.dislikes;
      item.myReaction = res.myReaction || '';
    } catch (err) {
      item.likes = before.likes;
      item.dislikes = before.dislikes;
      item.myReaction = before.my;
      alert('Reakcija nije spremljena: ' + err.message);
    } finally {
      busy = false;
      paint();
    }
  };
  likeBtn.addEventListener('click', () => react('like'));
  dislikeBtn.addEventListener('click', () => react('dislike'));
  paint();
  actions.append(likeBtn, dislikeBtn);

  if (isAdmin()) {
    const del = h('button', 'gallery-action danger', 'Obriši sliku');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm('Obrisati ovu sliku (i sve komentare)?')) return;
      try {
        await fetchJson(API_BASE + '/gallery/' + encodeURIComponent(item.id), { method: 'DELETE' });
        renderGallery();
      } catch (err) {
        alert('Brisanje nije uspjelo: ' + err.message);
      }
    });
    actions.appendChild(del);
  }

  // --- komentari ---
  const commentsList = h('div', 'gallery-comments');
  const addCommentRow = (comment) => {
    const row = h('div', 'gallery-comment');
    const avatar = h('div', 'gal-avatar');
    fillAvatar(avatar, comment.user || '?');

    const content = h('div', 'gal-comment-body');
    const head = h('div', 'gal-comment-head');
    head.appendChild(h('strong', '', comment.user || 'Korisnik'));
    const when = h('span', 'gal-comment-time', formatStamp(comment.ts));
    when.title = `${formatDate(comment.ts)} ${formatTime(comment.ts)}`;
    head.appendChild(when);
    content.append(head, h('div', 'gal-comment-text', comment.text));
    row.append(avatar, content);

    const own = String(comment.user || '').toLowerCase() === currentUser().toLowerCase();
    if (isAdmin() || own) {
      const remove = h('button', 'gal-comment-del', '×');
      remove.type = 'button';
      remove.title = 'Obriši komentar';
      remove.addEventListener('click', async () => {
        if (!confirm('Obrisati komentar?')) return;
        try {
          await fetchJson(API_BASE + '/gallery/' + encodeURIComponent(item.id) + '/comments/' + encodeURIComponent(comment.id), { method: 'DELETE' });
          row.remove();
        } catch (err) {
          alert('Komentar nije obrisan: ' + err.message);
        }
      });
      row.appendChild(remove);
    }
    commentsList.appendChild(row);
  };
  (Array.isArray(item.comments) ? item.comments : []).forEach(addCommentRow);

  const commentWrap = h('div', 'gallery-comment-wrap');
  const commentInput = document.createElement('input');
  commentInput.type = 'text';
  commentInput.placeholder = 'Dodaj komentar...';
  commentInput.maxLength = 300;
  commentInput.className = 'gallery-comment-input';
  const commentBtn = h('button', 'btn secondary small', 'Komentiraj');
  commentBtn.type = 'button';
  const sendComment = async () => {
    const text = commentInput.value.trim();
    if (!text) return;
    commentBtn.disabled = true;
    try {
      const res = await fetchJson(API_BASE + '/gallery/' + encodeURIComponent(item.id) + '/comments', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      addCommentRow(res.comment);
      commentInput.value = '';
    } catch (err) {
      alert('Komentar nije objavljen: ' + err.message);
    } finally {
      commentBtn.disabled = false;
    }
  };
  commentBtn.addEventListener('click', sendComment);
  commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendComment(); }
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
    const items = await withLoader(() => fetchJson(API_BASE + '/gallery'));
    feed.innerHTML = '';
    const visible = (Array.isArray(items) ? items : []).filter(item => item.hasImage);
    if (!visible.length) {
      feed.appendChild(h('div', 'gallery-empty', 'Još nema slika u galeriji.'));
      galleryItems = [];
      return;
    }
    galleryItems = visible.map(item => ({ src: galleryImageUrl(item.id), caption: item.description || '' }));
    visible.forEach((item, index) => feed.appendChild(buildGalleryCard(item, index)));
  } catch (err) {
    feed.innerHTML = '';
    feed.appendChild(h('div', 'gallery-empty', 'Nije moguće učitati galeriju. ' + err.message));
  }
}

// ---------------------------------------------------------------------------
// Chat (kao na Instagramu: novo se vidi odmah, lista uvijek ide na kraj)
// ---------------------------------------------------------------------------
const chatState = { ids: new Set(), lastTs: 0, lastMsgTs: 0, lastSender: '', lastDay: '', loaded: false, loading: false, polling: false, stick: true, reply: null };

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayLabel(ts) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(ts) === dayKey(Date.now())) return 'Danas';
  if (dayKey(ts) === dayKey(yesterday.getTime())) return 'Jučer';
  return formatDate(ts);
}

function chatNearBottom() {
  const list = $('chatMessages');
  return !list || list.scrollHeight - list.scrollTop - list.clientHeight < 120;
}

function chatScrollToBottom() {
  const list = $('chatMessages');
  if (!list) return;
  list.scrollTop = list.scrollHeight;
  chatState.stick = true;
  if ($('chatJump')) $('chatJump').hidden = true;
}

function resetChatState() {
  chatState.ids.clear();
  Object.assign(chatState, { lastTs: 0, lastMsgTs: 0, lastSender: '', lastDay: '', loaded: false, loading: false, polling: false, stick: true, reply: null });
  renderReplyBar();
  if ($('chatMessages')) $('chatMessages').innerHTML = '';
  if ($('chatJump')) $('chatJump').hidden = true;
  if ($('chatTyping')) $('chatTyping').textContent = '';
}

let currentVoice = null;

function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

// Kratak opis poruke za citat / traku "Odgovor za ..."
function chatMessageLabel(msg) {
  if (msg.hasAudio) return '🎤 Glasovna poruka';
  if (msg.text) return msg.text.length > 80 ? msg.text.slice(0, 80) + '…' : msg.text;
  if (msg.hasImage) return '📷 Slika';
  return '';
}

function chatReplyLabel(reply) {
  if (reply.kind === 'voice') return '🎤 Glasovna poruka';
  if (reply.kind === 'image') return '📷 Slika';
  const text = String(reply.text || '');
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

function scrollToChatMessage(id) {
  const list = $('chatMessages');
  const li = list && [...list.children].find(node => node.dataset && node.dataset.id === id);
  if (!li) return;
  li.scrollIntoView({ block: 'center', behavior: 'smooth' });
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 1600);
}

function renderReplyBar() {
  const bar = $('chatReplyBar');
  if (!bar) return;
  const reply = chatState.reply;
  bar.innerHTML = '';
  bar.hidden = !reply;
  if (!reply) return;
  const text = h('div', 'chat-reply-text');
  text.append(h('strong', '', 'Odgovor za ' + reply.sender), h('span', '', reply.preview));
  const close = h('button', 'chat-hint-remove', '×');
  close.type = 'button';
  close.title = 'Odustani od odgovora';
  close.addEventListener('click', clearChatReply);
  bar.append(text, close);
}

function setChatReply(info) {
  chatState.reply = info;
  renderReplyBar();
  if ($('chatMessage')) $('chatMessage').focus();
}

function clearChatReply() {
  chatState.reply = null;
  renderReplyBar();
}

// Glasovna poruka: ▶ / ⏸, traka napretka (može se kliknuti za premotavanje) i trajanje
function buildVoicePlayer(src, durationMs) {
  const wrap = h('div', 'voice-player');
  const btn = h('button', 'voice-btn', '▶');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Pusti glasovnu poruku');
  const track = h('div', 'voice-track');
  const fill = h('div', 'voice-fill');
  track.appendChild(fill);
  const time = h('span', 'voice-time', formatDuration(durationMs));
  wrap.append(btn, track, time);

  const audio = new Audio();
  audio.preload = 'none';
  audio.src = src;
  const total = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (durationMs || 0) / 1000);

  audio.addEventListener('play', () => { btn.textContent = '⏸'; });
  audio.addEventListener('pause', () => { btn.textContent = '▶'; });
  audio.addEventListener('ended', () => {
    btn.textContent = '▶';
    fill.style.width = '0%';
    time.textContent = formatDuration(durationMs);
  });
  audio.addEventListener('timeupdate', () => {
    const t = total();
    if (t > 0) fill.style.width = Math.min(100, (audio.currentTime / t) * 100) + '%';
    time.textContent = formatDuration(audio.currentTime * 1000);
  });
  audio.addEventListener('error', () => { time.textContent = '⚠'; });

  btn.addEventListener('click', () => {
    if (!audio.paused) { audio.pause(); return; }
    if (currentVoice && currentVoice !== audio) currentVoice.pause();
    currentVoice = audio;
    audio.play().catch(() => alert('Ova glasovna poruka se ne može reproducirati na ovom uređaju.'));
  });
  track.addEventListener('click', (e) => {
    const rect = track.getBoundingClientRect();
    const t = total();
    if (rect.width && t) audio.currentTime = ((e.clientX - rect.left) / rect.width) * t;
  });
  return wrap;
}

function appendChatMessage(msg, opts = {}) {
  const list = $('chatMessages');
  if (!list) return null;
  const empty = list.querySelector('.chat-empty');
  if (empty) empty.remove();

  const mine = String(msg.sender || '').toLowerCase() === currentUser().toLowerCase();

  const day = dayKey(msg.ts);
  if (day !== chatState.lastDay) {
    list.appendChild(h('li', 'chat-day', dayLabel(msg.ts)));
    chatState.lastDay = day;
    chatState.lastSender = '';
  }
  const grouped = chatState.lastSender === msg.sender && (msg.ts - chatState.lastMsgTs) < 5 * 60 * 1000;
  chatState.lastSender = msg.sender;
  chatState.lastMsgTs = msg.ts;

  const li = h('li', 'chat-message' + (mine ? ' own-message' : '') + (grouped ? ' grouped' : '') + (opts.pending ? ' pending' : ''));
  li.dataset.id = msg.id;

  if (!mine) {
    const identity = h('div', 'chat-identity');
    const avatar = h('div', 'chat-avatar' + (grouped ? ' ghost' : ''));
    if (!grouped) fillAvatar(avatar, msg.sender || '?');
    identity.appendChild(avatar);
    li.appendChild(identity);
  }

  const body = h('div', 'chat-body');
  if (!mine && !grouped) body.appendChild(h('div', 'meta', msg.sender));

  if (msg.reply) {
    const quote = h('div', 'chat-quote');
    quote.append(h('strong', '', msg.reply.sender), h('span', '', chatReplyLabel(msg.reply)));
    quote.title = 'Idi na poruku';
    quote.addEventListener('click', () => scrollToChatMessage(msg.reply.id));
    body.appendChild(quote);
  }

  if (msg.text) body.appendChild(h('div', 'msg', msg.text));

  const audioSrc = opts.localAudio || (msg.hasAudio ? API_BASE + '/chat/' + encodeURIComponent(msg.id) + '/audio' : '');
  if (audioSrc) {
    const bubble = h('div', 'msg voice-msg');
    bubble.appendChild(buildVoicePlayer(audioSrc, msg.audioMs));
    body.appendChild(bubble);
  }

  const src = opts.localImage || (msg.hasImage ? API_BASE + '/chat/' + encodeURIComponent(msg.id) + '/image' : '');
  if (src) {
    const img = document.createElement('img');
    img.className = 'chat-message-image';
    img.alt = 'Slika u poruci';
    img.src = src;
    img.addEventListener('load', () => { if (chatState.stick) chatScrollToBottom(); });
    img.addEventListener('click', () => openLightbox([{ src, caption: msg.text || '' }], 0));
    body.appendChild(img);
  }
  body.appendChild(h('div', 'chat-time', formatTime(msg.ts)));
  li.appendChild(body);

  const replyBtn = h('button', 'chat-reply-btn', '↩');
  replyBtn.type = 'button';
  replyBtn.title = 'Odgovori';
  replyBtn.setAttribute('aria-label', 'Odgovori na poruku');
  replyBtn.addEventListener('click', () => setChatReply({ id: msg.id, sender: msg.sender, preview: chatMessageLabel(msg) }));
  li.appendChild(replyBtn);

  list.appendChild(li);
  return li;
}

function ingestChat(messages, forceScroll) {
  const wasNear = chatNearBottom();
  let added = 0;
  let addedMine = false;
  const me = currentUser().toLowerCase();
  const list = $('chatMessages');

  messages.forEach(msg => {
    chatState.lastTs = Math.max(chatState.lastTs, Number(msg.ts) || 0);
    if (chatState.ids.has(msg.id)) {
      // poruka koju smo mi poslali: potvrdi je (sklanja "šalje se")
      const li = [...list.children].find(node => node.dataset && node.dataset.id === msg.id);
      if (li && li.classList.contains('pending')) {
        li.classList.remove('pending');
        const foot = li.querySelector('.chat-time');
        if (foot) foot.textContent = formatTime(msg.ts);
      }
      return;
    }
    chatState.ids.add(msg.id);
    appendChatMessage(msg);
    added++;
    if (String(msg.sender || '').toLowerCase() === me) addedMine = true;
  });

  if (!added) return;
  if (forceScroll || wasNear || addedMine) {
    chatScrollToBottom();
  } else if ($('chatJump')) {
    $('chatJump').hidden = false;
  }
}

// "... is typing" indikator
const TYPING_TEXT = { one: 'is typing', many: 'are typing', several: 'Several people are typing' };
const typingState = { polling: false, lastPing: 0, sentTyping: false };

function renderTyping(names) {
  const box = $('chatTyping');
  if (!box) return;
  box.textContent = '';
  if (!names || !names.length) return;
  let label;
  if (names.length === 1) label = names[0] + ' ' + TYPING_TEXT.one;
  else if (names.length === 2) label = names[0] + ' and ' + names[1] + ' ' + TYPING_TEXT.many;
  else label = TYPING_TEXT.several;
  box.append(document.createTextNode(label));
  const dots = h('span', 'typing-dots');
  dots.append(h('i'), h('i'), h('i'));
  box.appendChild(dots);
}

async function pollTyping() {
  if (typingState.polling || !chatState.loaded || currentView !== 'chat' || document.hidden || !currentUser()) return;
  typingState.polling = true;
  try {
    const data = await fetchJson(API_BASE + '/chat/typing');
    renderTyping(Array.isArray(data.typing) ? data.typing : []);
  } catch (err) {
    /* nije kritično */
  } finally {
    typingState.polling = false;
  }
}

function pingTyping(isTyping) {
  if (!currentUser()) return;
  const now = Date.now();
  if (isTyping) {
    if (now - typingState.lastPing < 2500) return;
    typingState.lastPing = now;
    typingState.sentTyping = true;
  } else {
    if (!typingState.sentTyping) return;
    typingState.sentTyping = false;
    typingState.lastPing = 0;
  }
  fetchJson(API_BASE + '/chat/typing', { method: 'POST', body: JSON.stringify({ typing: isTyping }) }).catch(() => {});
}

async function pollChat() {
  if (chatState.polling || !chatState.loaded || currentView !== 'chat' || document.hidden) return;
  chatState.polling = true;
  try {
    const messages = await fetchJson(API_BASE + '/chat?since=' + chatState.lastTs);
    if (Array.isArray(messages)) ingestChat(messages, false);
  } catch (err) {
    console.error('Osvježavanje chata nije uspjelo:', err);
  } finally {
    chatState.polling = false;
  }
}

function stopChatRefresh() {
  pingTyping(false);
  if ($('chatTyping')) $('chatTyping').textContent = '';
  if (chatTimer) {
    clearInterval(chatTimer);
    chatTimer = null;
  }
}

async function startChatRefresh() {
  stopChatRefresh();
  const list = $('chatMessages');
  if (!list) return;

  if (!chatState.loaded) {
    if (chatState.loading) return;
    chatState.loading = true;
    try {
      const messages = await withLoader(() => fetchJson(API_BASE + '/chat'));
      resetChatState();
      chatState.loading = true;
      if (!messages.length) list.appendChild(h('li', 'chat-empty', 'Još nema poruka. Budite prvi!'));
      ingestChat(messages, true);
      chatState.loaded = true;
      requestAnimationFrame(chatScrollToBottom);
    } catch (err) {
      list.innerHTML = '';
      list.appendChild(h('li', 'chat-empty', 'Nije moguće učitati chat. ' + err.message));
      chatState.loading = false;
      return;
    }
    chatState.loading = false;
  } else {
    chatScrollToBottom();
    pollChat();
  }
  if (currentView === 'chat') chatTimer = setInterval(() => { pollChat(); pollTyping(); }, 2000);
}

async function deliverChat(payload, li) {
  li.classList.remove('failed');
  li.classList.add('pending');
  const old = li.querySelector('.chat-status');
  if (old) old.remove();
  try {
    const res = await fetchJson(API_BASE + '/chat', { method: 'POST', body: JSON.stringify(payload) });
    li.classList.remove('pending');
    const foot = li.querySelector('.chat-time');
    if (foot && res.ts) foot.textContent = formatTime(res.ts);
  } catch (err) {
    li.classList.remove('pending');
    li.classList.add('failed');
    const status = h('div', 'chat-status', 'Nije poslano · dodirnite za ponovni pokušaj');
    li.querySelector('.chat-body').appendChild(status);
    li.onclick = () => {
      li.onclick = null;
      deliverChat(payload, li);
    };
  }
}

function sendChat({ text = '', image = '', audio = null }) {
  const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  chatState.ids.add(id);
  const reply = chatState.reply
    ? { id: chatState.reply.id, sender: chatState.reply.sender, text: chatState.reply.preview, kind: 'text' }
    : null;
  const li = appendChatMessage(
    { id, sender: currentUser(), text, hasImage: !!image, hasAudio: !!audio, audioMs: audio ? audio.ms : 0, ts: Date.now(), reply },
    { pending: true, localImage: image, localAudio: audio ? audio.localUrl : '' }
  );
  chatScrollToBottom();
  clearChatReply();
  if (li) {
    deliverChat({
      id,
      sender: currentUser(),
      text,
      image,
      audio: audio ? audio.dataUrl : '',
      audioMs: audio ? audio.ms : 0,
      replyTo: reply ? reply.id : ''
    }, li);
  }
}

// ----- glasovne poruke: snimanje -----
const MAX_VOICE_MS = 60000;
const rec = { active: false, stream: null, recorder: null, chunks: [], startedAt: 0, timer: null, cancelled: false };

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Snimak nije moguće pročitati.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function setRecorderUi(recording) {
  if ($('chatForm')) $('chatForm').hidden = recording;
  if ($('chatRecorder')) $('chatRecorder').hidden = !recording;
  if (recording && $('chatRecTime')) $('chatRecTime').textContent = '0:00';
}

async function startRecording() {
  if (rec.active) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    alert('Ovaj preglednik ne podržava snimanje glasovnih poruka.');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert('Dozvolite pristup mikrofonu u pregledniku da biste snimili glasovnu poruku.');
    return;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  let recorder;
  try {
    // 24 kbit/s: razumljiv govor, a ~180 KB za punu minutu
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    alert('Snimanje glasa nije moguće na ovom uređaju.');
    return;
  }

  Object.assign(rec, { active: true, stream, recorder, chunks: [], startedAt: Date.now(), cancelled: false });
  recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); });
  recorder.addEventListener('stop', onRecordingStopped);
  recorder.start();
  setRecorderUi(true);
  rec.timer = setInterval(() => {
    const elapsed = Date.now() - rec.startedAt;
    if ($('chatRecTime')) $('chatRecTime').textContent = formatDuration(elapsed);
    if (elapsed >= MAX_VOICE_MS) stopRecording(true);
  }, 200);
}

function stopRecording(send) {
  if (!rec.active) return;
  rec.cancelled = !send;
  clearInterval(rec.timer);
  rec.timer = null;
  try { rec.recorder.stop(); } catch (e) { onRecordingStopped(); }
}

async function onRecordingStopped() {
  if (!rec.active) return;
  const ms = Date.now() - rec.startedAt;
  const { cancelled, chunks, recorder, stream } = rec;
  rec.active = false;
  clearInterval(rec.timer);
  rec.timer = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  setRecorderUi(false);
  if (cancelled) return;
  if (ms < 700 || !chunks.length) {
    alert('Glasovna poruka je prekratka.');
    return;
  }
  const type = (chunks[0] && chunks[0].type) || (recorder && recorder.mimeType) || 'audio/webm';
  const blob = new Blob(chunks, { type });
  let dataUrl;
  try {
    dataUrl = await blobToDataUrl(blob);
  } catch (err) {
    alert(err.message);
    return;
  }
  if (dataUrl.length > 1400000) {
    alert('Glasovna poruka je prevelika. Pokušajte snimiti kraću.');
    return;
  }
  sendChat({ audio: { dataUrl, ms: Math.min(ms, MAX_VOICE_MS + 500), localUrl: URL.createObjectURL(blob) } });
}

function initChat() {
  const form = $('chatForm');
  const textEl = $('chatMessage');
  const imageEl = $('chatImage');
  const hint = $('chatImageHint');
  const list = $('chatMessages');
  if (!form) return;

  let pendingImage = '';

  const clearImage = () => {
    pendingImage = '';
    if (imageEl) imageEl.value = '';
    if (hint) {
      hint.hidden = true;
      hint.textContent = '';
    }
  };

  const autoGrow = () => {
    if (!textEl) return;
    textEl.style.height = 'auto';
    textEl.style.height = Math.min(textEl.scrollHeight, 120) + 'px';
  };

  if (imageEl) {
    imageEl.addEventListener('change', async () => {
      const file = imageEl.files[0];
      if (!file) return clearImage();
      try {
        pendingImage = await fileToResizedDataUrl(file, 1024, 'image/jpeg', 0.8);
      } catch (err) {
        alert(err.message);
        return clearImage();
      }
      if (hint) {
        hint.textContent = '';
        hint.hidden = false;
        const remove = h('button', 'chat-hint-remove', 'Ukloni');
        remove.type = 'button';
        remove.addEventListener('click', clearImage);
        hint.append(document.createTextNode('📷 Slika spremna: ' + file.name + ' '), remove);
      }
    });
  }

  if (textEl) {
    textEl.addEventListener('input', () => {
      autoGrow();
      pingTyping(textEl.value.trim().length > 0);
    });
    textEl.addEventListener('blur', () => pingTyping(false));
    textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      } else if (e.key === 'Escape' && chatState.reply) {
        clearChatReply();
      }
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser()) return;
    const text = (textEl ? textEl.value : '').trim();
    const image = pendingImage;
    if (!text && !image) return;
    sendChat({ text, image });
    typingState.sentTyping = false;
    typingState.lastPing = 0;
    if (textEl) {
      textEl.value = '';
      autoGrow();
      textEl.focus();
    }
    clearImage();
  });

  // glasovne poruke
  if ($('chatMic')) $('chatMic').addEventListener('click', startRecording);
  if ($('chatRecCancel')) $('chatRecCancel').addEventListener('click', () => stopRecording(false));
  if ($('chatRecSend')) $('chatRecSend').addEventListener('click', () => stopRecording(true));

  if (list) {
    list.addEventListener('scroll', () => {
      chatState.stick = chatNearBottom();
      if (chatState.stick && $('chatJump')) $('chatJump').hidden = true;
    });
  }
  if ($('chatJump')) $('chatJump').addEventListener('click', chatScrollToBottom);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentView === 'chat') pollChat();
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

// W = pobjeda Rudara, L = poraz, D = neriješeno
function matchResultBadge(m) {
  if (!m.played) return null;
  const score = clubOppScore(m);
  const kind = score.club > score.opp ? 'w' : score.club < score.opp ? 'l' : 'd';
  const info = { w: ['W', 'Pobjeda'], l: ['L', 'Poraz'], d: ['D', 'Neriješeno'] }[kind];
  const badge = h('span', 'match-result ' + kind, info[0]);
  badge.title = info[1];
  return badge;
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

  const when = `${formatDate(it.datetime)} ${formatTime(it.datetime)}`;
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

  const right = h('div', 'match-right');
  const badge = matchResultBadge(it);
  if (badge) right.appendChild(badge);
  right.appendChild(actions);
  row.append(left, right);
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
    [items, teams] = await withLoader(() => Promise.all([loadMatches(), loadTeams()]));
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
      if (key === 'club' && entry.name) {
        row.classList.add('clickable');
        row.title = 'Statistika igrača';
        row.addEventListener('click', () => openPlayer(nameKey(entry.name)));
      }
      row.appendChild(h('span', 'md-num' + (entry.number ? '' : ' empty'), entry.number || ''));
      row.appendChild(h('span', 'md-pname', entry.name || '—'));
      renderRight(row, entry);
      col.appendChild(row);
    });
    cols.appendChild(col);
  });
  return cols;
}

function ballIcon() {
  const span = h('span', 'md-ball');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">'
    + '<circle cx="12" cy="12" r="10.5" fill="#ffffff" stroke="#1f2937" stroke-width="1.2"/>'
    + '<path d="M12 7.2l3.6 2.6-1.4 4.2H9.8L8.4 9.8z" fill="#1f2937"/>'
    + '<path d="M12 7.2V3M15.6 9.8l4-1.3M14.2 14l2.4 3.4M9.8 14l-2.4 3.4M8.4 9.8l-4-1.3" stroke="#1f2937" stroke-width="1.2" fill="none" stroke-linecap="round"/>'
    + '</svg>';
  return span;
}

function buildScorersCard(m, d, info, sides) {
  const card = mdCard('LISTA STRIJELACA');
  const scorers = (Array.isArray(d.scorers) ? d.scorers : []).slice().sort((a, b) => b.goals - a.goals);
  card.querySelector('.md-card-body').appendChild(
    buildPlayerColumns(m, info, sides, scorers, (row, e) => {
      const goals = h('span', 'md-goals');
      goals.title = 'Golovi';
      goals.append(h('span', 'md-val', String(e.goals)), ballIcon());
      row.appendChild(goals);
    }, 'Nema upisanih strijelaca.')
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

function playerKey(p) {
  return `${p.number || ''}||${p.name || ''}`;
}

function playerLabel(p) {
  if (p.number && p.name) return `${p.number} · ${p.name}`;
  return p.name || (p.number ? `#${p.number}` : '');
}

// Razmak između dva imena (broj izmjena slova) - hvata tipfelere poput "Hodžić" / "Hodžićć"
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let k = 1; k <= n; k++) {
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Nalazi red u spisku koji odgovara ranije spremljenom igraču (strijelac / isključenje).
// Ako je ime u spisku ispravljeno, stari zapis se sam veže za ispravljeno ime.
function findRosterMatch(roster, p) {
  if (!p || !(p.name || p.number)) return null;
  const exact = roster.find(r => playerKey(r) === playerKey(p));
  if (exact) return exact;
  const pk = nameKey(p.name);
  if (pk) {
    const sameName = roster.filter(r => nameKey(r.name) === pk);
    if (sameName.length === 1) return sameName[0];
  }
  if (p.number) {
    const sameNum = roster.filter(r => r.number && String(r.number) === String(p.number));
    if (sameNum.length === 1) return sameNum[0];
  }
  if (pk.length >= 5) {
    let best = null, bestDist = 3, tie = false;
    roster.forEach(r => {
      const rk = nameKey(r.name);
      if (!rk) return;
      const dist = editDistance(pk, rk);
      if (dist < bestDist) { best = r; bestDist = dist; tie = false; }
      else if (dist === bestDist && best) tie = true;
    });
    if (best && !tie) return best;
  }
  return null;
}

// Popunjava padajuću listu igrača iz spiska (samo igrači te ekipe).
// Opcija je vezana za RED u spisku (rid), pa promjena imena u spisku automatski mijenja i strijelce/isključenja.
function fillPlayerSelect(sel, side, getRoster, selected) {
  const roster = getRoster().filter(p => p.side === side);
  const current = sel.selectedOptions && sel.selectedOptions[0];

  let wanted = '';
  let orphan = null;
  if (selected) {
    const match = findRosterMatch(roster, selected);
    if (match) wanted = match.rid;
    else orphan = { number: selected.number || '', name: selected.name || '' };
  } else if (current && current.value) {
    if (current.dataset.orphan) orphan = { number: current.dataset.number || '', name: current.dataset.name || '' };
    else wanted = current.value;
  }

  sel.innerHTML = '';
  const first = h('option', '', roster.length ? '— izaberi igrača —' : 'Prvo dodaj igrače na spisak');
  first.value = '';
  sel.appendChild(first);

  roster.forEach(p => {
    const o = h('option', '', playerLabel(p));
    o.value = p.rid;
    o.dataset.number = p.number || '';
    o.dataset.name = p.name || '';
    sel.appendChild(o);
  });

  // igrač koji nije na spisku (npr. star zapis) ostaje vidljiv da se ne izgubi
  let orphanValue = '';
  if (orphan && (orphan.name || orphan.number)) {
    const o = h('option', '', playerLabel(orphan) + ' (nije na spisku)');
    orphanValue = 'orphan::' + playerKey(orphan);
    o.value = orphanValue;
    o.dataset.number = orphan.number;
    o.dataset.name = orphan.name;
    o.dataset.orphan = '1';
    sel.appendChild(o);
  }
  const target = wanted || orphanValue;
  sel.value = [...sel.options].some(o => o.value === target) ? target : '';
}

function buildDetailsEditor(m, teams, allMatches) {
  const d = m.details || {};
  const info = matchTeamInfo(m, teams);
  const final = clubOppScore(m);
  const card = mdCard('UREDI DETALJE (ADMIN)');
  const body = card.querySelector('.md-card-body');
  body.classList.add('md-editor');

  const section = (title, hint) => {
    const box = h('div', 'md-section');
    box.appendChild(h('label', 'md-lab', title));
    if (hint) box.appendChild(h('div', 'md-hint', hint));
    body.appendChild(box);
    return box;
  };
  const sideOf = (row) => row.querySelector('.sel-side').value;

  // --- Poluvrijeme ---
  const halfBox = section('Golovi u 1. poluvremenu');
  const halfRow = h('div', 'md-row');
  const halfClub = inputEl('in-small', 'number', d.halfClub, '', { min: 0 });
  const halfOpp = inputEl('in-small', 'number', d.halfOpp, '', { min: 0 });
  halfRow.append(h('span', 'md-empty', info.club.name + ':'), halfClub, h('span', 'md-empty', info.opp.name + ':'), halfOpp);
  halfBox.appendChild(halfRow);

  // --- Timeouti ---
  const toBox = section('Iskorišteni timeouti');
  const toRow = h('div', 'md-row');
  const toClub = timeoutSelect(d.timeoutsClub);
  const toOpp = timeoutSelect(d.timeoutsOpp);
  toRow.append(h('span', 'md-empty', info.club.name + ':'), toClub, h('span', 'md-empty', info.opp.name + ':'), toOpp);
  toBox.appendChild(toRow);

  // --- Dvorana ---
  const venueBox = section('Dvorana / mjesto (opcionalno)');
  const venue = inputEl('in-name', 'text', d.venue || '', 'npr. SKC Banovići, Banovići', { maxlength: 80 });
  venue.style.width = '100%';
  venueBox.appendChild(venue);

  // --- Spisak igrača ---
  const rosterSection = section('Spisak igrača za ovu utakmicu', 'Upiši igrače jednom. Ispod ih samo biraš kao strijelce i isključenja.');
  const rosterBox = document.createElement('div');
  rosterSection.appendChild(rosterBox);

  const getRoster = () => [...rosterBox.querySelectorAll('.md-row')]
    .map(row => ({
      rid: row.dataset.rid,
      side: sideOf(row),
      number: row.querySelector('.in-number').value.trim(),
      name: row.querySelector('.in-pname').value.trim()
    }))
    .filter(p => p.name || p.number);

  const scorerBox = document.createElement('div');
  const suspBox = document.createElement('div');
  const sumNote = h('div', 'md-sum');

  let updateSum = () => {};
  const refreshPlayerSelects = () => {
    [...scorerBox.querySelectorAll('.md-row'), ...suspBox.querySelectorAll('.md-row')].forEach(row => {
      fillPlayerSelect(row.querySelector('.sel-player'), sideOf(row), getRoster);
    });
    updateSum();
  };

  let ridCounter = 0;
  const addRosterRow = (data = {}) => {
    const row = h('div', 'md-row');
    row.dataset.rid = 'r' + (++ridCounter);
    const sel = sideSelect(info, data.side);
    sel.classList.add('sel-side');
    const num = inputEl('in-num in-number', 'text', data.number, 'br.', { maxlength: 4 });
    const name = inputEl('in-name in-pname', 'text', data.name, 'Ime i prezime', { maxlength: 60 });
    const remove = h('button', 'btn secondary small', '×');
    remove.type = 'button';
    [sel, num, name].forEach(el => el.addEventListener('change', refreshPlayerSelects));
    [num, name].forEach(el => el.addEventListener('input', refreshPlayerSelects));
    remove.addEventListener('click', () => { row.remove(); refreshPlayerSelects(); });
    row.append(sel, num, name, remove);
    rosterBox.appendChild(row);
  };
  (Array.isArray(d.roster) && d.roster.length ? d.roster : [{}]).forEach(addRosterRow);

  const rosterBtns = h('div', 'md-btns');
  const addPlayer = h('button', 'btn secondary small', '+ Dodaj igrača');
  addPlayer.type = 'button';
  addPlayer.addEventListener('click', () => addRosterRow());
  const copyRoster = h('button', 'btn secondary small', 'Učitaj spisak sa prethodne utakmice');
  copyRoster.type = 'button';
  copyRoster.addEventListener('click', () => {
    const others = (allMatches || [])
      .filter(x => x.id !== m.id && x.details && Array.isArray(x.details.roster) && x.details.roster.some(p => p.side === 'club'))
      .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    if (!others.length) return alert('Nijedna druga utakmica još nema spisak igrača.');
    const have = new Set(getRoster().filter(p => p.side === 'club').map(playerKey));
    let added = 0;
    others[0].details.roster.filter(p => p.side === 'club').forEach(p => {
      if (!have.has(playerKey(p))) { addRosterRow(p); added++; }
    });
    // prazan početni red više nije potreban
    [...rosterBox.querySelectorAll('.md-row')].forEach(row => {
      if (!row.querySelector('.in-number').value.trim() && !row.querySelector('.in-pname').value.trim()) row.remove();
    });
    refreshPlayerSelects();
    if (!added) alert('Svi igrači sa prethodne utakmice su već na spisku.');
  });
  rosterBtns.append(addPlayer, copyRoster);
  rosterSection.appendChild(rosterBtns);

  // --- Strijelci ---
  const scorerSection = section('Strijelci');
  scorerSection.appendChild(scorerBox);

  updateSum = () => {
    const sums = { club: 0, opp: 0 };
    scorerBox.querySelectorAll('.md-row').forEach(row => {
      if (!row.querySelector('.sel-player').value) return;
      sums[sideOf(row)] += parseInt(row.querySelector('.in-goals').value, 10) || 0;
    });
    sumNote.textContent = `Zbir golova strijelaca: ${info.club.name} ${sums.club}/${final.club} · ${info.opp.name} ${sums.opp}/${final.opp}`;
    sumNote.classList.toggle('bad', sums.club !== final.club || sums.opp !== final.opp);
  };

  const addScorerRow = (data = {}) => {
    const row = h('div', 'md-row');
    const side = sideSelect(info, data.side);
    side.classList.add('sel-side');
    const player = document.createElement('select');
    player.className = 'sel-player';
    const goals = inputEl('in-small in-goals', 'number', data.goals || 1, 'golovi', { min: 1, max: 99 });
    const remove = h('button', 'btn secondary small', '×');
    remove.type = 'button';
    side.addEventListener('change', () => { fillPlayerSelect(player, side.value, getRoster); updateSum(); });
    goals.addEventListener('input', updateSum);
    player.addEventListener('change', updateSum);
    remove.addEventListener('click', () => { row.remove(); updateSum(); });
    row.append(side, player, goals, remove);
    scorerBox.appendChild(row);
    fillPlayerSelect(player, side.value, getRoster, data.name || data.number ? data : null);
    updateSum();
  };
  (Array.isArray(d.scorers) && d.scorers.length ? d.scorers : [{}]).forEach(addScorerRow);

  const addScorer = h('button', 'btn secondary small', '+ Dodaj strijelca');
  addScorer.type = 'button';
  addScorer.addEventListener('click', () => addScorerRow());
  const scorerBtns = h('div', 'md-btns');
  scorerBtns.appendChild(addScorer);
  scorerSection.append(scorerBtns, sumNote);

  // --- Isključenja ---
  const suspSection = section('Isključenja');
  suspSection.appendChild(suspBox);

  const addSuspRow = (data = {}) => {
    const row = h('div', 'md-row');
    const side = sideSelect(info, data.side);
    side.classList.add('sel-side');
    const player = document.createElement('select');
    player.className = 'sel-player';
    const red = document.createElement('input');
    red.type = 'checkbox';
    red.className = 'in-red';
    red.checked = !!data.red;
    const redLabel = h('label', 'md-check');
    redLabel.append(red, document.createTextNode('Crveni'));
    const remove = h('button', 'btn secondary small', '×');
    remove.type = 'button';
    side.addEventListener('change', () => fillPlayerSelect(player, side.value, getRoster));
    remove.addEventListener('click', () => row.remove());
    row.append(
      side,
      player,
      inputEl('in-small in-count', 'number', data.count != null ? data.count : 1, '2 min', { min: 0, max: 9 }),
      h('span', 'md-empty', '× 2 min'),
      redLabel,
      remove
    );
    suspBox.appendChild(row);
    fillPlayerSelect(player, side.value, getRoster, data.name || data.number ? data : null);
  };
  (Array.isArray(d.suspensions) ? d.suspensions : []).forEach(addSuspRow);

  const addSusp = h('button', 'btn secondary small', '+ Dodaj isključenje');
  addSusp.type = 'button';
  addSusp.addEventListener('click', () => addSuspRow());
  const suspBtns = h('div', 'md-btns');
  suspBtns.appendChild(addSusp);
  suspSection.appendChild(suspBtns);

  // --- Spremanje ---
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

    const playerOf = (row) => {
      const opt = row.querySelector('.sel-player').selectedOptions[0];
      return opt && opt.value ? { number: opt.dataset.number || '', name: opt.dataset.name || '' } : null;
    };

    const scorers = [];
    scorerBox.querySelectorAll('.md-row').forEach(row => {
      const player = playerOf(row);
      const goals = parseInt(row.querySelector('.in-goals').value, 10) || 0;
      if (player && goals > 0) scorers.push({ side: sideOf(row), ...player, goals });
    });

    const suspensions = [];
    suspBox.querySelectorAll('.md-row').forEach(row => {
      const player = playerOf(row);
      if (player) {
        suspensions.push({
          side: sideOf(row),
          ...player,
          count: parseInt(row.querySelector('.in-count').value, 10) || 0,
          red: row.querySelector('.in-red').checked
        });
      }
    });

    const details = {
      venue: venue.value.trim(),
      halfClub: hc,
      halfOpp: ho,
      timeoutsClub: parseInt(toClub.value, 10) || 0,
      timeoutsOpp: parseInt(toOpp.value, 10) || 0,
      roster: getRoster().map(({ rid, ...p }) => p),
      scorers,
      suspensions
    };

    save.disabled = true;
    const ok = await upsertMatch({ ...m, details });
    save.disabled = false;
    if (ok) renderMatchDetail();
  });

  return card;
}

function buildRosterCard(m, d, info, sides) {
  const roster = (Array.isArray(d.roster) ? d.roster : [])
    .slice()
    .sort((a, b) => (parseInt(a.number, 10) || 999) - (parseInt(b.number, 10) || 999));
  if (!roster.length) return null;
  const card = mdCard('SPISAK IGRAČA');
  card.querySelector('.md-card-body').appendChild(
    buildPlayerColumns(m, info, sides, roster, () => {}, 'Nema igrača na spisku.')
  );
  return card;
}

async function renderMatchDetail() {
  const body = $('matchDetailBody');
  if (!body) return;
  body.innerHTML = '';

  let items;
  let teams;
  try {
    [items, teams] = await withLoader(() => Promise.all([loadMatches(), loadTeams()]));
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
    const rosterCard = buildRosterCard(m, d, info, sides);
    if (rosterCard) body.appendChild(rosterCard);
    if (isAdmin()) body.appendChild(buildDetailsEditor(m, teams, items));
  } else {
    body.appendChild(h('div', 'md-note', 'Strijelci, timeouti i isključenja bit će dostupni nakon što se upiše rezultat utakmice.'));
  }
}

// ---------------------------------------------------------------------------
// Igrači (lista i stranica igrača)
// ---------------------------------------------------------------------------
let currentPlayerKey = null;

function nameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function openPlayer(key) {
  currentPlayerKey = key;
  showView('player');
  window.scrollTo(0, 0);
}

// Statistika se računa iz podataka utakmica (spisak, strijelci, isključenja). Igrač se prepoznaje po imenu.
function computePlayerStats(matches) {
  const players = new Map();

  const touch = (entry, m) => {
    const key = nameKey(entry.name);
    if (!key) return null;
    let rec = players.get(key);
    if (!rec) {
      rec = { key, name: String(entry.name).trim().replace(/\s+/g, ' '), number: '', latest: 0, games: new Map() };
      players.set(key, rec);
    }
    const ts = new Date(m.datetime).getTime() || 0;
    if (ts >= rec.latest) {
      rec.latest = ts;
      rec.name = String(entry.name).trim().replace(/\s+/g, ' ');
      if (entry.number) rec.number = entry.number;
    }
    let game = rec.games.get(m.id);
    if (!game) {
      game = { match: m, goals: 0, susp: 0, red: 0 };
      rec.games.set(m.id, game);
    }
    return game;
  };

  (matches || []).filter(m => m.played && m.details).forEach(m => {
    const d = m.details;
    const clubOnly = (list) => (Array.isArray(list) ? list : []).filter(p => p.side === 'club');
    clubOnly(d.roster).forEach(p => touch(p, m));
    clubOnly(d.scorers).forEach(p => {
      const g = touch(p, m);
      if (g) g.goals += Number(p.goals) || 0;
    });
    clubOnly(d.suspensions).forEach(p => {
      const g = touch(p, m);
      if (g) {
        g.susp += Number(p.count) || 0;
        if (p.red) g.red += 1;
      }
    });
  });

  return [...players.values()].map(rec => {
    const games = [...rec.games.values()].sort((a, b) => new Date(b.match.datetime) - new Date(a.match.datetime));
    const goals = games.reduce((n, g) => n + g.goals, 0);
    return {
      key: rec.key,
      name: rec.name,
      number: rec.number,
      games,
      played: games.length,
      goals,
      avg: games.length ? goals / games.length : 0,
      susp: games.reduce((n, g) => n + g.susp, 0),
      red: games.reduce((n, g) => n + g.red, 0)
    };
  });
}

function formatAvg(n) {
  return n.toFixed(1).replace('.', ',');
}

async function loadPlayersMeta() {
  try {
    const data = await fetchJson(API_BASE + '/players');
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

let playersData = null;
let playersGenFilter = '';

function drawPlayersList(box) {
  const { matches, meta } = playersData;
  const infoOf = (pl) => meta[pl.key] || {};
  box.innerHTML = '';

  let players = computePlayerStats(matches);
  if (!players.length) {
    box.appendChild(h('div', 'md-note', 'Još nema igrača. Igrači se pojavljuju kad admin upiše spisak igrača u detaljima odigrane utakmice.'));
    return;
  }

  // filter po generaciji
  const filterRow = h('div', 'pl-filter-row');
  filterRow.appendChild(h('span', 'pl-filter-label', 'Generacija:'));
  const select = document.createElement('select');
  select.className = 'pl-filter';
  [['', 'Sve generacije'], ...PLAYER_GENERATIONS.map(g => [g, g])].forEach(([value, label]) => {
    const option = h('option', '', label);
    option.value = value;
    select.appendChild(option);
  });
  select.value = playersGenFilter;
  select.addEventListener('change', () => {
    playersGenFilter = select.value;
    drawPlayersList(box);
  });
  filterRow.appendChild(select);
  box.appendChild(filterRow);

  if (playersGenFilter) {
    players = players.filter(pl => (infoOf(pl).generations || []).includes(playersGenFilter));
  }
  players.sort((a, b) => b.goals - a.goals || b.played - a.played || a.name.localeCompare(b.name, 'bs'));

  if (!players.length) {
    box.appendChild(h('div', 'md-note', 'Nema igrača za odabranu generaciju. Admin može dodati generaciju na stranici igrača.'));
    return;
  }

  const head = h('div', 'pl-head');
  ['#', 'Igrač', 'Utk.', 'Golovi', 'Prosjek', 'Isklj.'].forEach((label, i) => {
    head.appendChild(h('span', i === 4 ? 'pl-hide-sm' : '', label));
  });
  box.appendChild(head);

  players.forEach((pl, index) => {
    const row = h('div', 'pl-row');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', () => openPlayer(pl.key));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(pl.key); }
    });

    row.appendChild(h('span', 'pl-rank', String(index + 1)));
    const nameCell = h('span', 'pl-name-cell');
    if (pl.number) nameCell.appendChild(h('span', 'md-num', pl.number));
    const nameBox = h('span', 'pl-name-box');
    nameBox.appendChild(h('span', 'pl-name-text', pl.name));
    const positions = infoOf(pl).positions || [];
    if (positions.length) nameBox.appendChild(h('span', 'pl-sub', positions.join(' · ')));
    nameCell.appendChild(nameBox);
    row.appendChild(nameCell);
    row.appendChild(h('span', 'pl-cell', String(pl.played)));
    row.appendChild(h('span', 'pl-cell goals', String(pl.goals)));
    row.appendChild(h('span', 'pl-cell pl-hide-sm', formatAvg(pl.avg)));
    row.appendChild(h('span', 'pl-cell', String(pl.susp)));
    box.appendChild(row);
  });
}

async function renderPlayersList() {
  const box = $('playersList');
  if (!box) return;
  try {
    const [matches, meta] = await withLoader(() => Promise.all([loadMatches(), loadPlayersMeta()]));
    playersData = { matches, meta };
  } catch (err) {
    box.innerHTML = '';
    box.appendChild(h('div', 'md-note', 'Nije moguće učitati igrače. ' + err.message));
    return;
  }
  drawPlayersList(box);
}

function anonymousAvatar() {
  const span = h('span', 'pl-anon');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">'
    + '<circle cx="12" cy="8" r="4.2"/><path d="M3.5 21.5c0-4.7 3.8-8.5 8.5-8.5s8.5 3.8 8.5 8.5z"/></svg>';
  return span;
}

function buildPlayerAvatar(name, metaEntry) {
  const wrap = h('div', 'pl-avatar');
  if (metaEntry && metaEntry.hasPhoto) {
    const img = document.createElement('img');
    img.alt = name;
    img.src = API_BASE + '/players/photo?name=' + encodeURIComponent(name) + '&v=' + (metaEntry.updated || 0);
    img.addEventListener('error', () => {
      wrap.innerHTML = '';
      wrap.appendChild(anonymousAvatar());
    });
    wrap.appendChild(img);
  } else {
    wrap.appendChild(anonymousAvatar());
  }
  return wrap;
}

function buildPlayerMatchRow(game) {
  const m = game.match;
  const row = h('div', 'pl-match');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.addEventListener('click', () => openMatchDetail(m.id));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMatchDetail(m.id); }
  });

  const homeName = m.location === 'home' ? CLUB_NAME : m.opponent;
  const awayName = m.location === 'home' ? m.opponent : CLUB_NAME;
  const left = document.createElement('div');
  left.appendChild(h('strong', '', `${homeName} ${m.homeScore} : ${m.awayScore} ${awayName}`));
  left.appendChild(h('div', 'match-meta', [formatDate(m.datetime), m.competition, m.generation].filter(Boolean).join(' • ')));

  const right = h('div', 'pl-stats');
  const badge = matchResultBadge(m);
  if (badge) right.appendChild(badge);
  const goals = h('span', 'md-goals');
  goals.title = 'Golovi';
  goals.append(h('span', 'md-val', String(game.goals)), ballIcon());
  right.appendChild(goals);
  if (game.susp) right.appendChild(h('span', 'md-tagmini pl-susp', `${game.susp}× 2 min`));
  if (game.red) right.appendChild(h('span', 'md-tagmini', 'CRVENI'));

  row.append(left, right);
  return row;
}

// Admin: pozicije i generacije igrača
function buildPlayerProfileEditor(pl, metaEntry) {
  const card = mdCard('UREDI POZICIJE I GENERACIJE (ADMIN)');
  const body = card.querySelector('.md-card-body');
  body.classList.add('md-editor');

  const group = (title, options, selected) => {
    const box = h('div', 'md-section');
    box.appendChild(h('label', 'md-lab', title));
    const grid = h('div', 'pl-checks');
    const all = [...options, ...selected.filter(x => !options.includes(x))];
    const inputs = all.map(value => {
      const label = h('label', 'md-check pl-check');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = value;
      input.checked = selected.includes(value);
      label.append(input, document.createTextNode(value));
      grid.appendChild(label);
      return input;
    });
    box.appendChild(grid);
    body.appendChild(box);
    return inputs;
  };

  const posInputs = group('Pozicije (može više)', PLAYER_POSITIONS, (metaEntry && metaEntry.positions) || []);
  const genInputs = group('Generacije (može više)', PLAYER_GENERATIONS, (metaEntry && metaEntry.generations) || []);

  const actions = h('div', 'md-actions');
  const save = h('button', 'btn', 'Spremi');
  save.type = 'button';
  actions.appendChild(save);
  body.appendChild(actions);

  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await withLoader(() => fetchJson(API_BASE + '/players/profile', {
        method: 'POST',
        body: JSON.stringify({
          name: pl.name,
          positions: posInputs.filter(i => i.checked).map(i => i.value),
          generations: genInputs.filter(i => i.checked).map(i => i.value)
        })
      }), 'Spremanje...');
      renderPlayerPage();
    } catch (err) {
      alert('Nije spremljeno: ' + err.message);
    } finally {
      save.disabled = false;
    }
  });
  return card;
}

async function renderPlayerPage() {
  const body = $('playerBody');
  if (!body) return;
  body.innerHTML = '';

  let matches;
  let meta;
  try {
    [matches, meta] = await withLoader(() => Promise.all([loadMatches(), loadPlayersMeta()]));
  } catch (err) {
    body.appendChild(h('div', 'md-note', 'Nije moguće učitati igrača. ' + err.message));
    return;
  }

  const pl = computePlayerStats(matches).find(p => p.key === currentPlayerKey);
  if (!pl) {
    body.appendChild(h('div', 'md-note', 'Igrač nije pronađen.'));
    return;
  }
  const metaEntry = meta[pl.key];
  const hasPhoto = !!(metaEntry && metaEntry.hasPhoto);

  // Gornji dio: slika (ili anonimna ikonica) i ime
  const hero = h('div', 'md-hero pl-hero');
  hero.appendChild(buildPlayerAvatar(pl.name, metaEntry));
  hero.appendChild(h('div', 'pl-name', pl.name));
  const tags = h('div', 'md-tags');
  tags.appendChild(h('span', 'md-tag', CLUB_NAME));
  if (pl.number) tags.appendChild(h('span', 'md-tag', 'Broj ' + pl.number));
  ((metaEntry && metaEntry.positions) || []).forEach(p => tags.appendChild(h('span', 'md-tag pos', p)));
  ((metaEntry && metaEntry.generations) || []).forEach(g => tags.appendChild(h('span', 'md-tag gen', g)));
  hero.appendChild(tags);

  if (isAdmin()) {
    const controls = h('div', 'pl-controls');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    const upload = h('button', 'btn small', hasPhoto ? 'Promijeni sliku' : 'Dodaj sliku');
    upload.type = 'button';
    upload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const photo = await fileToResizedDataUrl(file, 480, 'image/jpeg', 0.85);
        await withLoader(
          () => fetchJson(API_BASE + '/players/photo', { method: 'POST', body: JSON.stringify({ name: pl.name, photo }) }),
          'Spremanje slike...'
        );
        renderPlayerPage();
      } catch (err) {
        alert('Slika nije spremljena: ' + err.message);
      }
    });
    controls.append(upload, fileInput);

    if (hasPhoto) {
      const remove = h('button', 'btn secondary small', 'Ukloni sliku');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!confirm('Ukloniti sliku ovog igrača?')) return;
        try {
          await withLoader(
            () => fetchJson(API_BASE + '/players/photo?name=' + encodeURIComponent(pl.name), { method: 'DELETE' }),
            'Uklanjanje slike...'
          );
          renderPlayerPage();
        } catch (err) {
          alert('Slika nije uklonjena: ' + err.message);
        }
      });
      controls.appendChild(remove);
    }
    hero.appendChild(controls);
  }
  body.appendChild(hero);

  // Statistika
  const stats = h('div', 'md-info');
  [
    ['Utakmice', String(pl.played)],
    ['Golovi', String(pl.goals)],
    ['Prosjek golova', formatAvg(pl.avg)],
    ['Isključenja', String(pl.susp) + (pl.red ? ` (+${pl.red} crveni)` : '')]
  ].forEach(([label, value]) => {
    const cell = document.createElement('div');
    cell.appendChild(h('label', '', label));
    cell.appendChild(h('strong', '', value));
    stats.appendChild(cell);
  });
  body.appendChild(stats);

  // Po utakmicama
  const card = mdCard('PO UTAKMICAMA');
  const cardBody = card.querySelector('.md-card-body');
  pl.games.forEach(game => cardBody.appendChild(buildPlayerMatchRow(game)));
  body.appendChild(card);
  if (isAdmin()) body.appendChild(buildPlayerProfileEditor(pl, metaEntry));
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
  const nav = { announcementsBtn: 'announcements', chatBtn: 'chat', galleryBtn: 'gallery', terminiBtn: 'termini', matchesBtn: 'matches', playersBtn: 'players' };
  Object.keys(nav).forEach(id => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', () => showView(nav[id]));
  });
  if ($('logoutBtn')) $('logoutBtn').addEventListener('click', logOut);
  if ($('notifBtn')) $('notifBtn').addEventListener('click', enablePushNotifications);

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

  // Galerija (admin): moze se odabrati vise slika odjednom
  const galForm = $('galleryForm');
  if (galForm) {
    galForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isAdmin()) return;
      const files = [...$('galleryImage').files];
      if (!files.length) return;
      const description = ($('galleryDescription').value || '').trim();
      const btn = galForm.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;

      const base = Date.now();
      let saved = 0;
      showLoader(true, `Spremanje slike 1/${files.length}...`);
      try {
        for (let i = 0; i < files.length; i++) {
          if ($('globalLoaderText')) $('globalLoaderText').textContent = `Spremanje slike ${i + 1}/${files.length}...`;
          const image = await fileToResizedDataUrl(files[i], 1600, 'image/jpeg', 0.85);
          await fetchJson(API_BASE + '/gallery', {
            method: 'POST',
            body: JSON.stringify({
              id: 'gal_' + base + '_' + i,
              image,
              description,
              author: currentUser(),
              // prva odabrana slika je na vrhu
              ts: base + (files.length - i)
            })
          });
          saved++;
        }
      } catch (err) {
        alert(`Spremljeno slika: ${saved} od ${files.length}. Greška: ${err.message}`);
      } finally {
        showLoader(false);
        if (btn) btn.disabled = false;
        galForm.reset();
        renderGallery();
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
  if ($('playerBack')) $('playerBack').addEventListener('click', () => showView('players'));

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
