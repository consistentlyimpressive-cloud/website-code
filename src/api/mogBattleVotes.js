import { CURRENT_MOGBATTLE_ID } from '../data/mogBattles';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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
