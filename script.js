const API_BASE = 'https://orkrudarbanovici-1.onrender.com/api';

// Stanje aplikacije čuva se u radnoj memoriji i sessionStorage tokom trajanja otvorenog taba
let CURRENT_SESSION_USER = sessionStorage.getItem('club_session_user') || '';
let CURRENT_PROFILE_IMAGE = '';
let chatTimer = null;

function currentUser() {
  return CURRENT_SESSION_USER.trim();
}

function setCurrentUser(username) {
  CURRENT_SESSION_USER = username || '';
  if (username) {
    sessionStorage.setItem('club_session_user', username);
  } else {
    sessionStorage.removeItem('club_session_user');
  }
}

function getProfileImage() {
  return CURRENT_PROFILE_IMAGE;
}

function setProfileImage(imageData) {
  CURRENT_PROFILE_IMAGE = imageData || '';
}

function isAdminUser(username) {
  if (!username) return false;
  return username.toLowerCase() === 'admin';
}

// Kompatibilne prazne funkcije radi sprječavanja pucanja koda (localStorage izbačen)
function safeStorageGet(key) { return null; }
function safeStorageSet(key, value) { return false; }
function safeStorageRemove(key) {}
function readLocal(key, fallback) { return fallback; }
function writeLocal(key, value) {}
function purgeStaleBrowserData() {}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Greška servera: ${res.status}`);
  }
  return res.json();
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'Upravo sada';
  if (diff < 3600) return `Prije ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Prije ${Math.floor(diff / 3600)} h`;
  return new Date(ts).toLocaleDateString('bs-BA');
}

function setPanelLoading(panelId, isLoading) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  if (isLoading) {
    panel.classList.add('is-loading');
  } else {
    panel.classList.remove('is-loading');
  }
}

function updateAuthUi() {
  const user = currentUser();
  const authBtn = document.getElementById('authNavBtn');
  const userSpan = document.getElementById('navUsername');
  
  if (authBtn) {
    authBtn.textContent = user ? 'Odjava' : 'Prijava';
  }
  if (userSpan) {
    userSpan.textContent = user ? `@${user}` : '';
  }
}

function showLogin(show) {
  const modal = document.getElementById('loginModal');
  if (modal) {
    modal.style.display = show ? 'flex' : 'none';
  }
}

function showView(viewName) {
  const views = document.querySelectorAll('.view-panel');
  views.forEach(v => v.classList.remove('active'));
  
  const target = document.getElementById(`view-${viewName}`) || document.getElementById('view-announcements');
  if (target) {
    target.classList.add('active');
  }
}

// === OBAVJEŠTENJA ===
async function fetchAnnouncements() {
  try {
    const data = await fetchJson(API_BASE + '/announcements');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

async function renderAnnouncements() {
  const list = document.getElementById('announcementsList');
  if (!list) return;

  setPanelLoading('view-announcements', true);
  try {
    const items = await fetchAnnouncements();
    list.innerHTML = '';

    if (!items.length) {
      list.innerHTML = '<div class="empty-state">Trenutno nema novih obavještenja.</div>';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <h3>${item.title || 'Bez naslova'}</h3>
        <p class="meta">Objavio: ${item.author || 'Admin'} · ${formatRelativeTime(item.ts)}</p>
        <p>${item.content || ''}</p>
      `;
      list.appendChild(card);
    });
  } finally {
    setPanelLoading('view-announcements', false);
  }
}

