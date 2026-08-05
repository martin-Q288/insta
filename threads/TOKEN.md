# 토큰 받아오기

계정은 만들어졌고, 여기서 받아올 건 **숫자 하나(사용자 ID)와 문자열 하나(장기 토큰)**
뿐입니다. 30~60분, 한 번만 하면 됩니다.

**콘솔 화면은 자주 바뀝니다.** 그래서 이 문서는 버튼 이름이 아니라
**"이 단계가 됐는지 어떻게 확인하는가"**를 기준으로 씁니다.
각 단계마다 확인 명령이 붙어 있으니, 그게 통과하면 다음으로 가시면 됩니다.

---

## 0. 먼저 확인

- [ ] 인스타그램 계정 `ai.lo.lo` 생성됨
- [ ] **스레드 계정으로 연결됨** — threads.com 에서 로그인이 되는지
- [ ] 표시 이름·소개글 채움 (`ACCOUNT.md`)
- [ ] 게시물 3개 올림 (`book/cards/` 의 png 세 장)

**프로필을 먼저 채우십시오.** 토큰은 나중에 받아도 되지만, 빈 프로필로
첫 글이 나가면 그 글은 버리는 겁니다.

---

## 1. 앱 만들기

메타 개발자 콘솔에서 앱을 만들고 Threads API 를 붙입니다.

