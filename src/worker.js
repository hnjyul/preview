// ── 투표 설정 ──────────────────────────────────────────────
// 마감 일시(KST). 이 값만 고치면 됩니다. null 이면 마감 없이 상시 투표.
// 마감·집계·1인 1표는 모두 서버가 판정하므로 클라이언트 시계 조작으로 우회되지 않습니다.
const VOTE_DEADLINE = "2026-08-26T18:00:00+09:00";

const CHOICES = ["A", "B", "C", "D", "E"];
const COOKIE_NAME = "pv_voter";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90일

const DEADLINE_AT = VOTE_DEADLINE ? Date.parse(VOTE_DEADLINE) : null;
const isClosed = () => DEADLINE_AT !== null && Date.now() >= DEADLINE_AT;

function readCookie(header, name) {
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// 투표자 식별: ?r=<토큰>(개인 링크)이 있으면 그것을, 없으면 서버 발급 쿠키를 쓴다.
function resolveVoter(request, url) {
  const token = (url.searchParams.get("r") || "").trim();
  if (token) return { id: "r:" + token.slice(0, 64), isNew: false };
  const c = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (c) return { id: "c:" + c, isNew: false };
  return { id: "c:" + crypto.randomUUID(), isNew: true };
}

async function readState(env, voter) {
  const [tally, mine] = await env.VOTES_DB.batch([
    env.VOTES_DB.prepare("SELECT choice, COUNT(*) AS n FROM votes GROUP BY choice"),
    env.VOTES_DB.prepare("SELECT choice FROM votes WHERE voter = ?1").bind(voter),
  ]);
  const votes = {};
  for (const id of CHOICES) votes[id] = 0;
  for (const row of tally.results || []) {
    if (row.choice in votes) votes[row.choice] = Number(row.n) || 0;
  }
  const row = (mine.results || [])[0];
  return {
    votes,
    myVote: row ? row.choice : null,
    closed: isClosed(),
    deadline: VOTE_DEADLINE,
  };
}

function cookieFor(voter, url) {
  if (!voter.isNew) return null;
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return COOKIE_NAME + "=" + voter.id.slice(2) +
    "; Path=/; Max-Age=" + COOKIE_MAX_AGE + "; HttpOnly; SameSite=Lax" + secure;
}

function json(body, status, setCookie) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/state" || url.pathname === "/api/vote") {
      const voter = resolveVoter(request, url);
      const cookie = cookieFor(voter, url);

      if (url.pathname === "/api/state") {
        return json(await readState(env, voter.id), 200, cookie);
      }
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405, cookie);
      }
      if (isClosed()) {
        return json({ error: "closed", ...(await readState(env, voter.id)) }, 403, cookie);
      }

      let choice = null;
      try {
        choice = (await request.json()).choice;
      } catch (e) {}
      if (!CHOICES.includes(choice)) {
        return json({ error: "bad_choice" }, 400, cookie);
      }

      // voter 가 PRIMARY KEY → 이미 투표했으면 changes === 0.
      // 애플리케이션 분기가 아니라 제약조건이 막으므로 동시 클릭에도 중복이 생기지 않는다.
      const res = await env.VOTES_DB
        .prepare("INSERT INTO votes (voter, choice, ts) VALUES (?1, ?2, ?3) ON CONFLICT(voter) DO NOTHING")
        .bind(voter.id, choice, Date.now())
        .run();

      const state = await readState(env, voter.id);
      if (!res.meta || res.meta.changes === 0) {
        return json({ error: "already_voted", ...state }, 409, cookie);
      }
      return json(state, 200, cookie);
    }

    if (url.pathname === "/") {
      url.pathname = "/preview.html";
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};
