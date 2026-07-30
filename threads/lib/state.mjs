// 상태 저장소. 두 가지를 보장한다.
//   1) 멱등성 — 같은 글/답글을 두 번 올리지 않는다.
//   2) 발송량 한도 — 24시간 이동 창 기준으로 직접 센다.
//
// API 한도(글 250/일, 답글 1000/일)는 넉넉하지만 그건 상한이고, 실제 상한은
// 알고리즘과 읽는 사람의 인내심이다. config 의 낮은 값을 지킨다.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY = {
  version: 1,
  posts: {}, // slug -> { mediaId, at }
  replies: {}, // 상대 답글 id -> { ourReplyId, at, action }
  postLog: [], // 발행 시각 ISO 문자열
  replyLog: [],
};

export class Store {
  constructor(path) {
    this.path = path;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      this.data = { ...structuredClone(EMPTY), ...raw };
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      this.data = structuredClone(EMPTY);
    }
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    // 원자적 쓰기 — 중간에 죽어도 상태 파일이 깨지지 않는다.
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + "\n");
    renameSync(tmp, this.path);
  }

  #countSince(log, sinceMs) {
    return log.filter((iso) => Date.parse(iso) >= sinceMs).length;
  }

  #prune(log) {
    const cutoff = Date.now() - DAY_MS;
    return log.filter((iso) => Date.parse(iso) >= cutoff);
  }

  postsInLast24h() {
    this.data.postLog = this.#prune(this.data.postLog);
    return this.#countSince(this.data.postLog, Date.now() - DAY_MS);
  }

  repliesInLast24h() {
    this.data.replyLog = this.#prune(this.data.replyLog);
    return this.#countSince(this.data.replyLog, Date.now() - DAY_MS);
  }

  isPostPublished(slug) {
    return Boolean(this.data.posts[slug]);
  }

  recordPost(slug, mediaId) {
    const at = new Date().toISOString();
    this.data.posts[slug] = { mediaId, at };
    this.data.postLog.push(at);
    this.save();
  }

  isReplyHandled(replyId) {
    return Boolean(this.data.replies[replyId]);
  }

  /** action: "replied" | "skipped" | "escalated" | "hidden" */
  recordReply(replyId, { action, ourReplyId = null, reason = null }) {
    const at = new Date().toISOString();
    this.data.replies[replyId] = { action, ourReplyId, reason, at };
    if (action === "replied") this.data.replyLog.push(at);
    this.save();
  }

  publishedPostIds() {
    return Object.values(this.data.posts).map((p) => p.mediaId);
  }
}
