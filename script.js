// Aplikacija obavijesti i klupskog chata.
const form = document.getElementById('announcementForm');
const messageInput = document.getElementById('message');
const listEl = document.getElementById('announcements');
const clearBtn = document.getElementById('clearBtn');
const chatForm = document.getElementById('chatForm');
const chatMessageInput = document.getElementById('chatMessage');
const chatImageInput = document.getElementById('chatImage');
const chatMessagesEl = document.getElementById('chatMessages');
const matchForm = document.getElementById('matchForm');
const clubName = 'ORK Rudar Banovići';
const API_BASE = 'https://orkrudarbanovici-1.onrender.com/api';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const USERS_KEY = 'club_users';
const SESSION_USER_KEY = 'club_session_user';
const PROFILE_IMAGE_KEY = 'club_profile_image';

async function fetchCurrentUserProfile() {
  const username = currentUser();
  if (!username) return;

  try {
    const data = await fetchJson(API_BASE + '/users/' + encodeURIComponent(username));
    if (data && data.avatar) {
      setProfileImage(data.avatar);
    } else {
      localStorage.removeItem(PROFILE_IMAGE_KEY);
    }
    updateAuthUi();
  } catch (err) {
    // ignore profile fetch errors and keep the locally stored avatar if present
  }
}

async function ensureDefaultAdminUser() {
  try {
    await fetchJson(API_BASE + '/users/login', {
      method: 'POST',
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    });
    return;
  } catch (err) {
    try {
      await fetchJson(API_BASE + '/users', {
        method: 'POST',
        body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
      });
    } catch (createErr) {
      // If the admin account already exists, the login attempt above would have succeeded.
    }
  }
}

function getUsers() {
  return readLocal(USERS_KEY, {});
}

function saveUsers(users) {
  writeLocal(USERS_KEY, users);
}

function normalizeName(value) {
  return (value || '').trim();
}

