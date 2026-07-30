// 공식 Threads API 클라이언트.
//
// 호스트 주의: 메타 문서가 graph.threads.com 과 graph.threads.net 을 섞어 쓴다
// (reply-management 페이지는 .com, create-replies 페이지는 .net). 현재 표기가
// 우세한 .com 을 기본값으로 두고 config.host 로 바꿀 수 있게 해둔다.
export const DEFAULT_HOST = "https://graph.threads.com/v1.0";

export class ThreadsError extends Error {
  constructor(message, { status, body, endpoint } = {}) {
    super(message);
    this.name = "ThreadsError";
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
  /** 재시도해도 결과가 달라지지 않는 실패인지. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 스레드 글 길이. 메타 규칙: 500자 제한, 단 이모지는 UTF-8 바이트 수로 센다.
 * 한글은 3바이트지만 1자로 세므로 코드포인트 기준이 맞고, 이모지만 가중한다.
 */
export function postLength(text) {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const isEmoji =
      cp >= 0x1f000 || // 이모지·기호 평면
      (cp >= 0x2600 && cp <= 0x27bf) || // 기타 기호·딩뱃
      cp === 0xfe0f || // variation selector
      cp === 0x200d; // ZWJ
    n += isEmoji ? Buffer.byteLength(ch, "utf8") : 1;
  }
  return n;
}

export const MAX_POST_LENGTH = 500;

export class ThreadsClient {
  constructor({ host = DEFAULT_HOST, userId, accessToken, log = () => {} }) {
    if (!userId) throw new Error("threads.userId 가 필요합니다");
    if (!accessToken) throw new Error("threads.accessToken 이 필요합니다");
    this.host = host.replace(/\/+$/, "");
    this.userId = String(userId);
    this.token = accessToken;
    this.log = log;
  }

  async #request(method, path, params = {}, { retries = 3 } = {}) {
    const url = new URL(`${this.host}/${path.replace(/^\/+/, "")}`);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (method === "GET") url.searchParams.set(k, String(v));
      else body.set(k, String(v));
    }
    // 토큰은 항상 바디/쿼리로. 로그에는 절대 남기지 않는다.
    if (method === "GET") url.searchParams.set("access_token", this.token);
    else body.set("access_token", this.token);

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(Math.min(2 ** attempt * 1000, 16000));
      let res, text;
      try {
        res = await fetch(url, {
          method,
          body: method === "GET" ? undefined : body,
          headers:
            method === "GET"
              ? undefined
              : { "content-type": "application/x-www-form-urlencoded" },
        });
        text = await res.text();
      } catch (cause) {
        lastErr = new ThreadsError(`네트워크 오류: ${cause.message}`, {
          endpoint: path,
        });
        continue; // 네트워크 오류는 재시도
      }

      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }

      if (res.ok) return json;

      const apiMsg = json?.error?.message || json?.raw || res.statusText;
      lastErr = new ThreadsError(`${res.status} ${apiMsg}`, {
        status: res.status,
        body: json,
        endpoint: path,
      });
      if (lastErr.permanent) throw lastErr; // 4xx는 재시도 무의미
    }
    throw lastErr;
  }

  /** 텍스트 컨테이너 생성 → 발행. reply_to_id 를 주면 답글이 된다. */
  async publishText(text, { replyToId, replyControl, publishDelayMs = 4000 } = {}) {
    const len = postLength(text);
    if (len === 0) throw new Error("빈 글은 발행할 수 없습니다");
    if (len > MAX_POST_LENGTH)
      throw new Error(`글 길이 ${len} > ${MAX_POST_LENGTH} (이모지는 바이트로 계산됨)`);

    const container = await this.#request("POST", `${this.userId}/threads`, {
      media_type: "TEXT",
      text,
      reply_to_id: replyToId,
      reply_control: replyControl,
    });
    const creationId = container?.id;
    if (!creationId)
      throw new ThreadsError("컨테이너 ID가 응답에 없습니다", { body: container });

    // 메타는 발행 전 대기를 권고한다(이미지·영상 기준 약 30초). 텍스트는 보통
    // 즉시 준비되므로 짧게 기다린 뒤, 상태 조회는 best-effort 로만 시도한다.
    await sleep(publishDelayMs);
    try {
      const st = await this.#request(
        "GET",
        creationId,
        { fields: "status,error_message" },
        { retries: 0 },
      );
      if (st?.status === "ERROR")
        throw new ThreadsError(`컨테이너 처리 실패: ${st.error_message ?? ""}`, {
          body: st,
        });
    } catch (err) {
      if (err instanceof ThreadsError && err.body?.status === "ERROR") throw err;
      // 상태 필드를 못 읽는 건 치명적이지 않다 — 발행에서 다시 걸린다.
      this.log(`컨테이너 상태 확인 생략 (${err.message})`);
    }

    const published = await this.#request(
      "POST",
      `${this.userId}/threads_publish`,
      { creation_id: creationId },
    );
    if (!published?.id)
      throw new ThreadsError("발행 응답에 미디어 ID가 없습니다", { body: published });
    return published.id;
  }

  /** 내가 올린 글 목록. */
  async listMyPosts({ limit = 25 } = {}) {
    const r = await this.#request("GET", `${this.userId}/threads`, {
      fields: "id,text,timestamp,permalink,media_type",
      limit,
    });
    return r?.data ?? [];
  }

  /**
   * 특정 글에 달린 최상위 답글.
   * 주의: GET /{user-id}/replies 는 "내가 쓴 답글"이라 여기서 쓸 게 아니다.
   */
  async listRepliesTo(mediaId, { limit = 50 } = {}) {
    const r = await this.#request("GET", `${mediaId}/replies`, {
      fields:
        "id,text,username,timestamp,permalink,is_reply_owned_by_me,hide_status,replied_to,root_post,has_replies",
      reverse: false,
      limit,
    });
    return r?.data ?? [];
  }

  /** 스팸·욕설 답글 숨기기. */
  async hideReply(replyId, hide = true) {
    return this.#request("POST", `${replyId}/manage_reply`, { hide: String(hide) });
  }
}
