// 목 서버로 Threads API 흐름을 검증한다. 실제 자격증명 없이 돌아간다.
//   node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ThreadsClient, postLength, MAX_POST_LENGTH } from "../lib/threads-api.mjs";
import { Store } from "../lib/state.mjs";
import { loadPosts, findPlaceholders } from "../lib/config.mjs";
import {
  computeMilestones,
  pickNext,
  priceAfter,
  totalIfSoldOut,
} from "../lib/sales.mjs";

/** 요청을 기록하는 최소 목 서버. routes: {"METHOD /path": handler} */
async function mockServer(routes) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const params = Object.fromEntries(
      req.method === "GET" ? url.searchParams : new URLSearchParams(raw),
    );
    const path = url.pathname.replace(/^\/v1\.0\//, "");
    calls.push({ method: req.method, path, params });

    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === req.method && new RegExp(`^${p.replace(/\*/g, "[^/]+")}$`).test(path);
    });
    if (!key) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: `no route ${path}` } }));
    }
    const out = await routes[key]({ params, calls });
    res.writeHead(out.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    host: `http://127.0.0.1:${port}/v1.0`,
    calls,
    close: () => new Promise((r) => server.close(r)),
  };
}

const clientFor = (host) =>
  new ThreadsClient({ host, userId: "999", accessToken: "tok", log: () => {} });

test("글 발행은 컨테이너 생성 → 발행 2단계로 진행된다", async () => {
  const m = await mockServer({
    "POST 999/threads": () => ({ body: { id: "CONTAINER_1" } }),
    "GET CONTAINER_1": () => ({ body: { status: "FINISHED" } }),
    "POST 999/threads_publish": ({ params }) => {
      assert.equal(params.creation_id, "CONTAINER_1");
      return { body: { id: "MEDIA_1" } };
    },
  });
  const id = await clientFor(m.host).publishText("테스트 글", { publishDelayMs: 0 });
  assert.equal(id, "MEDIA_1");

  const create = m.calls.find((c) => c.path === "999/threads");
  assert.equal(create.params.media_type, "TEXT");
  assert.equal(create.params.text, "테스트 글");
  assert.equal(create.params.access_token, "tok");
  assert.equal(m.calls.at(-1).path, "999/threads_publish");
  await m.close();
});

test("답글은 reply_to_id 를 실어 보낸다", async () => {
  const m = await mockServer({
    "POST 999/threads": () => ({ body: { id: "C2" } }),
    "GET C2": () => ({ body: { status: "FINISHED" } }),
    "POST 999/threads_publish": () => ({ body: { id: "REPLY_1" } }),
  });
  const id = await clientFor(m.host).publishText("답글입니다", {
    replyToId: "THEIR_REPLY_9",
    publishDelayMs: 0,
  });
  assert.equal(id, "REPLY_1");
  assert.equal(
    m.calls.find((c) => c.path === "999/threads").params.reply_to_id,
    "THEIR_REPLY_9",
  );
  await m.close();
});

test("컨테이너 상태가 ERROR면 발행하지 않는다", async () => {
  const m = await mockServer({
    "POST 999/threads": () => ({ body: { id: "C3" } }),
    "GET C3": () => ({ body: { status: "ERROR", error_message: "처리 실패" } }),
    "POST 999/threads_publish": () => ({ body: { id: "SHOULD_NOT_HAPPEN" } }),
  });
  await assert.rejects(
    () => clientFor(m.host).publishText("x", { publishDelayMs: 0 }),
    /컨테이너 처리 실패/,
  );
  assert.ok(!m.calls.some((c) => c.path === "999/threads_publish"));
  await m.close();
});

test("상태 조회가 실패해도 발행은 계속된다 (best-effort)", async () => {
  const m = await mockServer({
    "POST 999/threads": () => ({ body: { id: "C4" } }),
    "GET C4": () => ({ status: 400, body: { error: { message: "unknown field" } } }),
    "POST 999/threads_publish": () => ({ body: { id: "MEDIA_4" } }),
  });
  assert.equal(
    await clientFor(m.host).publishText("x", { publishDelayMs: 0 }),
    "MEDIA_4",
  );
  await m.close();
});