function formatDisplayDate(dateValue) {
  const date = new Date(dateValue);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatDisplayDateTime(dateValue) {
  const date = new Date(dateValue);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year}. ${hours}:${minutes}`;
}

function formatRelativeTime(dateValue) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 1000));
  if (elapsedSeconds < 60) return 'just now';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function currentUser() {
  const raw = localStorage.getItem(SESSION_USER_KEY);
  return raw || '';
}

function isAdminUser(username) {
  return normalizeName(username) === ADMIN_USERNAME;
}

function getProfileImage() {
  return localStorage.getItem(PROFILE_IMAGE_KEY) || '';
}

function setProfileImage(imageData) {
  if (!imageData) {
    localStorage.removeItem(PROFILE_IMAGE_KEY);
    return;
  }
  localStorage.setItem(PROFILE_IMAGE_KEY, imageData);
}

function updateAuthUi() {
  const user = currentUser();
  const isAdmin = isAdminUser(user);

  const announcementBlock = document.getElementById('announcementAdminBlock');
  if (announcementBlock) {
    announcementBlock.style.display = isAdmin ? 'block' : 'none';
  }

  const matchFormWrap = document.getElementById('matchFormWrap');
  if (matchFormWrap) {
    const notice = document.getElementById('matchAdminNotice');
    const form = document.getElementById('matchForm');
    if (notice && form) {
      const hideForm = !isAdmin;
      notice.style.display = hideForm ? 'block' : 'none';
      form.style.display = hideForm ? 'none' : 'block';
    }
  }

  const avatarEl = document.getElementById('avatar');
  const avatarWrap = document.querySelector('.avatar-wrap');
  const removeAvatarBtn = document.getElementById('removeAvatarBtn');
  const profileImage = getProfileImage();
  const hasImage = !!profileImage && !!user;

  if (avatarEl) {
    avatarEl.title = user || 'User';
    if (profileImage) {
      avatarEl.innerHTML = `<img src="${profileImage}" alt="Profile picture" />`;
      avatarEl.classList.add('has-image');
    } else {
      const initial = (user.trim().charAt(0) || 'A').toUpperCase();
      avatarEl.innerHTML = initial;
      avatarEl.classList.remove('has-image');
    }
  }

  if (avatarWrap) {
    avatarWrap.classList.toggle('has-image', hasImage);
  }

  if (removeAvatarBtn) {
    removeAvatarBtn.classList.toggle('visible', hasImage);
    removeAvatarBtn.disabled = !hasImage;
    removeAvatarBtn.style.visibility = user ? 'visible' : 'hidden';
  }
}

async function saveProfileImageToServer(imageData) {
  const username = currentUser();
  if (!username) return;

  try {
    await fetchJson(API_BASE + '/users/' + encodeURIComponent(username) + '/avatar', {
      method: 'PUT',
      body: JSON.stringify({ avatar: imageData })
    });
  } catch (err) {
    // ignore server errors and keep local copy if needed
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', 'X-Club-User': currentUser() },
    ...options
  });
  if (!response.ok) {
    throw new Error('Request failed: ' + response.status);
  }
  return response.json();
}

async function loadAnnouncements() {
  try {
    const data = await fetchJson(API_BASE + '/announcements');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    const raw = localStorage.getItem('announcements');
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  }
}

async function saveAnnouncements(arr) {
  try {
    await fetchJson(API_BASE + '/announcements', {
      method: 'POST',
      body: JSON.stringify(arr)
    });
    localStorage.setItem('announcements', JSON.stringify(arr));
  } catch (err) {
    localStorage.setItem('announcements', JSON.stringify(arr));
  }
}

async function loadChatMessages() {
  try {
    const data = await fetchJson(API_BASE + '/chat');
    localStorage.removeItem('chat_messages');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

async function saveChatMessage(item) {
  await fetchJson(API_BASE + '/chat', {
    method: 'POST',
    body: JSON.stringify(item)
  });
  const localMessages = readLocal('chat_messages', []);
  localMessages.unshift(item);
  writeLocal('chat_messages', localMessages.slice(0, 100));
}

function renderChatMessages(items) {
  if (!chatMessagesEl) return;
  chatMessagesEl.innerHTML = '';
  if (items.length === 0) {
    chatMessagesEl.innerHTML = '<li class="chat-empty">Još nema poruka.</li>';
    return;
  }
  const orderedItems = [...items].sort((a, b) => Number(a.ts) - Number(b.ts));
  orderedItems.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'chat-message';
    li.classList.toggle('own-message', item.username === currentUser());
    const identity = document.createElement('div');
    identity.className = 'chat-identity';
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    if (item.avatar) {
      avatar.innerHTML = `<img src="${item.avatar}" alt="" />`;
    } else {
      avatar.textContent = (item.username || '?').charAt(0).toUpperCase();
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${item.username} · ${formatRelativeTime(item.ts)}`;
    identity.append(avatar, meta);
    const body = document.createElement('div');
    body.className = 'msg';
    body.textContent = item.message;
    if (item.image) {
      const image = document.createElement('img');
      image.className = 'chat-message-image';
      image.src = item.image;
      image.alt = 'Slika u poruci';
      body.appendChild(image);
    }
    li.append(identity, body);
    chatMessagesEl.appendChild(li);
  });
}

async function renderChat() {
  setPanelLoading('viewChat', true);
  try {
    renderChatMessages(await loadChatMessages());
  } finally {
    setPanelLoading('viewChat', false);
  }
}

function setPanelLoading(panelId, loading) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  let loader = panel.querySelector('.panel-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.className = 'panel-loader';
    loader.innerHTML = '<span class="mini-spinner" aria-hidden="true"></span><span>Učitavanje...</span>';
    panel.insertBefore(loader, panel.firstChild);
  }
  loader.classList.toggle('active', loading);
}

async function render() {
  const panelId = 'viewAnnouncements';
  setPanelLoading(panelId, true);
  try {
    const items = await loadAnnouncements();
    listEl.innerHTML = '';
    if (items.length === 0) {
      listEl.innerHTML = '<li class="announcement">Još nema obavijesti.</li>';
      return;
    }
    items.forEach(it => {
      const li = document.createElement('li');
      li.className = 'announcement';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `Trener · ${formatRelativeTime(it.ts)} · ${formatDisplayDateTime(it.ts)}`;
      const msg = document.createElement('div');
      msg.className = 'msg';
      msg.textContent = it.message;
      li.appendChild(meta);
      li.appendChild(msg);
      listEl.appendChild(li);
    });
  } finally {
    setPanelLoading(panelId, false);
  }
}

