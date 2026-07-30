# 스레드 오토파일럿

공식 Threads API로 예약된 글을 발행하고, **내 글에 달린 답글에 자동으로 답한다.**

브라우저 자동화가 아니다. 로그인 세션을 조작하는 방식은 메타 약관 위반이고 계정
정지 위험을 지는데, 공식 API 한도가 **글 250건/일 · 답글 1,000건/일**로 필요량의
10~50배다. 위험한 쪽을 갈 이유가 없다.

## 무엇이 자동이고 무엇이 아닌가

| | |
|---|---|
| 자동 | 글 발행(일차 순서 강제), 답글 읽기, 답글 작성·게시, 욕설·스팸 숨기기 |
| 사람 | `config.escalate` 에 걸리는 답글 (기본: 환불 분쟁, 법적 조치 언급, 개인정보 요구, 수익 보장 요구, 명예훼손 소지) |

답글은 **초안 검토 없이 바로 게시된다.** escalate 항목만 예외로 빼두는 이유는
공개 답글이 잘못 나가는 비용이 늦게 답하는 비용보다 크기 때문이다. 전부 자동으로
돌리려면 `config.json` 의 `escalate` 를 `[]` 로 비우면 된다.

## 세팅 (30~60분, 한 번만)

### 1. 스레드 앱과 토큰

메타 개발자 콘솔에서 Threads 앱을 만들고 아래 권한으로 **장기 토큰**을 발급받는다.

| 권한 | 왜 필요한가 |
|---|---|
| `threads_basic` | 모든 호출의 기본 |
| `threads_content_publish` | 글·답글 발행 |
| `threads_manage_replies` | 답글 숨기기 |

- [앱 만들기](https://developers.facebook.com/documentation/threads/get-started/create-an-app)
- [토큰과 권한](https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions)
- [장기 토큰](https://developers.facebook.com/documentation/threads/get-started/long-lived-tokens)

장기 토큰도 만료된다. 72시간짜리 운영이면 문제없지만, 계속 돌릴 거면 갱신 주기를
확인해두세요.

### 2. 설정

```bash
cd threads
npm install
cp config.example.json config.json
```

`config.json` 에서 채워야 하는 것:

- `product.accountName`, `product.contact` — 나머지 `product` 항목은 이미 채워져 있고,
  **답글에 나갈 사실의 원천이다.** 여기 없는 기능·가격은 모델이 만들어내지 않는다.
  도구를 고치면 이쪽도 같이 고쳐야 한다.
- `escalate` — 사람이 봐야 하는 항목. 비우면 전부 자동.

**토큰은 환경변수로 넣는 걸 권한다** (설정 파일이 커밋되는 사고를 막는다):

```bash
export THREADS_USER_ID=...
export THREADS_ACCESS_TOKEN=...
export ANTHROPIC_API_KEY=...
```

`config.json` 과 `state/` 는 `.gitignore` 에 들어 있다.

### 3. 점검

아무것도 게시하지 않고 설정·토큰·키·글 길이를 전부 확인한다.

```bash
npm run check
```

여기를 통과한 다음에만 진행하세요.

## 실행

```bash
npm run publish -- --dry   # 무엇이 올라갈지만 출력
npm run publish            # 오늘 올릴 글 발행
npm run reply -- --dry     # 답글에 어떻게 대응할지만 출력 (게시 안 함)
npm run reply              # 답글 게시
npm run loop               # 10분마다 위 둘을 반복 (무인 운영)
npm run loop -- --interval 300   # 5분 주기
```

`loop` 가 72시간 동안 돌아가는 프로세스다. `Ctrl+C` 한 번은 이번 주기를 마치고
정상 종료, 두 번은 즉시 종료.

**자동화의 실제 가치는 양이 아니라 반응 속도다.** 새벽 3시 댓글에 10분 안에 답이
가는 건 사람이 못 한다. 반대로 한도가 250건이라고 250개를 올리면 계정이 죽는다 —
기본값은 글 6건/일이고, 그게 상한이라고 보면 된다.

## 글 목록 — `posts.md`

```
# id: 01-result-hook
# day: 1
본문 (최대 500자)
===
# id: 02-...
```

- `id` — 멱등성 키. 같은 id는 두 번 발행되지 않는다. 바꾸면 재발행된다.
- `day` — 첫 발행일로부터의 상대 일차. **판매 글이 1일차에 나가는 사고를 막는 장치다.**
  기본 8건은 1일차 3 / 2일차 3 / 3일차 2로 짜여 있고, 판매 글은 3일차에만 있다.
- 500자 제한. 이모지는 UTF-8 바이트로 계산된다(한글은 1자).

`loop` 는 매 주기 `posts.md` 를 다시 읽는다 — 돌아가는 중에 글을 추가할 수 있다.

## 상태 파일

| 파일 | 내용 |
|---|---|
| `state/state.json` | 발행한 글, 처리한 답글, 24시간 이동 창 카운터 |
| `state/escalations.jsonl` | 사람이 봐야 하는 답글 (원문·작성자·링크·이유) |

`state.json` 을 지우면 **전부 다시 발행된다.** 백업하거나 건드리지 마세요.

## 하지 않는 것

- 여러 계정으로 자연스러운 호응을 꾸며내는 것 (바이럴 조작)
- 남의 글에 무관하게 답글을 다는 것 — 이 도구는 **내 글에 달린 답글**만 다룬다
- 수익·조회수 보장. 시스템 프롬프트가 이걸 금지하고 있고, 풀어야 할 이유가 없다

## 테스트

```bash
npm test
```

목 HTTP 서버로 API 흐름을 검증한다 — 컨테이너 생성 → 발행 2단계, `reply_to_id`
전달, 4xx 재시도 안 함 / 5xx 재시도, 길이 계산, 상태 멱등성. 실제 자격증명 없이 돈다.

## 알려진 주의점

- **호스트 표기가 문서마다 다르다.** 메타 문서가 `graph.threads.com` 과
  `graph.threads.net` 을 섞어 쓴다. 기본값은 `.com` 이고 `config.threads.host` 로
  바꿀 수 있다.
- **모델은 `claude-opus-5` 기본값이다.** 답글 품질이 계정 신뢰도에 직결되므로
  기본을 낮추지 않았다. 비용을 줄이려면 `anthropic.model` 을 `claude-sonnet-5` 나
  `claude-haiku-4-5` 로 바꾸면 되는데, 그건 판단해서 선택하세요.
  거절 시 서버측 fallback 을 켜두었고, 지원되지 않는 환경이면 자동으로 일반 호출로
  내려간다.
