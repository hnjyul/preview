-- 투표 저장소. voter 가 PRIMARY KEY 이므로 1인 1표를 DB가 강제한다.
CREATE TABLE IF NOT EXISTS votes (
  voter  TEXT PRIMARY KEY,   -- 'r:<개인링크토큰>' 또는 'c:<쿠키 UUID>'
  choice TEXT NOT NULL,      -- 'A' ~ 'E'
  ts     INTEGER NOT NULL    -- 투표 시각 (epoch ms)
);
CREATE INDEX IF NOT EXISTS idx_votes_choice ON votes(choice);