- [앱 만들기](https://developers.facebook.com/documentation/threads/get-started/create-an-app)

앱 유형 목록에 스레드용이 안 보이면, 앱을 먼저 만든 뒤 **제품 추가**에서
Threads API 를 붙이면 됩니다.

여기서 **앱 ID**와 **앱 시크릿**을 적어두십시오. 나중에 장기 토큰으로
교환할 때 시크릿이 필요합니다.

---

## 2. 권한 세 개

| 권한 | 없으면 |
|---|---|
| `threads_basic` | 아무것도 안 됨 |
| `threads_content_publish` | 글·답글 발행이 안 됨 |
| `threads_manage_replies` | 욕설·스팸 숨기기가 안 됨 |

**셋 다 켜십시오.** 하나만 빠져도 그 기능에서만 권한 오류가 나는데,
봇이 며칠 돌다가 처음 욕설 답글을 만났을 때 터지면 원인 찾기가 번거롭습니다.

---

## 3. 리디렉션 주소

**등록한 값과 호출할 때 넣는 값이 글자 하나까지 같아야 합니다.**
끝의 슬래시 하나 차이로 실패하고, 오류 메시지가 친절하지 않습니다.

로컬에서 받으실 거면 등록값과 호출값 양쪽에 똑같은 문자열을 쓰시고,
**복사해서 붙여넣으십시오.** 손으로 두 번 타이핑하면 언젠가 틀립니다.

---

## 4. 단기 토큰 → 장기 토큰

인증을 마치면 단기 토큰이 나옵니다. **한 시간 남짓이라 자동화에 못 씁니다.**
반드시 교환하십시오.

- [토큰과 권한](https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions)
- [장기 토큰](https://developers.facebook.com/documentation/threads/get-started/long-lived-tokens)

교환은 대략 이 형태입니다. **파라미터 이름은 위 문서에서 한 번 대조하십시오** —
사양이 바뀌면 이 문서보다 원문이 맞습니다.

```bash
curl -s -G "https://graph.threads.net/access_token" \
  --data-urlencode "grant_type=th_exchange_token" \
  --data-urlencode "client_secret=<앱 시크릿>" \
  --data-urlencode "access_token=<단기 토큰>"
```

응답에 `access_token` 과 `expires_in` 이 옵니다. **`expires_in` 을 꼭 보십시오.**
초 단위이고, 몇 천 초대면 교환이 안 된 겁니다. 며칠 단위여야 맞습니다.

> **호스트 표기가 문서마다 섞여 있습니다.** `graph.threads.net` 과
> `graph.threads.com` 이 둘 다 나옵니다. 한쪽으로 통일해서 시험해보고
> 되는 쪽을 쓰시면 됩니다. 봇 기본값은 `.com` 이고 `config.threads.host` 로 바꿉니다.

---

## 5. 사용자 ID 확인

```bash
export THREADS_ACCESS_TOKEN='<장기 토큰>'

curl -s -G "https://graph.threads.com/v1.0/me" \
  --data-urlencode "fields=id,username" \
  --data-urlencode "access_token=$THREADS_ACCESS_TOKEN"
```

**`username` 이 `ai.lo.lo` 로 나오는지 확인하십시오.** 다른 계정이 나오면
엉뚱한 계정으로 인증한 겁니다 — 여기서 안 잡으면 남의 계정에 글이 올라갑니다.

`id` 가 사용자 ID입니다. 숫자 문자열입니다.

---

## 6. 환경변수와 설정

```bash
cd threads
npm install
cp config.example.json config.json
```

토큰은 **환경변수로 넣으십시오.** `config.json` 이 `.gitignore` 에 있긴 하지만,
파일에 안 적는 게 사고를 원천 차단합니다.

```bash
export THREADS_USER_ID='<위에서 받은 id>'
export THREADS_ACCESS_TOKEN='<장기 토큰>'
export ANTHROPIC_API_KEY='<앤트로픽 키>'
```

`config.json` 에서 손볼 곳은 두 군데뿐입니다. 나머지는 채워져 있습니다.

| 항목 | 넣을 값 |
|---|---|
| `product.accountName` | `AI_LoLo` |
| `product.contact` | `이 계정 DM` — **전화번호를 넣지 마십시오.** 답글은 공개입니다 |

`sales` 블록은 `book/latpeed.md` 의 가격 정책과 이미 맞춰져 있습니다.
래피드에 등록하면서 숫자를 바꾸셨다면 여기도 같이 고치십시오.
**어긋나면 중계 글이 거짓말을 합니다.** `check` 가 대조해서 잡아줍니다.

---

## 7. 점검

```bash
npm run check
```

아무것도 게시하지 않고 설정·토큰·키·글 길이·순서를 전부 확인합니다.
**여기 통과 전에는 진행하지 마십시오.**

통과하면 무엇이 올라갈지부터 봅니다.

```bash
npm run publish -- --dry
```

---

## 8. 첫 글은 손으로

**`00-intro` 와 `01-speed` 는 직접 복사해서 올리십시오.**
`posts.md` 에 문안이 있습니다.

팔로워 0인 새 계정이 첫날부터 API로만 발행하는 건 굳이 만들 필요 없는
스팸 신호입니다. 계정이 살아 있는 걸 확인한 다음 `loop` 를 켭니다.

```bash
npm run loop
```

---

## 막혔을 때

| 증상 | 원인 |
|---|---|
| 권한 오류 (`permission`) | 스코프 누락. 세 개 다 켰는지 |
| 리디렉션 불일치 | 등록값 ≠ 호출값. 슬래시까지 대조 |
| 한 시간쯤 뒤 전부 실패 | 단기 토큰을 그대로 씀. 4번 다시 |
| 호스트 오류 / 404 | `.com` ↔ `.net` 바꿔서 시험 |
| `me` 가 다른 계정을 반환 | 엉뚱한 계정으로 인증. 로그아웃하고 다시 |
| `check` 가 미기입 자리를 잡음 | `posts.md` 에 `「」` 가 남아 있음. 채우면 됩니다 |

**오류 메시지가 나오면 그대로 저한테 붙여넣으십시오.** 추측으로 고치는 것보다
메시지를 보고 짚는 쪽이 훨씬 빠릅니다.

---

## 토큰을 실수로 올렸다면

**즉시 폐기하고 다시 발급받으십시오.** 커밋을 되돌리는 걸로는 부족합니다 —
푸시된 순간 이미 남습니다. 순서는 폐기 먼저, 정리는 나중입니다.