if (chatForm) {
  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = currentUser();
    const message = chatMessageInput.value.trim();
    const imageFile = chatImageInput.files && chatImageInput.files[0];
    if (!username || (!message && !imageFile)) return;
    if (imageFile && imageFile.size > 4 * 1024 * 1024) {
      alert('Slika može imati najviše 4 MB.');
      return;
    }
    const sendMessage = (image) => {
      const item = { username, message, image, ts: Date.now() };
      return saveChatMessage(item).then(async () => {
        chatMessageInput.value = '';
        chatImageInput.value = '';
        await renderChat();
      });
    };
    try {
      if (imageFile) {
        const reader = new FileReader();
        reader.onload = () => sendMessage(String(reader.result || '')).catch(() => alert('Poruka nije mogla biti poslana.'));
        reader.readAsDataURL(imageFile);
      } else {
        await sendMessage(null);
      }
    } catch (err) {
      alert('Poruka nije mogla biti poslana.');
    }
  });
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!isAdminUser(currentUser())) {
    alert('Only the admin account can publish announcements.');
    return;
  }
  const message = messageInput.value.trim();
  if (!message) return;
  const items = await loadAnnouncements();
  items.unshift({ message, ts: Date.now() });
  await saveAnnouncements(items);
  messageInput.value = '';
  render();
});

clearBtn.addEventListener('click', () => {
  messageInput.value = '';
});

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // ignore storage failures
  }
}

async function loadMatches() {
  try {
    const data = await fetchJson(API_BASE + '/matches');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return readLocal('matches', []);
  }
}

async function saveMatches(arr) {
  if (!isAdminUser(currentUser())) return false;
  try {
    await fetchJson(API_BASE + '/matches', {
      method: 'POST',
      body: JSON.stringify(arr)
    });
    writeLocal('matches', arr);
    return true;
  } catch (err) {
    return false;
  }
}

async function loadTeams() {
  try {
    const data = await fetchJson(API_BASE + '/teams');
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    return readLocal('teams', {});
  }
}

async function saveTeams(obj) {
  writeLocal('teams', obj);
  try {
    await fetchJson(API_BASE + '/teams', {
      method: 'POST',
      body: JSON.stringify(obj)
    });
  } catch (err) {
    // fallback while server is not available
  }
}

function normalizeTeamName(value) {
  return (value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .toLowerCase();
}

function getTeamBadge(name, teams) {
  if (!name) return null;

  const normalizedName = normalizeTeamName(name);
  const clubTokens = normalizeTeamName(clubName);
  const isClubTeam = normalizedName.includes('rudar') || normalizedName.includes('banovici') || normalizedName.includes(clubTokens.replace(/\s+/g, '')) || normalizedName.includes(clubTokens);

  if (isClubTeam) {
    return 'rudar.png';
  }

  const exact = teams[name];
  if (exact) return exact;

  const normalizedMap = Object.fromEntries(
    Object.entries(teams || {}).map(([key, value]) => [normalizeTeamName(key), value])
  );

  return normalizedMap[normalizedName] || null;
}

const RESULTS_GENERATION_KEYS = ['2010/11', '2012/13', '2014/15', 'Mini Rukomet'];
let selectedGenerationFilter = '2010/11';

function setSelectedGenerationFilter(value) {
  selectedGenerationFilter = RESULTS_GENERATION_KEYS.includes(value) ? value : '2010/11';
  document.querySelectorAll('.generation-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.generation === selectedGenerationFilter);
  });
}

