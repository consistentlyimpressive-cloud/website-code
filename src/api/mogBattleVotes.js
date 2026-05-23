import { CURRENT_MOGBATTLE_ID } from '../data/mogBattles';
import { getApiBase } from '../utils/apiBase';

const API_BASE = getApiBase();
const PUBLIC_FETCH_TIMEOUT_MS = 3500;

function fetchWithTimeout(url, options = {}, timeoutMs = PUBLIC_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId));
}

/** Vote totals for each featured battle id (for rotating the main slot). */
export async function fetchFeaturedVoteRankings(battleIds) {
  if (!battleIds?.length) return [];
  const results = await Promise.all(
    battleIds.map(async (id) => {
      try {
        const r = await fetch(`${API_BASE}/api/mog-battle/votes/${encodeURIComponent(id)}`);
        if (!r.ok) return { id, a: 0, b: 0, total: 0 };
        const j = await r.json();
        const a = Number(j.a) || 0;
        const b = Number(j.b) || 0;
        return { id, a, b, total: a + b };
      } catch {
        return { id, a: 0, b: 0, total: 0 };
      }
    })
  );
  return results.sort((x, y) => y.total - x.total);
}

export async function fetchMogBattleTallies(battleId = CURRENT_MOGBATTLE_ID) {
  const r = await fetch(`${API_BASE}/api/mog-battle/votes/${encodeURIComponent(battleId)}`);
  if (!r.ok) throw new Error('Could not load vote totals');
  return r.json();
}

export async function fetchMyMogBattleVote(idToken, battleId = CURRENT_MOGBATTLE_ID) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const r = await fetch(`${API_BASE}/api/mog-battle/my-vote/${encodeURIComponent(battleId)}`, {
    headers,
  });
  const data = await r.json().catch(() => ({}));
  return data;
}

export async function postMogBattleVote(idToken, side, battleId = CURRENT_MOGBATTLE_ID) {
  const r = await fetch(`${API_BASE}/api/mog-battle/vote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ battleId, side }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function fetchCommunityBattles() {
  const r = await fetchWithTimeout(`${API_BASE}/api/mog-battle/community`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not load community battles');
  return r.json();
}

export async function fetchCommunityScans(limit = 40) {
  const r = await fetchWithTimeout(`${API_BASE}/api/community-scans?limit=${encodeURIComponent(limit)}`, {
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('Could not load community scans');
  return r.json();
}

export async function postCommunityBattle(idToken, fighterA, fighterB) {
  const r = await fetch(`${API_BASE}/api/mog-battle/community`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fighterA, fighterB }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function deleteCommunityBattle(idToken, battleId) {
  const r = await fetch(`${API_BASE}/api/mog-battle/community/${encodeURIComponent(battleId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function adminDeleteCommunityBattle(adminPassword, battleId) {
  const r = await fetch(`${API_BASE}/api/admin/mog-battles/${encodeURIComponent(battleId)}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function adminDeleteCommunityScan(adminPassword, scanDocId) {
  const r = await fetch(`${API_BASE}/api/admin/community-scans/${encodeURIComponent(scanDocId)}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function fetchFollowedMogBattles(idToken) {
  const r = await fetch(`${API_BASE}/api/mog-battle/follows`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Could not load followed battles');
  return data;
}

export async function setMogBattleFollow(idToken, battleId, following) {
  const r = await fetch(`${API_BASE}/api/mog-battle/follow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ battleId, following }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
