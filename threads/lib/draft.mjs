// 답글 초안 생성. 판단(reply/skip/escalate/hide)까지 모델이 내리고,
// 발사는 호출부가 한다.

import Anthropic from "@anthropic-ai/sdk";
import { MAX_POST_LENGTH, postLength } from "./threads-api.mjs";

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["reply", "skip", "escalate", "hide"],
      description: "이 답글에 대해 취할 행동",
    },
    reply: {
      type: "string",
      description:
        "action이 reply일 때 실제로 게시할 한국어 답글. 그 외에는 빈 문자열.",
    },
    reason: {
      type: "string",
      description: "그 행동을 고른 이유 한 문장 (로그용, 게시되지 않음)",
    },
  },
  required: ["action", "reply", "reason"],
  additionalProperties: false,
};

function systemPrompt({ product, escalate }) {
  const escalateList = escalate.length
    ? escalate.map((s) => `- ${s}`).join("\n")
    : "(없음 — 사람에게 넘기지 않고 전부 직접 처리한다)";

  return `너는 스레드 계정 "${product.accountName}"의 답글을 쓴다. 이 계정은 아래 제품을 판다.

<제품>
이름: ${product.name}
한 줄 설명: ${product.summary}
실제 되는 기능:
${product.features.map((f) => `- ${f}`).join("\n")}
가격: ${product.pricing}
구매자가 따로 준비해야 하는 것:
${product.requirements.map((r) => `- ${r}`).join("\n")}
문의 방법: ${product.contact}
</제품>

<절대 하지 않는 것>
- 수익·조회수·팔로워를 보장하거나 추정하지 않는다. "이걸로 얼마 벌 수 있다"류의 말은 어떤 형태로도 쓰지 않는다. 이 제품이 파는 건 콘텐츠 제작 시간이다.
- 위 <제품>에 없는 기능·가격·조건을 만들어내지 않는다. 확실하지 않으면 모른다고 하고 문의로 안내한다.
- 메타/인스타그램과 제휴·후원 관계가 있는 것처럼 말하지 않는다.
- 개인정보(연락처, 계정 비밀번호, 결제정보)를 답글로 요구하지 않는다.
- 상대를 깎아내리거나 비꼬지 않는다. 부정적인 댓글에도 방어적으로 굴지 않는다.
- 거짓 긴급성("오늘까지", "몇 자리 남음")을 만들지 않는다.

<톤>
- 한국어 존댓말. 2~3문장, 최대 ${MAX_POST_LENGTH}자.
- 이모지는 쓰지 않거나 최대 1개. 느낌표 남발 금지.
- 광고 문구처럼 쓰지 않는다. 사람이 쓴 것처럼 담백하게.
- 상대가 물어본 것에만 답한다. 묻지 않은 판매 얘기를 끼워넣지 않는다.

<행동 선택>
reply — 질문, 의견, 감사 인사 등 답할 내용이 있는 경우.
skip — 스팸, 의미 없는 반응("ㅋㅋ", 이모지만), 이미 대화가 끝난 것, 답해도 보탤 게 없는 것.
hide — 욕설, 혐오 표현, 무관한 홍보 링크.
escalate — 아래에 해당하면 답글을 쓰지 말고 사람에게 넘긴다:
${escalateList}

escalate 를 고르면 reply 는 빈 문자열로 둔다. 공개 답글이 잘못 나가는 비용이 늦게 답하는 비용보다 크다.`;
}

export class ReplyDrafter {
  constructor({ apiKey, model, effort, product, escalate, log = () => {} }) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
    this.model = model;
    this.effort = effort;
    this.system = systemPrompt({ product, escalate });
    this.log = log;
    this.useBeta = true; // 거절 시 서버측 fallback 사용
  }

  /**
   * @returns {{action: string, reply: string, reason: string}}
   */
  async draft({ postText, replyText, replyAuthor }) {
    const userMsg = [
      "내가 올린 글:",
      "```",
      postText,
      "```",
      "",
      `@${replyAuthor} 님이 남긴 답글:`,
      "```",
      replyText,
      "```",
      "",
      "이 답글에 어떻게 대응할지 정하고, reply 라면 게시할 문장을 써.",
    ].join("\n");

    const params = {
      model: this.model,
      max_tokens: 8000, // Opus 5는 사고 토큰도 max_tokens에 포함된다
      system: this.system,
      output_config: {
        effort: this.effort,
        format: { type: "json_schema", schema: DECISION_SCHEMA },
      },
      messages: [{ role: "user", content: userMsg }],
    };

    let res;
    if (this.useBeta) {
      try {
        res = await this.client.beta.messages.create({
          ...params,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
      } catch (err) {
        // SDK나 계정이 이 베타를 아직 못 쓰면 한 번만 비베타로 내려간다.
        this.log(`fallback 베타 사용 불가, 일반 호출로 전환 (${err.message})`);
        this.useBeta = false;
      }
    }
    if (!res) res = await this.client.messages.create(params);

    if (res.stop_reason === "refusal") {
      return {
        action: "escalate",
        reply: "",
        reason: `모델이 응답을 거절함 (${res.stop_details?.category ?? "미분류"})`,
      };
    }

    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        action: "escalate",
        reply: "",
        reason: "모델 응답을 JSON으로 파싱하지 못함",
      };
    }

    // 스키마는 길이를 강제하지 못하니 여기서 막는다.
    if (parsed.action === "reply") {
      const body = (parsed.reply ?? "").trim();
      if (!body)
        return { action: "skip", reply: "", reason: "reply인데 본문이 비어 있음" };
      if (postLength(body) > MAX_POST_LENGTH)
        return {
          action: "escalate",
          reply: "",
          reason: `초안이 ${MAX_POST_LENGTH}자를 초과 (${postLength(body)})`,
        };
      parsed.reply = body;
    }
    return parsed;
  }
}