async function renderMatches() {
  const panelId = 'viewMatches';
  setPanelLoading(panelId, true);
  try {
    const upcomingList = document.getElementById('upcomingList');
    const resultsList = document.getElementById('resultsList');
    if (!upcomingList || !resultsList) return;

    const [items, teamMap] = await Promise.all([loadMatches(), loadTeams()]);
    const sortedItems = [...items].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const upcomingMatches = sortedItems.filter((it) => !it.played);
    const filteredResults = sortedItems.filter((it) => it.played && (!it.generation || it.generation === selectedGenerationFilter));

    upcomingList.innerHTML = '';
    resultsList.innerHTML = '';

  upcomingMatches.forEach((it) => {
    const el = document.createElement('div');
    el.className = 'match-item';
    const left = document.createElement('div');
    const homeName = it.location === 'home' ? clubName : it.opponent;
    const awayName = it.location === 'home' ? it.opponent : clubName;
    const homeBadge = getTeamBadge(homeName, teamMap);
    const awayBadge = getTeamBadge(awayName, teamMap);

    function badgeTag(data) {
      return data ? `<img src="${data}" class="team-badge" alt="badge" />` : '';
    }

    left.innerHTML = `<div><strong>${badgeTag(homeBadge)} ${homeName} vs ${awayName} ${badgeTag(awayBadge)}</strong></div><div class="match-meta">${formatDisplayDateTime(it.datetime)}${it.competition ? ' • ' + it.competition : ''}${it.generation ? ' • ' + it.generation : ''}</div>`;

    const actions = document.createElement('div');
    actions.className = 'match-actions';
    const canManageMatches = isAdminUser(currentUser());

    const playBtn = document.createElement('button');
    playBtn.className = 'small btn';
    playBtn.textContent = 'Enter Result';
    playBtn.addEventListener('click', () => showResultInputs(it.id, el, it));

    const del = document.createElement('button');
    del.className = 'small btn secondary';
    del.textContent = 'Delete';
    del.hidden = !canManageMatches;
    del.addEventListener('click', async () => {
      if (!isAdminUser(currentUser())) {
        alert('Only the admin account can delete matches.');
        return;
      }
      if (confirm('Delete this match?')) {
        const arr = await loadMatches();
        const next = arr.filter((m) => m.id !== it.id);
        await saveMatches(next);
        renderMatches();
      }
    });

    actions.appendChild(playBtn);
    actions.appendChild(del);
    el.appendChild(left);
    el.appendChild(actions);
    upcomingList.appendChild(el);
  });

  filteredResults.forEach((it) => {
    const el = document.createElement('div');
    el.className = 'match-item';
    const left = document.createElement('div');
    const homeName = it.location === 'home' ? clubName : it.opponent;
    const awayName = it.location === 'home' ? it.opponent : clubName;
    const homeBadge = getTeamBadge(homeName, teamMap);
    const awayBadge = getTeamBadge(awayName, teamMap);

    function badgeTag(data) {
      return data ? `<img src="${data}" class="team-badge" alt="badge" />` : '';
    }

    left.innerHTML = `<div><strong>${badgeTag(homeBadge)} ${homeName} ${it.homeScore} - ${it.awayScore} ${awayName} ${badgeTag(awayBadge)}</strong></div><div class="match-meta">${formatDisplayDateTime(it.datetime)} ${it.competition ? ' • ' + it.competition : ''}${it.generation ? ' • ' + it.generation : ''}</div>`;

    const actions = document.createElement('div');
    actions.className = 'match-actions';
    const canManageResults = isAdminUser(currentUser());

    const clubScore = it.location === 'home' ? it.homeScore : it.awayScore;
    const oppScore = it.location === 'home' ? it.awayScore : it.homeScore;
    const result = clubScore > oppScore ? 'W' : clubScore < oppScore ? 'L' : 'D';
    const resultBadge = document.createElement('div');
    resultBadge.className = `result-status ${clubScore > oppScore ? 'win' : clubScore < oppScore ? 'loss' : 'draw'}`;
    resultBadge.textContent = result;
    actions.appendChild(resultBadge);

    const del = document.createElement('button');
    del.className = 'small btn secondary';
    del.textContent = 'Delete';
    del.hidden = !canManageResults;
    del.addEventListener('click', async () => {
      if (!isAdminUser(currentUser())) {
        alert('Only the admin account can delete results.');
        return;
      }
      if (confirm('Delete this match?')) {
        const arr = await loadMatches();
        const next = arr.filter((m) => m.id !== it.id);
        await saveMatches(next);
        renderMatches();
      }
    });
    actions.appendChild(del);
    el.appendChild(left);
    el.appendChild(actions);
    resultsList.appendChild(el);
  });

  if (upcomingMatches.length === 0) {
    upcomingList.innerHTML = '<div class="match-meta">No upcoming matches.</div>';
  }
  if (filteredResults.length === 0) {
    resultsList.innerHTML = '<div class="match-meta">No results yet for this generation.</div>';
  }
  } finally {
    setPanelLoading(panelId, false);
  }
}