test("4xx는 재시도하지 않고, 5xx는 재시도한다", async () => {
  const m1 = await mockServer({
    "POST 999/threads": () => ({
      status: 400,
      body: { error: { message: "Invalid OAuth token" } },
    }),
  });
  await assert.rejects(
    () => clientFor(m1.host).publishText("x", { publishDelayMs: 0 }),
    /Invalid OAuth token/,
  );
  assert.equal(m1.calls.length, 1, "4xx에서 재시도하면 안 됨");
  await m1.close();

  let n = 0;
  const m2 = await mockServer({
    "POST 999/threads": () =>
      ++n < 3
        ? { status: 500, body: { error: { message: "boom" } } }
        : { body: { id: "C5" } },
    "GET C5": () => ({ body: { status: "FINISHED" } }),
    "POST 999/threads_publish": () => ({ body: { id: "MEDIA_5" } }),
  });
  assert.equal(
    await clientFor(m2.host).publishText("x", { publishDelayMs: 0 }),
    "MEDIA_5",
  );
  assert.equal(n, 3, "5xx는 재시도해야 함");
  await m2.close();
});

test("답글 조회는 {media-id}/replies 를 쓴다 (내 답글 목록이 아님)", async () => {
  const m = await mockServer({
    "GET MEDIA_1/replies": ({ params }) => {
      assert.equal(params.reverse, "false");
      assert.match(params.fields, /is_reply_owned_by_me/);
      assert.match(params.fields, /hide_status/);
      return {
        body: {
          data: [
            { id: "r1", text: "질문 있어요", username: "someone" },
            { id: "r2", text: "제 답글", is_reply_owned_by_me: true },
          ],
        },
      };
    },
  });
  const replies = await clientFor(m.host).listRepliesTo("MEDIA_1");
  assert.equal(replies.length, 2);
  assert.equal(m.calls[0].path, "MEDIA_1/replies");
  await m.close();
});

test("답글 숨기기는 manage_reply 를 호출한다", async () => {
  const m = await mockServer({
    "POST r9/manage_reply": ({ params }) => {
      assert.equal(params.hide, "true");
      return { body: { success: true } };
    },
  });
  assert.deepEqual(await clientFor(m.host).hideReply("r9"), { success: true });
  await m.close();
});

test("글 길이: 한글은 1자, 이모지는 UTF-8 바이트로 센다", () => {
  assert.equal(postLength("가나다"), 3);
  assert.equal(postLength("abc"), 3);
  assert.equal(postLength("🙂"), 4); // 4바이트
  assert.equal(postLength("가🙂"), 5);
  assert.equal(postLength(""), 0);
});

test("길이 초과는 발행 전에 막는다", async () => {
  const m = await mockServer({ "POST 999/threads": () => ({ body: { id: "x" } }) });
  await assert.rejects(
    () => clientFor(m.host).publishText("가".repeat(MAX_POST_LENGTH + 1)),
    /글 길이/,
  );
  assert.equal(m.calls.length, 0, "API를 부르기 전에 막아야 함");
  await m.close();
});

