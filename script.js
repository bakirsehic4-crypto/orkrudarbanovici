// Simple announcements app with server-friendly storage
const form = document.getElementById('announcementForm');
const messageInput = document.getElementById('message');
const listEl = document.getElementById('announcements');
const clearBtn = document.getElementById('clearBtn');
const matchForm = document.getElementById('matchForm');
const clubName = 'ORK Rudar Banovići';
const API_BASE = 'https://orkrudarbanovici-1.onrender.com/api';;
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const USERS_KEY = 'club_users';
const SESSION_USER_KEY = 'club_session_user';

function ensureDefaultAdminUser() {
  const users = getUsers();
  if (!users[ADMIN_USERNAME]) {
    users[ADMIN_USERNAME] = { name: ADMIN_USERNAME, password: ADMIN_PASSWORD };
    saveUsers(users);
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

function currentUser() {
  const raw = localStorage.getItem(SESSION_USER_KEY);
  return raw || '';
}

function isAdminUser(username) {
  return normalizeName(username) === ADMIN_USERNAME;
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
  if (avatarEl) {
    const initial = (user.trim().charAt(0) || 'A').toUpperCase();
    avatarEl.textContent = initial;
    avatarEl.title = user || 'User';
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
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

async function render() {
  const items = await loadAnnouncements();
  listEl.innerHTML = '';
  if (items.length === 0) {
    listEl.innerHTML = '<li class="announcement">No announcements yet.</li>';
    return;
  }
  items.forEach(it => {
    const li = document.createElement('li');
    li.className = 'announcement';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = formatDisplayDateTime(it.ts);
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = it.message;
    li.appendChild(meta);
    li.appendChild(msg);
    listEl.appendChild(li);
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
  writeLocal('matches', arr);
  try {
    await fetchJson(API_BASE + '/matches', {
      method: 'POST',
      body: JSON.stringify(arr)
    });
  } catch (err) {
    // fallback while server is not available
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

function getTeamBadge(name, teams) {
  return teams[name] || null;
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

    const playBtn = document.createElement('button');
    playBtn.className = 'small btn';
    playBtn.textContent = 'Enter Result';
    playBtn.addEventListener('click', () => showResultInputs(it.id, el, it));

    const del = document.createElement('button');
    del.className = 'small btn secondary';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
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
    del.addEventListener('click', async () => {
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
  matches: document.getElementById('viewMatches')
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

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem(SESSION_USER_KEY);
    showView('announcements');
    showLogin(true);
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
  if (authTitle) authTitle.textContent = isLogin ? 'Sign in' : 'Create account';
  if (authSubmitBtn) authSubmitBtn.textContent = isLogin ? 'Enter' : 'Create account';
  if (authHint) authHint.textContent = isLogin ? 'Use your saved account to continue.' : 'Create your account and save your password.';
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

authForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = normalizeName(authName.value);
  const pass = (authPass.value || '').trim();
  if (!name || !pass) {
    alert('Name and password are required.');
    return;
  }

  const users = getUsers();

  if (authMode === 'signup') {
    if (users[name]) {
      alert('That account already exists. Please sign in instead.');
      return;
    }
    users[name] = { name, password: pass };
    saveUsers(users);
    logInUser(name);
    alert('Account created successfully.');
    return;
  }

  const user = users[name];
  if (!user || user.password !== pass) {
    alert('Wrong username or password.');
    return;
  }

  logInUser(name);
});

ensureDefaultAdminUser();

if (!isLoggedIn()) {
  setAuthMode('login');
  showLogin(true);
} else {
  setAuthMode('login');
  showLogin(false);
}

updateAuthUi();
render();

