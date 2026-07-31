// 마일스톤 하나를 스레드 글 한 편으로 만든다.
//
// 상품 소개가 아니라 중계다. 소개는 한 번 하면 더 할 말이 없지만, 중계는
// 사건이 생길 때마다 쓸 게 생긴다. 안 팔리는 것조차 다음 화가 된다.

import Anthropic from "@anthropic-ai/sdk";
import { MAX_POST_LENGTH, postLength } from "./threads-api.mjs";

const POST_SCHEMA = {
  type: "object",
  properties: {
    post: {
      type: "string",
      description: "실제로 게시할 한국어 글. 링크는 넣지 않는다.",
    },
    reason: {
      type: "string",
      description: "이렇게 쓴 이유 한 문장 (로그용, 게시되지 않음)",
    },
  },
  required: ["post", "reason"],
  additionalProperties: false,
};

/** 사건 종류별로 무엇을 다뤄야 하는지. 문장은 모델이 쓰고, 여기선 각만 잡는다. */
const ANGLES = {
  launch:
    "판매를 열었다는 사실. 아직 아무 실적이 없다는 걸 먼저 밝힌다. 파는 티를 최소로 하고, 왜 이걸 만들었는지에 무게를 둔다.",
  quiet:
    "몇 시간이 지났는데 아직 한 건도 안 팔렸다는 사실. 변명하거나 자조하지 말고 사실만 적는다. 안 팔리는 이유를 스스로 추측해보는 것까지가 이 글의 내용이다. 읽는 사람이 다음이 궁금해지게 끝낸다.",
  first:
    "첫 판매가 났다는 사실. 과장하지 않는다. 한 건은 한 건이다. 산 사람에게 고맙다는 말과, 지금 심정을 담담하게.",
  count:
    "n건째가 나갔고 가격이 그만큼 올랐다는 사실. 숫자를 있는 그대로 적는다. 가격 규칙을 모르는 사람이 있을 수 있으니 한 줄로 다시 설명한다.",
  half: "절반이 나갔다는 사실. 남은 수량과 현재 가격을 적는다.",
  almost:
    "몇 권 안 남았다는 사실. 이건 진짜 남은 수량이므로 그대로 적는다. 없는 마감 시한을 만들지 않는다.",
  soldout:
    "완판하고 판매를 닫았다는 사실. 총 몇 권, 얼마에 시작해서 얼마에 끝났는지 적는다. 산 사람들에게 감사. 다음에 뭘 할지 한 줄.",
};

function systemPrompt({ product }) {
  return `너는 스레드 계정 "${product.accountName}" 의 글을 쓴다.
지금 하고 있는 건 상품 홍보가 아니라 **판매 과정 중계**다.

<파는 것>
${product.name}
${product.summary}
가격 규칙: ${product.pricing}
</파는 것>

<중계의 원칙>
- 한 편에 사건 하나만 다룬다. 지금 벌어진 일 하나.
- 상품 설명을 반복하지 않는다. 이미 아는 사람이 읽는다고 가정한다.
- 숫자는 주어진 사실만 쓴다. 없는 숫자를 만들지 않는다.
- 안 팔리면 안 팔린다고 쓴다. 그게 다음 화다.
- 마지막 줄은 다음이 궁금해지게 끝낸다. 다만 억지 떡밥은 쓰지 않는다.

<절대 하지 않는 것>
- 수익 금액이나 성과를 약속하지 않는다. "이걸 사면 얼마 번다" 류는 어떤 형태로도 금지.
- 주어진 사실에 없는 수치·후기·구매자 반응을 지어내지 않는다.
- 거짓 긴급성을 만들지 않는다. 남은 수량과 가격 인상은 실제 규칙이므로 그대로 써도 되지만, 없는 마감 시한이나 없는 재고 압박은 만들지 않는다.
- 본문에 링크를 넣지 않는다. 링크는 사람이 첫 댓글에 단다.
- 자랑하는 톤을 쓰지 않는다. 담담하게.

<형식>
- 한국어. 존댓말 아니어도 되지만 일관되게.
- ${MAX_POST_LENGTH}자 이내. 짧을수록 좋다. 3~6줄 권장.
- 이모지는 안 쓰거나 최대 1개.
- 해시태그는 쓰지 않는다.`;
}

