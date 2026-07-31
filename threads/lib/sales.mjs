// 판매 상황 → 중계할 사건(마일스톤) 계산.
//
// 예약 발행과의 차이가 여기 있다. 예약은 시간이 오면 나가고, 중계는 사건이
// 생겨야 나간다. 사건이 생기면 쓸 거리가 생기고, 사건이 안 생기는 것 자체도
// 사건이다 — 그래서 quiet 이 있다.
//
// 순수 함수로 둔다. 발사는 호출부가 하고, 여기서는 무엇을 쓸지만 정한다.

/** 중요한 것부터. 한 번에 여러 개가 걸리면 이 순서로 하나만 쓴다. */
export const SIGNIFICANCE = [
  "soldout",
  "almost",
  "half",
  "count",
  "first",
  "quiet",
  "launch",
];

const HOUR_MS = 60 * 60 * 1000;

/** n건 팔린 뒤 다음 구매자가 낼 가격. */
export function priceAfter(sold, { startPrice, step }) {
  return startPrice + step * sold;
}

/** 완판까지 팔았을 때의 총 매출. 등차수열 합. */
export function totalIfSoldOut({ total, startPrice, step }) {
  return total * startPrice + (step * total * (total - 1)) / 2;
}

/**
 * 지금 중계할 만한 사건을 전부 계산한다. 이미 내보낸 것을 걸러내는 건 호출부 몫.
 *
 * @param {object} o
 * @param {number} o.sold          지금까지 팔린 수량
 * @param {number} o.total         한정 수량
 * @param {number} o.startPrice    시작가
 * @param {number} o.step          건당 인상액
 * @param {string|null} o.launchedAt  판매 시작 시각 (ISO). null 이면 아직 시작 안 함
 * @param {number} o.everyN        몇 건마다 중계할지
 * @param {number[]} o.quietHours  0건인 채로 몇 시간이 지나면 중계할지
 * @param {number} o.almostLeft    남은 수량이 이 이하면 막바지로 본다
 * @param {number} o.now           현재 시각 ms
 * @returns {{key:string, kind:string, facts:object}[]}
 */
export function computeMilestones({
  sold,
  total,
  startPrice,
  step,
  launchedAt,
  everyN = 3,
  quietHours = [6, 12],
  almostLeft = 3,
  now = Date.now(),
}) {
  if (!launchedAt) return [];
  if (!Number.isInteger(sold) || sold < 0) throw new Error(`sold 가 이상합니다: ${sold}`);
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`total 은 1 이상 정수여야 합니다: ${total}`);

  const launchMs = Date.parse(launchedAt);
  if (Number.isNaN(launchMs)) throw new Error(`launchedAt 을 파싱할 수 없습니다: ${launchedAt}`);

  const left = Math.max(0, total - sold);
  const common = {
    sold,
    total,
    left,
    currentPrice: priceAfter(sold, { startPrice, step }),
    startPrice,
    step,
    hoursSinceLaunch: Math.floor((now - launchMs) / HOUR_MS),
  };

  const out = [{ key: "launch", kind: "launch", facts: { ...common } }];

  // 0건인 시간도 중계 소재다. 안 팔린다는 사실을 숨기면 쓸 게 없어진다.
  if (sold === 0) {
    for (const h of quietHours) {
      if (common.hoursSinceLaunch >= h)
        out.push({ key: `quiet-${h}`, kind: "quiet", facts: { ...common, hours: h } });
    }
  }

  if (sold >= 1) out.push({ key: "first", kind: "first", facts: { ...common } });

  // everyN 배수. 완판 건은 soldout 이 대신하므로 뺀다.
  for (let n = everyN; n <= Math.min(sold, total - 1); n += everyN) {
    if (n <= 1) continue; // 1건은 first 가 이미 다룬다
    out.push({
      key: `count-${n}`,
      kind: "count",
      facts: { ...common, at: n, priceAtThatPoint: priceAfter(n, { startPrice, step }) },
    });
  }

  const halfMark = Math.ceil(total / 2);
  if (sold >= halfMark && sold < total)
    out.push({ key: "half", kind: "half", facts: { ...common, halfMark } });

  if (left > 0 && left <= almostLeft)
    out.push({ key: "almost", kind: "almost", facts: { ...common } });

  if (sold >= total)
    out.push({
      key: "soldout",
      kind: "soldout",
      facts: {
        ...common,
        revenue: totalIfSoldOut({ total, startPrice, step }),
        finalPrice: priceAfter(total - 1, { startPrice, step }),
      },
    });

  return out;
}

/**
 * 아직 안 내보낸 것 중 가장 중요한 하나. 나머지는 지나간 것으로 표시한다.
 *
 * 한 번에 여러 건이 걸릴 수 있는데(수량을 몰아서 입력한 경우) 그걸 전부
 * 올리면 도배다. 하나만 올리고 나머지는 접는다.
 *
 * @returns {{pick: object|null, superseded: object[]}}
 */
export function pickNext(milestones, isDone) {
  const pending = milestones.filter((m) => !isDone(m.key));
  if (!pending.length) return { pick: null, superseded: [] };

  const rank = (m) => SIGNIFICANCE.indexOf(m.kind);
  const sorted = [...pending].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    // 같은 종류면 나중 것(더 많이 팔린 시점)을 쓴다
    return (b.facts.at ?? 0) - (a.facts.at ?? 0);
  });

  return { pick: sorted[0], superseded: sorted.slice(1) };
}
