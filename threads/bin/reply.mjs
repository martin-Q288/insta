#!/usr/bin/env node
// 내가 올린 글에 달린 답글을 읽고 대응한다.
//
// 답글은 초안 검토 없이 바로 게시된다(전자동). 대신 config.escalate 에 걸리는
// 건은 게시하지 않고 state/escalations.jsonl 에 쌓아 사람에게 넘긴다 —
// 공개 답글이 잘못 나가는 비용이 늦게 답하는 비용보다 크기 때문이다.
// 전부 자동으로 돌리려면 config 의 escalate 를 [] 로 비우면 된다.
//
// 사용: node bin/reply.mjs [--dry]

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadPosts, ROOT } from "../lib/config.mjs";
import { ThreadsClient } from "../lib/threads-api.mjs";
import { Store } from "../lib/state.mjs";
import { ReplyDrafter } from "../lib/draft.mjs";

const dry = process.argv.includes("--dry");
const log = (...a) => console.log(...a);

function recordEscalation(entry) {
  const dir = join(ROOT, "state");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "escalations.jsonl"), JSON.stringify(entry) + "\n");
}

export async function handleReplies({ cfg, posts, store, client, drafter, dry = false }) {
  const used = store.repliesInLast24h();
  let budget = Math.max(0, cfg.limits.repliesPerDay - used);
  log(`최근 24시간 답글 ${used}/${cfg.limits.repliesPerDay}건`);

  const textById = new Map(posts.map((p) => [p.id, p.text]));
  const entries = Object.entries(store.data.posts);
  if (!entries.length) {
    log("아직 발행된 글이 없습니다. 먼저 publish 를 돌리세요.");
    return { replied: 0, skipped: 0, escalated: 0, hidden: 0 };
  }

  const tally = { replied: 0, skipped: 0, escalated: 0, hidden: 0 };

  for (const [slug, { mediaId }] of entries) {
    let replies;
    try {
      replies = await client.listRepliesTo(mediaId);
    } catch (err) {
      log(`답글 조회 실패 (${slug}): ${err.message}`);
      continue;
    }

    for (const r of replies) {
      if (r.is_reply_owned_by_me) continue; // 내 답글
      if (store.isReplyHandled(r.id)) continue; // 이미 처리
      if (r.hide_status && r.hide_status !== "NOT_HUSHED") continue; // 이미 숨김
      const body = (r.text ?? "").trim();
      if (!body) {
        store.recordReply(r.id, { action: "skipped", reason: "본문 없음" });
        tally.skipped++;
        continue;
      }

      let decision;
      try {
        decision = await drafter.draft({
          postText: textById.get(slug) ?? "(원문을 찾을 수 없음)",
          replyText: body,
          replyAuthor: r.username ?? "unknown",
        });
      } catch (err) {
        log(`초안 생성 실패 (${r.id}): ${err.message}`);
        continue; // 상태를 남기지 않으므로 다음 실행에서 다시 시도한다
      }

      const preview = body.replace(/\s+/g, " ").slice(0, 40);
      log(`[${decision.action}] @${r.username ?? "?"}: "${preview}" — ${decision.reason}`);

      if (dry) {
        if (decision.action === "reply") log(`  [dry] 답글: ${decision.reply}`);
        continue;
      }

      switch (decision.action) {
        case "reply": {
          if (budget <= 0) {
            log("  일일 답글 한도 도달 — 다음 실행으로 넘김");
            return tally;
          }
          try {
            const id = await client.publishText(decision.reply, {
              replyToId: r.id,
              publishDelayMs: cfg.limits.publishDelayMs,
            });
            store.recordReply(r.id, {
              action: "replied",
              ourReplyId: id,
              reason: decision.reason,
            });
            budget--;
            tally.replied++;
            log(`  게시됨 → ${id}`);
          } catch (err) {
            log(`  답글 게시 실패: ${err.message}`);
          }
          break;
        }
        case "hide": {
          try {
            await client.hideReply(r.id, true);
            store.recordReply(r.id, { action: "hidden", reason: decision.reason });
            tally.hidden++;
          } catch (err) {
            log(`  숨기기 실패: ${err.message}`);
          }
          break;
        }
        case "escalate": {
          recordEscalation({
            at: new Date().toISOString(),
            postSlug: slug,
            replyId: r.id,
            author: r.username ?? null,
            permalink: r.permalink ?? null,
            text: body,
            reason: decision.reason,
          });
          store.recordReply(r.id, { action: "escalated", reason: decision.reason });
          tally.escalated++;
          log("  사람 확인 필요 — state/escalations.jsonl 에 기록");
          break;
        }
        default:
          store.recordReply(r.id, { action: "skipped", reason: decision.reason });
          tally.skipped++;
      }
    }
  }

  log(
    `답글 ${tally.replied} · 건너뜀 ${tally.skipped} · 숨김 ${tally.hidden} · 사람에게 ${tally.escalated}`,
  );
  return tally;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const posts = loadPosts();
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
  await handleReplies({ cfg, posts, store, client, drafter, dry });
}