function factsBlock(facts) {
  const lines = [
    `지금까지 팔린 수량: ${facts.sold}권`,
    `한정 수량: ${facts.total}권`,
    `남은 수량: ${facts.left}권`,
    `다음 구매자가 낼 가격: ${facts.currentPrice.toLocaleString("ko-KR")}원`,
    `시작가: ${facts.startPrice.toLocaleString("ko-KR")}원 (한 권 나갈 때마다 ${facts.step.toLocaleString("ko-KR")}원 인상)`,
    `판매 시작 후 경과: ${facts.hoursSinceLaunch}시간`,
  ];
  if (facts.at !== undefined) lines.push(`이번 사건 시점: ${facts.at}권째`);
  if (facts.hours !== undefined) lines.push(`0건으로 지난 시간: ${facts.hours}시간`);
  if (facts.revenue !== undefined)
    lines.push(`완판 총액: ${facts.revenue.toLocaleString("ko-KR")}원`);
  if (facts.finalPrice !== undefined)
    lines.push(`마지막 권 가격: ${facts.finalPrice.toLocaleString("ko-KR")}원`);
  return lines.join("\n");
}

export class BroadcastDrafter {
  constructor({ apiKey, model, effort, product, log = () => {} }) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
    this.model = model;
    this.effort = effort;
    this.system = systemPrompt({ product });
    this.log = log;
    this.useBeta = true;
  }

  /**
   * @param {{kind: string, facts: object}} milestone
   * @param {string[]} recent  최근에 올린 글 본문 (반복 방지용)
   * @returns {{post: string, reason: string}|null}  null 이면 이번엔 쓰지 않는다
   */
  async draft(milestone, recent = []) {
    const angle = ANGLES[milestone.kind];
    if (!angle) throw new Error(`모르는 사건 종류: ${milestone.kind}`);

    const userMsg = [
      "지금 상황:",
      "```",
      factsBlock(milestone.facts),
      "```",
      "",
      "이번 글에서 다룰 것:",
      angle,
      ...(recent.length
        ? [
            "",
            "최근에 올린 글들이다. 같은 문장이나 같은 구조를 반복하지 마라.",
            "```",
            recent.slice(-4).join("\n---\n"),
            "```",
          ]
        : []),
      "",
      "위 사실만 가지고 글을 써라.",
    ].join("\n");

    const params = {
      model: this.model,
      max_tokens: 8000, // Opus 5는 사고 토큰도 max_tokens에 포함된다
      system: this.system,
      output_config: {
        effort: this.effort,
        format: { type: "json_schema", schema: POST_SCHEMA },
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
        this.log(`fallback 베타 사용 불가, 일반 호출로 전환 (${err.message})`);
        this.useBeta = false;
      }
    }
    if (!res) res = await this.client.messages.create(params);

    if (res.stop_reason === "refusal") {
      this.log(`모델이 거절함 (${res.stop_details?.category ?? "미분류"}) — 이번 건은 건너뜁니다`);
      return null;
    }

    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.log("모델 응답을 JSON으로 파싱하지 못함 — 이번 건은 건너뜁니다");
      return null;
    }

    const body = (parsed.post ?? "").trim();
    if (!body) return null;
    if (postLength(body) > MAX_POST_LENGTH) {
      this.log(`초안이 ${MAX_POST_LENGTH}자를 초과 (${postLength(body)}) — 건너뜁니다`);
      return null;
    }
    return { post: body, reason: parsed.reason ?? "" };
  }
}
