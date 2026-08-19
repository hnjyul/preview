// ── 투표 설정 ──────────────────────────────────────────────
// 투표 기능 on/off. false 면 투표 UI가 전부 숨겨지고 서버도 투표를 거부한다.
// 다른 시안 확인 작업에 이 사이트를 재사용할 때는 false 로 둔다.
const VOTE_ENABLED = false;

// 마감 일시(KST). null 이면 마감 없이 상시 투표.
// 마감·집계·1인 1표는 모두 서버가 판정하므로 클라이언트 시계 조작으로 우회되지 않는다.
const VOTE_DEADLINE = null;

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
    voteEnabled: VOTE_ENABLED,
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

// 시안 1장을 휴대폰에서 보기 좋게 띄우는 최소 페이지. QR 코드가 이 주소를 가리킨다.
function sheetPage(id) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${id}안 · 한국수력원자력 모바일 앱 디자인 시안</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f3f4f5; color: #1A1A18; word-break: keep-all;
    font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; padding: 14px 16px;
    background: rgba(243,244,245,.92); backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(0,0,0,.1); }
  h1 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
  a { color: #1B4CD8; text-decoration: none; font-size: 13px; white-space: nowrap; }
  main { padding: 12px; }
  img { display: block; width: 100%; height: auto; border-radius: 14px; background: #fff;
    box-shadow: 0 1px 2px rgba(24,22,18,.04), 0 12px 28px -18px rgba(24,22,18,.22); }
  footer { padding: 20px 16px 32px; text-align: center; font-size: 12px; color: #8C8880; }
</style>
</head>
<body>
<header><h1>${id}안</h1><a href="/">← 전체 시안 보기</a></header>
<main><img src="/assets/${id}.png" alt="${id}안 시안"></main>
<footer>한국수력원자력 모바일 앱 디자인 시안</footer>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 시안별 모바일 보기 (/s/A ~ /s/E) — QR 코드가 가리키는 주소
    if (url.pathname.startsWith("/s/")) {
      const id = url.pathname.slice(3).replace(/\/+$/, "").toUpperCase();
      if (!CHOICES.includes(id)) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(sheetPage(id), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    if (url.pathname === "/api/state" || url.pathname === "/api/vote") {
      const voter = resolveVoter(request, url);
      const cookie = cookieFor(voter, url);

      if (url.pathname === "/api/state") {
        return json(await readState(env, voter.id), 200, cookie);
      }
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405, cookie);
      }
      if (!VOTE_ENABLED) {
        return json({ error: "vote_disabled", ...(await readState(env, voter.id)) }, 403, cookie);
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