// === GALERIJA ===
async function fetchGalleryItems() {
  try {
    const data = await fetchJson(API_BASE + '/gallery');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

async function saveGalleryItem(item) {
  try {
    await fetchJson(API_BASE + '/gallery', {
      method: 'POST',
      body: JSON.stringify(item)
    });
  } catch (err) {
    console.error("Greška pri spavanju u galeriju:", err);
  }
}

async function renderGallery() {
  const feed = document.getElementById('galleryFeed');
  const adminBlock = document.getElementById('galleryAdminBlock');
  if (!feed) return;

  const isAdmin = isAdminUser(currentUser());
  if (adminBlock) {
    adminBlock.style.display = isAdmin ? 'block' : 'none';
  }

  setPanelLoading('view-gallery', true);
  try {
    const items = await fetchGalleryItems();
    feed.innerHTML = '';

    if (!items.length) {
      feed.innerHTML = '<div class="gallery-empty">Još nema slika u galeriji.</div>';
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'gallery-card';

      const img = document.createElement('img');
      img.className = 'gallery-image';
      img.src = item.image;
      img.alt = item.description || 'Galerija slika';

      const body = document.createElement('div');
      body.className = 'gallery-body';

      const meta = document.createElement('div');
      meta.className = 'gallery-meta';
      meta.textContent = `${item.author || 'Admin'} · ${formatRelativeTime(item.ts)}`;

      const desc = document.createElement('p');
      desc.className = 'gallery-description';
      desc.textContent = item.description || 'Bez opisa.';

      const actions = document.createElement('div');
      actions.className = 'gallery-actions';

      const likeBtn = document.createElement('button');
      likeBtn.type = 'button';
      likeBtn.className = 'gallery-action';
      likeBtn.textContent = `👍 ${Number(item.likes || 0)}`;
      likeBtn.addEventListener('click', async () => {
        item.likes = Number(item.likes || 0) + 1;
        await saveGalleryItem(item);
        renderGallery();
      });

      const dislikeBtn = document.createElement('button');
      dislikeBtn.type = 'button';
      dislikeBtn.className = 'gallery-action';
      dislikeBtn.textContent = `👎 ${Number(item.dislikes || 0)}`;
      dislikeBtn.addEventListener('click', async () => {
        item.dislikes = Number(item.dislikes || 0) + 1;
        await saveGalleryItem(item);
        renderGallery();
      });

      const commentWrap = document.createElement('div');
      commentWrap.className = 'gallery-comment-wrap';

      const commentInput = document.createElement('input');
      commentInput.type = 'text';
      commentInput.placeholder = 'Dodaj komentar...';
      commentInput.maxLength = 200;
      commentInput.className = 'gallery-comment-input';

      const commentBtn = document.createElement('button');
      commentBtn.type = 'button';
      commentBtn.className = 'btn secondary small';
      commentBtn.textContent = 'Komentiraj';
      commentBtn.addEventListener('click', async () => {
        const text = (commentInput.value || '').trim();
        if (!text) return;
        item.comments = Array.isArray(item.comments) ? item.comments : [];
        item.comments.push({
          user: currentUser() || 'Korisnik',
          text,
          ts: Date.now()
        });
        await saveGalleryItem(item);
        renderGallery();
      });

      const commentsList = document.createElement('div');
      commentsList.className = 'gallery-comments';
      const comments = Array.isArray(item.comments) ? item.comments : [];
      if (comments.length) {
        comments.forEach((comment) => {
          const row = document.createElement('div');
          row.className = 'gallery-comment';
          row.innerHTML = `<strong>${comment.user || 'Korisnik'}:</strong> ${comment.text || ''}`;
          commentsList.appendChild(row);
        });
      }

      commentWrap.append(commentInput, commentBtn);
      actions.append(likeBtn, dislikeBtn);
      body.append(meta, desc, actions, commentWrap, commentsList);
      card.append(img, body);
      feed.appendChild(card);
    });
  } finally {
    setPanelLoading('view-gallery', false);
  }
}

// === CHAT ===
async function renderChat() {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  try {
    const messages = await fetchJson(API_BASE + '/chat');
    container.innerHTML = '';

    messages.forEach(msg => {
      const isMine = msg.sender.toLowerCase() === currentUser().toLowerCase();
      const div = document.createElement('div');
      div.className = `chat-message ${isMine ? 'mine' : 'other'}`;
      div.innerHTML = `
        <div class="sender">${msg.sender}</div>
        <div class="bubble">${msg.text}</div>
        <div class="time">${formatRelativeTime(msg.ts)}</div>
      `;
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error("Greška pri učitavanju poruka:", err);
  }
}

function ensureChatAutoRefresh() {
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = setInterval(renderChat, 4000);
}

function stopChatAutoRefresh() {
  if (chatTimer) {
    clearInterval(chatTimer);
    chatTimer = null;
  }
}

// === AUTENTIFIKACIJA & LOGIKA PRISTUPA ===
function logInUser(username) {
  setCurrentUser(username);
  updateAuthUi();
  showLogin(false);
  renderAll();
  ensureChatAutoRefresh();
}

function renderAll() {
  renderAnnouncements();
  renderGallery();
  renderChat();
}

// === EVENT LISTENERS ===
document.addEventListener('DOMContentLoaded', () => {
  updateAuthUi();
  renderAll();

  // Login forma
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userIn = document.getElementById('loginUsername')?.value.trim();
      const passIn = document.getElementById('loginPassword')?.value.trim();
      const errEl = document.getElementById('loginError');

      if (errEl) errEl.textContent = '';

      try {
        const res = await fetchJson(API_BASE + '/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: userIn, password: passIn })
        });
        if (res.ok && res.user) {
          logInUser(res.user.username);
        }
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      }
    });
  }

  // Dugme Odjava / Prijava
  const authBtn = document.getElementById('authNavBtn');
  if (authBtn) {
    authBtn.addEventListener('click', () => {
      if (currentUser()) {
        setCurrentUser('');
        setProfileImage('');
        stopChatAutoRefresh();
        updateAuthUi();
        showView('announcements');
      } else {
        showLogin(true);
      }
    });
  }

  // Slanje poruke na chatu
  const chatForm = document.getElementById('chatForm');
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('chatInput');
      const text = input?.value.trim();
      if (!text || !currentUser()) return;

      try {
        await fetchJson(API_BASE + '/chat', {
          method: 'POST',
          body: JSON.stringify({
            sender: currentUser(),
            text: text,
            ts: Date.now()
          })
        });
        if (input) input.value = '';
        renderChat();
      } catch (err) {
        alert("Nije moguće poslati poruku.");
      }
    });
  }
});