function showResultInputs(id, container, match) {
  const actions = container.querySelector('.match-actions');
  if (!actions) return;
  actions.innerHTML = '';

  const inputs = document.createElement('div');
  inputs.className = 'result-inputs';
  const homeName = match.location === 'home' ? clubName : match.opponent;
  const awayName = match.location === 'home' ? match.opponent : clubName;
  const homeInput = document.createElement('input');
  homeInput.type = 'number';
  homeInput.min = 0;
  homeInput.placeholder = homeName;
  const awayInput = document.createElement('input');
  awayInput.type = 'number';
  awayInput.min = 0;
  awayInput.placeholder = awayName;
  const saveBtn = document.createElement('button');
  saveBtn.className = 'small btn';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'small btn secondary';
  cancelBtn.textContent = 'Cancel';

  inputs.appendChild(homeInput);
  inputs.appendChild(document.createTextNode('-'));
  inputs.appendChild(awayInput);
  inputs.appendChild(saveBtn);
  inputs.appendChild(cancelBtn);
  actions.appendChild(inputs);

  saveBtn.addEventListener('click', async () => {
    if (!isAdminUser(currentUser())) {
      alert('Only the admin account can update match results.');
      return;
    }
    const homeScore = parseInt(homeInput.value, 10);
    const awayScore = parseInt(awayInput.value, 10);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
      alert('Enter both scores');
      return;
    }

    const arr = await loadMatches();
    const updated = arr.map((m) => {
      if (m.id === id) {
        return { ...m, played: true, homeScore, awayScore };
      }
      return m;
    });
    await saveMatches(updated);
    renderMatches();
  });

  cancelBtn.addEventListener('click', renderMatches);
}

function populateOpponentSelect() {
  const sel = document.getElementById('opponentSelect');
  if (!sel) return;
  const teams = readLocal('teams', {});
  sel.innerHTML = '';

  const optChoose = document.createElement('option');
  optChoose.value = '';
  optChoose.textContent = 'Select existing team...';
  sel.appendChild(optChoose);

  Object.keys(teams).forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  const newOpt = document.createElement('option');
  newOpt.value = '__new';
  newOpt.textContent = 'Add new team...';
  sel.appendChild(newOpt);
}

async function ensureClubBadge() {
  const teams = await loadTeams();
  if (teams[clubName]) return;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%230a3923'/><circle cx='50' cy='50' r='40' fill='%231fb44a'/><text x='50' y='60' font-size='40' text-anchor='middle' fill='%23fff' font-family='Arial'>R</text></svg>`;
  teams[clubName] = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  writeLocal('teams', teams);
  await saveTeams(teams);
  populateOpponentSelect();
  renderMatches();
}

