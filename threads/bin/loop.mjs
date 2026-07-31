#!/usr/bin/env node
// 무인 루프: 주기적으로 발행 + 답글 대응. 이게 72시간 동안 돌아가는 프로세스다.
//
// 사용: node bin/loop.mjs [--interval 600]   (초 단위, 기본 600 = 10분)
//
// 여기서 답글 속도가 만들어진다. 새벽 3시에 달린 댓글에 10분 안에 답이 가는 건
// 사람이 못 하는 일이고, 자동화의 실제 가치는 양이 아니라 이 반응 속도다.

import { join } from "node:path";
import { loadConfig, loadPosts, ROOT } from "../lib/config.mjs";
import { ThreadsClient } from "../lib/threads-api.mjs";
import { Store } from "../lib/state.mjs";
import { ReplyDrafter } from "../lib/draft.mjs";
import { BroadcastDrafter } from "../lib/broadcast.mjs";
import { publishDuePosts } from "./publish.mjs";
import { handleReplies } from "./reply.mjs";
import { broadcastOnce } from "./broadcast.mjs";

const argIdx = process.argv.indexOf("--interval");
const intervalSec = argIdx > -1 ? Number(process.argv[argIdx + 1]) : 600;
if (!Number.isFinite(intervalSec) || intervalSec < 60) {
  console.error("--interval 은 60초 이상이어야 합니다");
  process.exit(1);
}

const cfg = loadConfig();
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

const store = new Store(join(ROOT, "state", "state.json"));
const client = new ThreadsClient({ ...cfg.threads, log });
const drafter = new ReplyDrafter({
  apiKey: cfg.anthropic.apiKey,
  model: cfg.anthropic.model,
  effort: cfg.anthropic.effort,
  product: cfg.product,
  escalate: cfg.escalate,
  log,
});
const broadcaster = new BroadcastDrafter({
  apiKey: cfg.anthropic.apiKey,
  model: cfg.anthropic.model,
  effort: cfg.anthropic.effort,
  product: cfg.product,
  log,
});

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (stopping) process.exit(1); // 두 번 누르면 즉시 종료
    stopping = true;
    log(`${sig} 수신 — 이번 주기 마치고 종료합니다 (한 번 더 누르면 즉시)`);
  });
}

log(`루프 시작 · 주기 ${intervalSec}초 · 모델 ${cfg.anthropic.model}`);

while (!stopping) {
  try {
    // posts.md 를 매 주기 다시 읽는다 — 돌아가는 중에 글을 추가할 수 있다.
    const posts = loadPosts();
    await publishDuePosts({ cfg, posts, store, client });
    // 판매 상황에 사건이 생겼으면 중계한다. 시작 전이면 아무것도 안 한다.
    await broadcastOnce({ cfg, store, client, drafter: broadcaster });
    await handleReplies({ cfg, posts, store, client, drafter });
  } catch (err) {
    log(`주기 실패: ${err.message}`); // 죽지 않는다. 다음 주기에 다시 시도.
  }
  if (stopping) break;
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}

log("종료");