test("상태 저장: 멱등성과 24시간 이동 창", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-state-"));
  try {
    const p = join(dir, "s.json");
    const s = new Store(p);
    assert.equal(s.isPostPublished("a"), false);
    s.recordPost("a", "M1");
    assert.equal(s.isPostPublished("a"), true);
    assert.equal(s.postsInLast24h(), 1);

    s.recordReply("r1", { action: "replied", ourReplyId: "X" });
    s.recordReply("r2", { action: "skipped" });
    assert.equal(s.repliesInLast24h(), 1, "skip은 답글 한도를 쓰지 않는다");
    assert.equal(s.isReplyHandled("r2"), true);

    // 25시간 전 기록은 창에서 빠진다
    s.data.postLog.push(new Date(Date.now() - 25 * 3600e3).toISOString());
    assert.equal(s.postsInLast24h(), 1);

    // 디스크에서 다시 읽어도 유지된다
    const s2 = new Store(p);
    assert.equal(s2.isPostPublished("a"), true);
    assert.deepEqual(s2.publishedPostIds(), ["M1"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("posts.md 파싱: id 중복과 day 오류를 잡는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-posts-"));
  try {
    const f = join(dir, "p.md");
    writeFileSync(f, "# id: a\n# day: 1\n본문\n===\n# id: a\n# day: 2\n본문2\n");
    assert.throws(() => loadPosts(f), /id 중복/);

    writeFileSync(f, "# id: a\n# day: 0\n본문\n");
    assert.throws(() => loadPosts(f), /day 는 1 이상/);

    writeFileSync(f, "# id: a\n# day: 2\n첫 줄\n둘째 줄\n");
    const [post] = loadPosts(f);
    assert.equal(post.day, 2);
    assert.equal(post.text, "첫 줄\n둘째 줄");

    writeFileSync(f, "# id: a\n본문\n");
    assert.equal(loadPosts(f)[0].day, 1, "day 없으면 1일차");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("posts.md: # 주석 줄은 본문에 들어가지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-comment-"));
  try {
    const f = join(dir, "p.md");
    writeFileSync(f, "# id: a\n# day: 1\n# 이건 주석이다\n실제 본문\n");
    const [post] = loadPosts(f);
    assert.equal(post.text, "실제 본문");
    assert.equal(post.day, 1);

    // 본문 중간의 # 는 본문이다 (헤더 영역만 소비한다)
    writeFileSync(f, "# id: b\n첫 줄\n# 이건 본문 속 샵\n");
    assert.equal(loadPosts(f)[0].text, "첫 줄\n# 이건 본문 속 샵");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("미기입 자리「」를 찾아낸다", () => {
  assert.deepEqual(findPlaceholders("운영 계정은 「핸들」 입니다"), ["핸들"]);
  assert.deepEqual(findPlaceholders("「」"), ["(빈 자리)"]);
  assert.deepEqual(findPlaceholders("「a」와 「b」"), ["a", "b"]);
  assert.deepEqual(findPlaceholders("전부 채워진 글"), []);
});

test("실제 posts.md: 길이 제한 · 일차 배분 · 오퍼 글 위치", () => {
  const posts = loadPosts();
  assert.ok(posts.length >= 9);
  for (const p of posts)
    assert.ok(
      postLength(p.text) <= MAX_POST_LENGTH,
      `${p.id}: ${postLength(p.text)}자`,
    );

  // 자기소개가 1일차 첫 글이어야 한다 — 신규 계정에서 결과물 자랑이 먼저면
  // 팔이 계정으로 읽힌다.
  assert.equal(posts[0].id, "00-intro");
  assert.equal(posts[0].day, 1);

  // 판매 글은 3일차에만. 이게 무너지면 계정이 죽는다.
  const offer = posts.find((p) => p.id === "08-offer");
  assert.equal(offer.day, 3);
  const PRICE = /\d[\d,]*\s*원|만원/;
  assert.ok(
    posts.filter((p) => p.day === 1).every((p) => !PRICE.test(p.text)),
    "1일차 글에 가격이 등장하면 안 된다",
  );
  assert.ok(PRICE.test(offer.text), "오퍼 글에는 가격이 있어야 한다");

  // 미기입 자리가 남아 있으면 안 된다 — 남아 있으면 publish 가 거기서 멈춘다
  const withHoles = posts.filter((p) => findPlaceholders(p.text).length);
  assert.deepEqual(
    withHoles.map((p) => p.id),
    [],
    "「」 를 채우거나 문장을 다시 쓰세요",
  );

  // 자기소개는 없는 실적을 있는 척하지 않는다. 다만 AI 상품 실적(없음)과
  // 판매 경력(있음)은 구분해야 한다 — 섞으면 과장이 되고, 하나가 걸리면
  // 나머지 주장도 같이 의심받는다.
  assert.match(posts[0].text, /실적은 없습니다/, "AI 상품 실적이 없다는 걸 밝혀야 한다");
  assert.match(
    posts[0].text,
    /AI로 뭘 팔아본 실적은 없습니다/,
    "'실적이 없다'가 아니라 'AI로 판 실적이 없다'로 한정해야 한다",
  );
  assert.match(
    posts[0].text,
    /통신판매업|스마트스토어|공동구매/,
    "검증 가능한 판매 경력을 근거로 대야 한다 — 후기 0개를 덮는 유일한 수단이다",
  );

  // 상담 창구 글이 판매 글보다 먼저 나가야 한다. 원본 사례에서 판을 뒤집은
  // 게 이 순서였다 — 답을 먼저 주고, 그 다음에 판다.
  const clinic = posts.find((p) => p.id === "05-clinic");
  assert.ok(clinic, "상담 창구 글이 있어야 한다");
  assert.ok(clinic.day < offer.day, "상담 창구가 판매보다 먼저여야 한다");
});

// ── 판매 중계 ──────────────────────────────────────────────────

const SALES = { total: 30, startPrice: 29000, step: 1000 };
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const keys = (ms) => ms.map((m) => m.key);

test("중계: 판매 시작 전에는 아무 사건도 없다", () => {
  assert.deepEqual(computeMilestones({ ...SALES, sold: 0, launchedAt: null }), []);
});

test("중계: 0건이어도 시간이 지나면 쓸 거리가 생긴다", () => {
  const fresh = computeMilestones({ ...SALES, sold: 0, launchedAt: hoursAgo(1) });
  assert.deepEqual(keys(fresh), ["launch"]);

  const stale = computeMilestones({ ...SALES, sold: 0, launchedAt: hoursAgo(13) });
  assert.deepEqual(keys(stale), ["launch", "quiet-6", "quiet-12"]);
});

test("중계: 팔리기 시작하면 quiet 은 더 이상 안 나온다", () => {
  const ms = computeMilestones({ ...SALES, sold: 1, launchedAt: hoursAgo(13) });
  assert.ok(!keys(ms).some((k) => k.startsWith("quiet")));
  assert.ok(keys(ms).includes("first"));
});

test("중계: everyN 배수마다 사건이 생기고, 완판 건은 soldout 이 대신한다", () => {
  const ms = computeMilestones({ ...SALES, sold: 9, launchedAt: hoursAgo(5), everyN: 3 });
  assert.deepEqual(keys(ms), ["launch", "first", "count-3", "count-6", "count-9"]);

  const done = computeMilestones({ ...SALES, sold: 30, launchedAt: hoursAgo(5), everyN: 3 });
  assert.ok(keys(done).includes("soldout"));
  assert.ok(!keys(done).includes("count-30"), "완판 건은 count 로 중복되면 안 된다");
  assert.ok(!keys(done).includes("half"), "완판했으면 절반은 지난 사건이다");
});

test("중계: 절반과 막바지", () => {
  const half = computeMilestones({ ...SALES, sold: 15, launchedAt: hoursAgo(5) });
  assert.ok(keys(half).includes("half"));
  assert.ok(!keys(half).includes("almost"));

  const almost = computeMilestones({ ...SALES, sold: 28, launchedAt: hoursAgo(5) });
  assert.ok(keys(almost).includes("almost"));
});

test("중계: 가격과 완판 총액 계산", () => {
  // 29,000 시작 · 건당 1,000 인상 · 30권
  assert.equal(priceAfter(0, SALES), 29000);
  assert.equal(priceAfter(29, SALES), 58000); // 마지막 권
  assert.equal(totalIfSoldOut(SALES), 1305000);

  const ms = computeMilestones({ ...SALES, sold: 30, launchedAt: hoursAgo(5) });
  const soldout = ms.find((m) => m.kind === "soldout");
  assert.equal(soldout.facts.revenue, 1305000);
  assert.equal(soldout.facts.finalPrice, 58000);
});

test("중계: 수량을 몰아서 넣어도 한 편만 나가고 나머지는 접힌다", () => {
  // 0건에서 갑자기 30건으로 갱신된 상황 — 전부 올리면 도배다
  const ms = computeMilestones({ ...SALES, sold: 30, launchedAt: hoursAgo(13) });
  const { pick, superseded } = pickNext(ms, () => false);
  assert.equal(pick.kind, "soldout", "가장 중요한 사건 하나만 고른다");
  assert.ok(superseded.length > 0);
  assert.ok(!keys(superseded).includes("soldout"));
});

test("중계: 이미 내보낸 사건은 다시 안 나온다", () => {
  const ms = computeMilestones({ ...SALES, sold: 1, launchedAt: hoursAgo(2) });
  const done = new Set(["launch", "first"]);
  assert.equal(pickNext(ms, (k) => done.has(k)).pick, null);
});

test("판매 수량은 줄일 수 없다 — 오타로 중계가 꼬이는 걸 막는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-sales-"));
  try {
    const s = new Store(join(dir, "state.json"));
    s.launch();
    s.setSold(5);
    assert.equal(s.sales.sold, 5);
    assert.throws(() => s.setSold(3), /줄일 수 없습니다/);
    assert.throws(() => s.setSold(-1), /이상합니다/);

    // 판매 시작 시각은 한 번만 찍힌다
    const first = s.sales.launchedAt;
    s.launch(new Date(0).toISOString());
    assert.equal(s.sales.launchedAt, first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("중계 설정이 판매 문서와 어긋나지 않는다", () => {
  const cfg = JSON.parse(
    readFileSync(new URL("../config.example.json", import.meta.url), "utf8"),
  );
  assert.equal(cfg.sales.total, 30);
  assert.equal(cfg.sales.startPrice, 29000);
  assert.equal(cfg.sales.step, 1000);

  // 판매 글에 적힌 숫자와 중계 설정이 같아야 한다. 어긋나면 글이 거짓말을 한다.
  const offer = loadPosts().find((p) => p.id === "08-offer");
  assert.match(offer.text, /29,000원/);
  assert.match(offer.text, /30권 한정/);
  assert.match(offer.text, /1,000원 오릅니다/);
});