if (matchForm) {
  const dateEl = document.getElementById('datetime');
  const locationEl = document.getElementById('location');
  const compEl = document.getElementById('competition');
  const clearMatches = document.getElementById('clearMatches');

  const opponentSelect = document.getElementById('opponentSelect');
  if (opponentSelect) {
    opponentSelect.addEventListener('change', () => {
      const v = opponentSelect.value;
      const newTeam = document.getElementById('newTeam');
      if (newTeam) {
        newTeam.style.display = v === '__new' ? 'block' : 'none';
      }
    });
  }

  matchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isAdminUser(currentUser())) {
      alert('Only the admin account can add matches.');
      return;
    }
    const sel = document.getElementById('opponentSelect');
    let opponent = sel ? sel.value : '';
    const datetime = dateEl ? dateEl.value : '';
    const location = locationEl ? locationEl.value : 'home';
    const competition = compEl ? compEl.value.trim() : '';
    const generation = document.getElementById('generation') ? document.getElementById('generation').value : '';

    if (!datetime) {
      alert('Date/time required');
      return;
    }

    if (opponent === '__new' || opponent === '') {
      const newName = document.getElementById('newOpponent').value.trim();
      if (!newName) {
        alert('Enter new team name');
        return;
      }
      const badgeFile = document.getElementById('newBadge').files[0];
      const teams = readLocal('teams', {});
      const finishAdd = async (badgeData) => {
        if (badgeData) teams[newName] = badgeData;
        writeLocal('teams', teams);
        await saveTeams(teams);
        populateOpponentSelect();
        await addMatch(newName, datetime, location, competition, generation);
      };

      if (badgeFile) {
        const fr = new FileReader();
        fr.onload = () => finishAdd(fr.result);
        fr.readAsDataURL(badgeFile);
      } else {
        await finishAdd(null);
      }
    } else {
      await addMatch(opponent, datetime, location, competition, generation);
    }
  });

  async function addMatch(opponent, datetime, location, competition, generation) {
    const arr = await loadMatches();
    arr.push({
      id: 'm_' + Date.now(),
      opponent,
      datetime,
      location,
      competition,
      generation,
      played: false
    });
    await saveMatches(arr);
    matchForm.reset();
    populateOpponentSelect();
    renderMatches();
  }

  if (clearMatches) {
    clearMatches.addEventListener('click', () => matchForm.reset());
  }

  const tabUpcoming = document.getElementById('tabUpcoming');
  const tabResultsBtn = document.getElementById('tabResultsBtn');
  const panelUpcoming = document.getElementById('panelUpcoming');
  const panelResults = document.getElementById('panelResults');

  function showMatchesTab(panel) {
    if (!panelUpcoming || !panelResults || !tabUpcoming || !tabResultsBtn) return;
    if (panel === 'upcoming') {
      panelUpcoming.style.display = 'block';
      panelResults.style.display = 'none';
      tabUpcoming.classList.add('active');
      tabResultsBtn.classList.remove('active');
    } else {
      panelUpcoming.style.display = 'none';
      panelResults.style.display = 'block';
      tabUpcoming.classList.remove('active');
      tabResultsBtn.classList.add('active');
    }
  }

  if (tabUpcoming) {
    tabUpcoming.addEventListener('click', () => showMatchesTab('upcoming'));
  }
  if (tabResultsBtn) {
    tabResultsBtn.addEventListener('click', () => showMatchesTab('results'));
  }

  document.querySelectorAll('.generation-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setSelectedGenerationFilter(btn.dataset.generation);
      renderMatches();
      showMatchesTab('results');
    });
  });

  setSelectedGenerationFilter(selectedGenerationFilter);
  populateOpponentSelect();
  ensureClubBadge();
  renderMatches();
  showMatchesTab('upcoming');
}

// menu toggle
const menuBtn = document.getElementById('menuBtn');
const menuList = document.getElementById('menuList');
const brandEl = document.querySelector('.brand');
const panels = {
  announcements: document.getElementById('viewAnnouncements'),
  termini: document.getElementById('viewTermini'),
  matches: document.getElementById('viewMatches'),
  chat: document.getElementById('viewChat')
};

function showView(viewName) {
  Object.entries(panels).forEach(([name, panel]) => {
    if (!panel) return;
    panel.classList.toggle('active', name === viewName);
    panel.style.display = name === viewName ? 'block' : 'none';
  });
}

if (brandEl) {
  brandEl.addEventListener('click', () => {
    showView('announcements');
    if (menuList) {
      menuList.classList.remove('show');
    }
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

menuBtn.addEventListener('click', () => {
  const show = menuList.classList.toggle('show');
  menuBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
});

const terminiBtnEl = document.getElementById('terminiBtn');
if (terminiBtnEl) {
  terminiBtnEl.addEventListener('click', () => {
    showView('termini');
    menuList.classList.remove('show');
    menuBtn.setAttribute('aria-expanded', 'false');
  });
}

const matchesBtn = document.getElementById('matchesBtn');
if (matchesBtn) {
  matchesBtn.addEventListener('click', () => {
    showView('matches');
    menuList.classList.remove('show');
    menuBtn.setAttribute('aria-expanded', 'false');
  });
}

const chatBtn = document.getElementById('chatBtn');
if (chatBtn) {
  chatBtn.addEventListener('click', () => {
    showView('chat');
    menuList.classList.remove('show');
    menuBtn.setAttribute('aria-expanded', 'false');
    renderChat();
  });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem(SESSION_USER_KEY);
    showView('announcements');
    showLogin(true);
  });
}

const profileUpload = document.getElementById('profileUpload');
const avatarEl = document.getElementById('avatar');
const removeAvatarBtn = document.getElementById('removeAvatarBtn');
if (profileUpload && avatarEl) {
  avatarEl.addEventListener('click', () => profileUpload.click());
  avatarEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      profileUpload.click();
    }
  });

  profileUpload.addEventListener('change', async () => {
    const file = profileUpload.files && profileUpload.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const data = String(reader.result || '');
      setProfileImage(data);
      await saveProfileImageToServer(data);
      updateAuthUi();
    };
    reader.readAsDataURL(file);
  });
}

