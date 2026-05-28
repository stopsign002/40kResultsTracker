const API_BASE = '/api';

// Server error shape: { error: string, code?: string }.
// Network failures throw with status=0 and an offline-ish message.
async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (netErr) {
    const err = new Error('network unreachable');
    err.status = 0;
    err.code = 'network';
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch { /* response had no JSON body */ }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.code;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get:    (p)    => request('GET', p),
  post:   (p, b) => request('POST', p, b),
  put:    (p, b) => request('PUT', p, b),
  patch:  (p, b) => request('PATCH', p, b),
  del:    (p)    => request('DELETE', p),
};

export const auth = {
  me:     () => api.get('/auth/me'),
  login:  (username, password) => api.post('/auth/login', { username, password }),
  logout: () => api.post('/auth/logout', {}),
  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  updateMe: (data) => api.patch('/auth/me', data),
};

export const seasons = {
  list:   () => api.get('/seasons'),
  start:  (data) => api.post('/seasons', data),
};

export const reference = {
  factions:        () => api.get('/reference/factions'),
  detachments:     (factionId) => api.get(`/reference/factions/${factionId}/detachments`),
  missionPacks:    () => api.get('/reference/mission-packs'),
  missionDetails:  (packId) => api.get(`/reference/mission-packs/${packId}/details`),
  users:           () => api.get('/reference/users'),
  players:         () => api.get('/reference/players'),
  playerNames:     () => api.get('/reference/player-names'),
};

export const games = {
  list:   (filters = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== '' && v != null) qs.set(k, v);
    }
    const s = qs.toString();
    return api.get('/games' + (s ? '?' + s : ''));
  },
  get:    (id) => api.get(`/games/${id}`),
  create: (payload) => api.post('/games', payload),
  update: (id, payload) => api.put(`/games/${id}`, payload),
};

export const stats = {
  overview:               (q) => api.get('/stats/overview' + qstr(q)),
  factionWinRates:        (q) => api.get('/stats/faction-winrates' + qstr(q)),
  playerWinRates:         (q) => api.get('/stats/player-winrates' + qstr(q)),
  factionMissionBreakdown:(factionId) => api.get('/stats/faction-mission-breakdown?factionId=' + factionId),
  factionDeploymentBreakdown:(factionId) => api.get('/stats/faction-deployment-breakdown?factionId=' + factionId),
  factionMatchups:        () => api.get('/stats/faction-matchups'),
  headToHead:             (a, b) => api.get(`/stats/head-to-head?userA=${a}&userB=${b}`),
  firstTurnImpact:        (q) => api.get('/stats/first-turn-impact' + qstr(q)),
  secondaryAverages:      () => api.get('/stats/secondary-averages'),
  warmap:                 (seasonId, throughGameId) => {
                            const params = [];
                            if (seasonId)       params.push('season=' + seasonId);
                            if (throughGameId)  params.push('through_game_id=' + throughGameId);
                            return api.get('/stats/warmap' + (params.length ? '?' + params.join('&') : ''));
                          },
  warmapTimeline:         (seasonId) => api.get('/stats/warmap-timeline' + (seasonId ? '?season=' + seasonId : '')),
  detachmentWinRates:     (factionId) => api.get('/stats/detachment-winrates' + (factionId ? '?factionId=' + factionId : '')),
  trends:                 () => api.get('/stats/trends'),
  player:                 (playerKey) => api.get('/stats/player/' + encodeURIComponent(playerKey)),
  calendar:               (days) => api.get('/stats/calendar' + (days ? '?days=' + days : '')),
};

export const admin = {
  users:        () => api.get('/admin/users'),
  createUser:   (data) => api.post('/admin/users', data),
  updateUser:   (id, data) => api.patch(`/admin/users/${id}`, data),
  setVisibility:(gameId, hidden) => api.patch(`/admin/games/${gameId}/visibility`, { hidden }),
  deleteGame:   (gameId) => api.del(`/admin/games/${gameId}`),
  audit:        (limit) => api.get('/admin/audit' + (limit ? '?limit=' + limit : '')),
  guestsPreview:() => api.get('/admin/guests/preview'),
  promoteGuests:() => api.post('/admin/promote-guests', {}),
};

// Admin-only player ranking + balanced matchmaking. model = 'glicko' | 'whr'.
export const ratings = {
  leaderboard:   (marginOfVictory, model) => api.get('/ratings/leaderboard' + qstr({ marginOfVictory, model })),
  suggest:       (presentIds, marginOfVictory, model) =>
                   api.get('/ratings/suggest' + qstr({ present: (presentIds || []).join(','), marginOfVictory, model })),
  history:       (marginOfVictory, model) => api.get('/ratings/history' + qstr({ marginOfVictory, model })),
};

function qstr(q) {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== '' && v != null) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}
