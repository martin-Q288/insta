#!/usr/bin/env node
// 판매 상황을 보고 중계할 사건이 있으면 한 편 올린다.
//
// 사용:
//   node bin/broadcast.mjs                 판매 시작 + 중계 (아직 안 열었으면 엶)
//   node bin/broadcast.mjs --sold 3        누적 3권으로 갱신하고 중계
//   node bin/broadcast.mjs --dry           올리지 않고 무엇이 나갈지만 본다
//
// 한 번 실행에 한 편만 올린다. 수량을 몰아서 입력해도 도배가 안 되게,
// 걸린 사건 중 가장 중요한 하나만 쓰고 나머지는 접는다.

import { join } from "node:path";
import { loadConfig, ROOT } from "../lib/config.mjs";
import { ThreadsClient, postLength } from "../lib/threads-api.mjs";
import { Store } from "../lib/state.mjs";
import { BroadcastDrafter } from "../lib/broadcast.mjs";
import { computeMilestones, pickNext } from "../lib/sales.mjs";

const log = (...a) => console.log(...a);

export async function broadcastOnce({ cfg, store, client, drafter, dry = false }) {
  const s = cfg.sales;
  const launchedAt = store.sales.launchedAt;
  if (!launchedAt) {
    log("판매 시작 전입니다. `node bin/broadcast.mjs --launch` 로 여세요.");
    return null;
  }

  const milestones = computeMilestones({
    sold: store.sales.sold,
    total: s.total,
    startPrice: s.startPrice,
    step: s.step,
    launchedAt,
    everyN: s.everyN,
    quietHours: s.quietHours,
    almostLeft: s.almostLeft,
  });

  const { pick, superseded } = pickNext(milestones, (k) => store.isMilestoneDone(k));
  if (!pick) {
    log(`중계할 사건 없음 — ${store.sales.sold}/${s.total}권`);
    return null;
  }

  // 하루 발행 한도는 중계에도 똑같이 적용한다. 사건이 몰려도 도배는 안 된다.
  const used = store.postsInLast24h();
  if (used >= cfg.limits.postsPerDay) {
    log(`일일 발행 한도 도달 (${used}/${cfg.limits.postsPerDay}) — 다음 실행으로 넘깁니다`);
    return null;
  }

  log(`중계할 사건: ${pick.key} (${pick.kind})`);
  const drafted = await drafter.draft(pick, store.recentBroadcasts());
  if (!drafted) {
    log("초안을 못 만들었습니다 — 이번 실행은 건너뜁니다 (다음에 다시 시도)");
    return null;
  }

  log(`─ 초안 (${postLength(drafted.post)}자) ─\n${drafted.post}\n─────`);
  log(`이유: ${drafted.reason}`);

  if (dry) {
    if (superseded.length) log(`[dry] 함께 접힐 사건: ${superseded.map((m) => m.key).join(", ")}`);
    return { key: pick.key, text: drafted.post, mediaId: null };
  }

  const mediaId = await client.publishText(drafted.post, {
    publishDelayMs: cfg.limits.publishDelayMs,
  });
  store.recordMilestone(pick.key, { mediaId });
  store.rememberBroadcast(drafted.post);
  // 같이 걸렸던 나머지는 지나간 것으로 표시한다. 나중에 뒤늦게 나가면 이상하다.
  for (const m of superseded) store.recordMilestone(m.key, { superseded: true });

  log(`발행 완료 ${pick.key} → ${mediaId}`);
  if (superseded.length) log(`함께 접음: ${superseded.map((m) => m.key).join(", ")}`);
  log("판매 링크를 첫 댓글에 직접 달아주세요. 본문에는 넣지 않았습니다.");
  return { key: pick.key, text: drafted.post, mediaId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const cfg = loadConfig();
  const store = new Store(join(ROOT, "state", "state.json"));

  if (argv.includes("--launch")) {
    const at = store.launch();
    log(`판매 시작 시각: ${at}`);
  }

  const i = argv.indexOf("--sold");
  if (i > -1) {
    const n = Number(argv[i + 1]);
    store.setSold(n);
    log(`누적 판매 ${n}권으로 갱신`);
  }

  const client = new ThreadsClient({ ...cfg.threads, log });
  const drafter = new BroadcastDrafter({
    apiKey: cfg.anthropic.apiKey,
    model: cfg.anthropic.model,
    effort: cfg.anthropic.effort,
    product: cfg.product,
    log,
  });
  await broadcastOnce({ cfg, store, client, drafter, dry });
}
