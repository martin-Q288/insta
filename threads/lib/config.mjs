import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(path = join(ROOT, "config.json")) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT")
      throw new Error(
        `설정 파일이 없습니다: ${path}\nconfig.example.json 을 config.json 으로 복사해서 채우세요.`,
      );
    throw err;
  }
  const cfg = JSON.parse(raw);

  // 토큰은 파일보다 환경변수를 우선한다 (커밋 사고 방지).
  cfg.threads ??= {};
  cfg.threads.accessToken =
    process.env.THREADS_ACCESS_TOKEN || cfg.threads.accessToken;
  cfg.threads.userId = process.env.THREADS_USER_ID || cfg.threads.userId;
  cfg.anthropic ??= {};
  cfg.anthropic.apiKey = process.env.ANTHROPIC_API_KEY || cfg.anthropic.apiKey;

  cfg.anthropic.model ||= "claude-opus-5";
  cfg.anthropic.effort ||= "low";
  cfg.limits ??= {};
  cfg.limits.postsPerDay ??= 6;
  cfg.limits.repliesPerDay ??= 80;
  cfg.limits.publishDelayMs ??= 4000;
  cfg.escalate ??= [];

  const missing = [];
  if (!cfg.threads.userId) missing.push("threads.userId");
  if (!cfg.threads.accessToken) missing.push("threads.accessToken");
  if (!cfg.anthropic.apiKey) missing.push("anthropic.apiKey (또는 ANTHROPIC_API_KEY)");
  if (missing.length) throw new Error(`설정 누락: ${missing.join(", ")}`);

  return cfg;
}

/**
 * posts.md 파싱. 형식:
 *
 *   # id: 01-result-hook
 *   # day: 1
 *   본문 첫 줄
 *   본문 둘째 줄
 *   ===
 *   # id: 02-...
 *
 * `day` 는 첫 발행일로부터의 상대 일차(1부터). 이걸로 순서를 강제해서
 * 판매 글이 1일차에 나가는 사고를 막는다. 없으면 1로 본다.
 * `at` 은 선택 — 절대 시각이 필요할 때만. 있으면 그 시각 이후에만 발행된다.
 *
 * 본문 앞의 `#` 로 시작하는 줄은 헤더 아니면 주석으로 취급해 본문에서 빼낸다.
 * 「」 로 감싼 부분은 미기입 자리로 보고 발행을 막는다.
 */

/** 본문에 남아 있는 「미기입 자리」 목록. 비어 있어야 발행 가능. */
export function findPlaceholders(text) {
  return [...text.matchAll(/「([^」]*)」/g)].map((m) => m[1] || "(빈 자리)");
}
export function loadPosts(path = join(ROOT, "posts.md")) {
  const src = readFileSync(path, "utf8");
  const blocks = src
    .split(/^===\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const posts = [];
  const seen = new Set();
  for (const block of blocks) {
    const lines = block.split("\n");
    const meta = {};
    let i = 0;
    for (; i < lines.length; i++) {
      if (!lines[i].startsWith("#")) break; // 여기부터 본문
      const m = /^#\s*([a-zA-Z_]+)\s*:\s*(.+?)\s*$/.exec(lines[i]);
      if (m) meta[m[1]] = m[2]; // 헤더
      // 그 외 `#` 줄은 주석 — 본문에 넣지 않는다
    }
    const text = lines.slice(i).join("\n").trim();
    if (!meta.id) throw new Error(`posts.md: id 없는 블록\n${block.slice(0, 80)}`);
    if (seen.has(meta.id)) throw new Error(`posts.md: id 중복 — ${meta.id}`);
    seen.add(meta.id);
    if (!text) throw new Error(`posts.md: ${meta.id} 본문이 비어 있음`);
    if (meta.at && Number.isNaN(Date.parse(meta.at)))
      throw new Error(`posts.md: ${meta.id} 의 at 을 파싱할 수 없음 — ${meta.at}`);
    const day = meta.day === undefined ? 1 : Number(meta.day);
    if (!Number.isInteger(day) || day < 1)
      throw new Error(`posts.md: ${meta.id} 의 day 는 1 이상 정수여야 함 — ${meta.day}`);
    posts.push({ id: meta.id, day, at: meta.at ?? null, text });
  }
  return posts;
}
