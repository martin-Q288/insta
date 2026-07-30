#!/usr/bin/env node
// 대기 중인 글을 발행한다. 같은 글을 두 번 올리지 않고, day 순서를 거스르지 않는다.
//
// 사용: node bin/publish.mjs [--dry]

import { join } from "node:path";
import { loadConfig, loadPosts, ROOT } from "../lib/config.mjs";
import { ThreadsClient, postLength, MAX_POST_LENGTH } from "../lib/threads-api.mjs";
import { Store } from "../lib/state.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const dry = process.argv.includes("--dry");
const log = (...a) => console.log(...a);

export async function publishDuePosts({ cfg, posts, store, client, dry = false }) {
  // 1일차 기준점 = 가장 먼저 발행된 글의 시각. 아직 없으면 오늘이 1일차.
  const times = Object.values(store.data.posts).map((p) => Date.parse(p.at));
  const firstAt = times.length ? Math.min(...times) : Date.now();
  const currentDay = Math.floor((Date.now() - firstAt) / DAY_MS) + 1;

  const used = store.postsInLast24h();
  let budget = Math.max(0, cfg.limits.postsPerDay - used);
  log(`오늘은 ${currentDay}일차 · 최근 24시간 발행 ${used}/${cfg.limits.postsPerDay}건`);

  const due = posts.filter(
    (p) =>
      !store.isPostPublished(p.id) &&
      p.day <= currentDay &&
      (!p.at || Date.now() >= Date.parse(p.at)),
  );

  if (!due.length) {
    const pending = posts.filter((p) => !store.isPostPublished(p.id));
    log(
      pending.length
        ? `지금 올릴 글 없음 — 대기 ${pending.length}건 (가장 빠른 건 ${Math.min(...pending.map((p) => p.day))}일차)`
        : "모든 글이 발행 완료됐습니다.",
    );
    return [];
  }

  const published = [];
  for (const post of due) {
    if (budget <= 0) {
      log(`일일 한도 도달 — ${post.id} 부터 다음 실행으로 넘김`);
      break;
    }
    const len = postLength(post.text);
    if (len > MAX_POST_LENGTH) {
      log(`건너뜀 ${post.id}: ${len}자 > ${MAX_POST_LENGTH}자`);
      continue;
    }
    if (dry) {
      log(`[dry] ${post.id} (${len}자) 발행 예정`);
      budget--;
      continue;
    }
    try {
      const mediaId = await client.publishText(post.text, {
        publishDelayMs: cfg.limits.publishDelayMs,
      });
      store.recordPost(post.id, mediaId);
      published.push({ id: post.id, mediaId });
      budget--;
      log(`발행 완료 ${post.id} → ${mediaId}`);
    } catch (err) {
      log(`발행 실패 ${post.id}: ${err.message}`);
      if (err.permanent) log("  (4xx — 재시도해도 같습니다. 토큰·권한을 확인하세요.)");
      break; // 한 건이라도 실패하면 멈춘다. 순서가 무너지는 게 더 나쁘다.
    }
  }
  return published;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const posts = loadPosts();
  const store = new Store(join(ROOT, "state", "state.json"));
  const client = new ThreadsClient({ ...cfg.threads, log });
  await publishDuePosts({ cfg, posts, store, client, dry });
}