if (removeAvatarBtn) {
  removeAvatarBtn.addEventListener('click', async () => {
    const username = currentUser();
    if (!username) return;

    localStorage.removeItem(PROFILE_IMAGE_KEY);
    try {
      await fetchJson(API_BASE + '/users/' + encodeURIComponent(username) + '/avatar', {
        method: 'PUT',
        body: JSON.stringify({ avatar: '' })
      });
    } catch (err) {
      // ignore server issues, local state is still cleared
    }
    updateAuthUi();
  });
}

showView('announcements');

// --- login handling ---
const loginOverlay = document.getElementById('loginOverlay');
const authForm = document.getElementById('authForm');
const authName = document.getElementById('authName');
const authPass = document.getElementById('authPass');
const authTitle = document.getElementById('authTitle');
const authHint = document.getElementById('authHint');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const loginTabBtn = document.getElementById('loginTabBtn');
const signupTabBtn = document.getElementById('signupTabBtn');
let authMode = 'login';

function isLoggedIn() {
  return !!currentUser();
}

function showLogin(show) {
  if (show) {
    document.body.classList.add('locked');
    loginOverlay.style.display = 'flex';
    loginOverlay.setAttribute('aria-hidden', 'false');
    authName.focus();
  } else {
    document.body.classList.remove('locked');
    loginOverlay.style.display = 'none';
    loginOverlay.setAttribute('aria-hidden', 'true');
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  if (authTitle) authTitle.textContent = isLogin ? 'Prijava' : 'Kreiraj račun';
  if (authSubmitBtn) authSubmitBtn.textContent = isLogin ? 'Uđi' : 'Kreiraj račun';
  if (authHint) authHint.textContent = isLogin ? 'Prijavite se da nastavite.' : 'Kreirajte račun i sačuvajte lozinku.';
  if (loginTabBtn) loginTabBtn.classList.toggle('active', isLogin);
  if (signupTabBtn) signupTabBtn.classList.toggle('active', !isLogin);
}

function logInUser(username) {
  localStorage.setItem(SESSION_USER_KEY, username);
  updateAuthUi();
  showLogin(false);
}

if (loginTabBtn) {
  loginTabBtn.addEventListener('click', () => setAuthMode('login'));
}
if (signupTabBtn) {
  signupTabBtn.addEventListener('click', () => setAuthMode('signup'));
}

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = normalizeName(authName.value);
  const pass = (authPass.value || '').trim();
  if (!name || !pass) {
    alert('Name and password are required.');
    return;
  }

  try {
    if (authMode === 'signup') {
      const result = await fetchJson(API_BASE + '/users', {
        method: 'POST',
        body: JSON.stringify({ username: name, password: pass })
      });
      if (result && result.avatar) {
        setProfileImage(result.avatar);
      }
      logInUser(result.username || name);
      alert('Account created successfully.');
      return;
    }

    const result = await fetchJson(API_BASE + '/users/login', {
      method: 'POST',
      body: JSON.stringify({ username: name, password: pass })
    });

    if (result && result.ok) {
      if (result.avatar) {
        setProfileImage(result.avatar);
      }
      logInUser(result.username || name);
      return;
    }

    alert('Wrong username or password.');
  } catch (err) {
    if (authMode === 'signup') {
      const message = err && err.message ? err.message : '';
      if (message.includes('User exists') || message.includes('409')) {
        alert('That account already exists. Please sign in instead.');
      } else {
        alert('Could not create the account right now.');
      }
      return;
    }

    alert('Wrong username or password.');
  }
});

ensureDefaultAdminUser();

if (!isLoggedIn()) {
  setAuthMode('login');
  showLogin(true);
} else {
  setAuthMode('login');
  showLogin(false);
  fetchCurrentUserProfile();
}

updateAuthUi();
render();
renderChat();

