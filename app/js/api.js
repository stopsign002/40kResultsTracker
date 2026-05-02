const API_BASE = '/api';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText);
    err.status = res.status;
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
};

export const reference = {
  factions:        () => api.get('/reference/factions'),
  detachments:     (factionId) => api.get(`/reference/factions/${factionId}/detachments`),
  missionPacks:    () => api.get('/reference/mission-packs'),
  missionDetails:  (packId) => api.get(`/reference/mission-packs/${packId}/details`),
  users:           () => api.get('/reference/users'),
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
};

export const admin = {
  users:        () => api.get('/admin/users'),
  createUser:   (data) => api.post('/admin/users', data),
  updateUser:   (id, data) => api.patch(`/admin/users/${id}`, data),
  setVisibility:(gameId, hidden) => api.patch(`/admin/games/${gameId}/visibility`, { hidden }),
};

function qstr(q) {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== '' && v != null) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}
