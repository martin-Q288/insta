#!/usr/bin/env node
// 아무것도 게시하지 않고 세팅을 점검한다. 처음 돌릴 때 이걸 먼저 통과시키세요.

import Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";
import { loadConfig, loadPosts, findPlaceholders, ROOT } from "../lib/config.mjs";
import { ThreadsClient, postLength, MAX_POST_LENGTH } from "../lib/threads-api.mjs";
import { Store } from "../lib/state.mjs";
import { totalIfSoldOut } from "../lib/sales.mjs";

let failed = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => {
  failed++;
  console.log(`  실패  ${m}`);
};

console.log("\n[1] 설정");
let cfg;
try {
  cfg = loadConfig();
  ok(`config.json 로드 (모델 ${cfg.anthropic.model}, effort ${cfg.anthropic.effort})`);
  ok(`한도: 글 ${cfg.limits.postsPerDay}/일 · 답글 ${cfg.limits.repliesPerDay}/일`);
  console.log(
    cfg.escalate.length
      ? `  OK    사람에게 넘기는 항목 ${cfg.escalate.length}개`
      : "  주의  escalate 가 비어 있음 — 환불·법적 문의까지 전부 자동 답변됩니다",
  );
  for (const [k, v] of Object.entries(cfg.product)) {
    if (typeof v === "string" && v.startsWith("여기에")) bad(`product.${k} 를 채우세요`);
  }
} catch (err) {
  bad(err.message);
  process.exit(1);
}

console.log("\n[2] 글 목록");
try {
  const posts = loadPosts();
  ok(`${posts.length}건 파싱`);
  for (const p of posts) {
    const n = postLength(p.text);
    if (n > MAX_POST_LENGTH) bad(`${p.id}: ${n}자 > ${MAX_POST_LENGTH}자`);
    const holes = findPlaceholders(p.text);
    if (holes.length) bad(`${p.id}: 미기입 자리 — ${holes.join(", ")}`);
  }
  const byDay = posts.reduce((m, p) => ((m[p.day] = (m[p.day] ?? 0) + 1), m), {});
  ok(
    `일차별 배분 ${Object.entries(byDay)
      .map(([d, n]) => `${d}일차 ${n}건`)
      .join(" · ")}`,
  );
  const maxDay = Math.max(...posts.map((p) => p.day));
  for (let d = 1; d <= maxDay; d++)
    if ((byDay[d] ?? 0) > cfg.limits.postsPerDay)
      bad(`${d}일차 글 ${byDay[d]}건이 일일 한도 ${cfg.limits.postsPerDay}건을 넘습니다`);
} catch (err) {
  bad(err.message);
}

console.log("\n[3] 스레드 토큰");
try {
  const client = new ThreadsClient({ ...cfg.threads, log: () => {} });
  const posts = await client.listMyPosts({ limit: 1 });
  ok(`토큰 유효 — 내 글 조회 성공 (${posts.length}건 반환)`);
} catch (err) {
  bad(`스레드 API: ${err.message}`);
  console.log(
    "        threads_basic / threads_content_publish / threads_manage_replies 권한과",
  );
  console.log("        토큰 만료 여부를 확인하세요.");
}

console.log("\n[4] Anthropic 키");
try {
  const anthropic = new Anthropic({ apiKey: cfg.anthropic.apiKey });
  const m = await anthropic.models.retrieve(cfg.anthropic.model);
  ok(`키 유효 — ${m.display_name ?? m.id} 사용 가능`);
} catch (err) {
  bad(`Anthropic API: ${err.message}`);
}

console.log("\n[5] 판매 중계 설정");
{
  const { total, startPrice, step } = cfg.sales;
  ok(
    `${total}권 한정 · ${startPrice.toLocaleString("ko-KR")}원 시작 · ` +
      `건당 ${step.toLocaleString("ko-KR")}원 인상 → 완판 시 ` +
      `${totalIfSoldOut(cfg.sales).toLocaleString("ko-KR")}원`,
  );
  // 판매 글에 적힌 숫자와 여기 설정이 어긋나면 중계 글이 거짓말을 한다.
  //
  // 대상은 "구체적인 수량을 못박은 글"이다. 가격 규칙을 설명하기만 하는 글
  // (예: "수량을 한정하고 한 권 나갈 때마다 올린다")은 숫자를 주장하지 않으므로
  // 대조 대상이 아니다. 예전에 '한정' 이라는 낱말만 보고 골랐더니 설명 글이
  // 걸려서 멀쩡한 세팅이 실패로 떴다.
  try {
    const claims = loadPosts().filter((p) => p.day >= 3 && /\d+\s*권/.test(p.text));
    if (!claims.length) {
      bad("판매 수량을 못박은 글이 없습니다 — 오퍼 글에 '30권 한정' 같은 문구가 있어야 합니다");
    }
    const won = (n) => n.toLocaleString("ko-KR");
    for (const offer of claims) {
      if (!offer.text.includes(won(startPrice)))
        bad(`${offer.id} 의 가격이 sales.startPrice(${won(startPrice)}원)와 다릅니다`);
      if (!offer.text.includes(`${total}권`))
        bad(`${offer.id} 의 수량이 sales.total(${total}권)과 다릅니다`);
    }
  } catch {
    /* [2] 에서 이미 보고했다 */
  }
}

console.log("\n[6] 상태 파일");
const store = new Store(join(ROOT, "state", "state.json"));
ok(
  `발행 완료 ${Object.keys(store.data.posts).length}건 · 처리한 답글 ${
    Object.keys(store.data.replies).length
  }건`,
);
ok(
  store.sales.launchedAt
    ? `판매 진행 중 — ${store.sales.sold}/${cfg.sales.total}권 (시작 ${store.sales.launchedAt})`
    : "판매 시작 전 — `npm run broadcast -- --launch` 로 엽니다",
);

console.log(
  failed
    ? `\n${failed}건 실패. 위 항목을 고친 뒤 다시 실행하세요.\n`
    : "\n전부 통과. `npm run publish -- --dry` 로 무엇이 올라갈지 먼저 확인하세요.\n",
);
process.exit(failed ? 1 : 0);
