#!/usr/bin/env python3
"""인스타 프로필용 카드 3장 생성.

    python3 book/cards.py          # book/cards/*.png

활동은 스레드에서 하지만, 거기서 넘어온 사람이 인스타에 왔을 때 게시물이
0개면 흠집이 난다. 명함 역할을 할 세 장만 만든다.

1080x1350 (4:5). 인스타에서 피드 세로 공간을 가장 많이 차지하는 비율이고,
표가 들어가야 해서 정사각형으로는 좁다.

폰트는 build_book.py 와 같은 방식으로 심는다 — 헤드리스 크로미움은 local()
을 무시하고 file:// 도 막으므로 데이터 URI 만 확실하다.
"""

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from build_book import font_faces, find_chromium  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "cards"
W, H = 1080, 1350

BASE = """
__FONT_FACES__
:root{
  --paper:#F1F4F7; --panel:#FFFFFF; --panel-2:#E9EEF3; --ink:#13181D;
  --steel:#57646F; --steel-2:#8996A3; --rule:#D3DBE3; --rule-strong:#B6C2CD;
  --accent:#C8410A; --accent-soft:#FBE7DC; --machine:#1C4A72;
  --mono:"SFMono-Regular",Menlo,Consolas,monospace;
}
*{box-sizing:border-box; margin:0; padding:0;}
html{width:1080px;}
/* 고정 height + margin-top:auto 조합은 마지막 요소가 잘린다.
   min-height 로 두고 아래쪽 여백은 .foot 의 padding 으로 확보한다. */
body{
  width:1080px; min-height:1350px;
  font-family:"Pretendard",sans-serif; background:var(--paper); color:var(--ink);
  letter-spacing:-.03em; word-break:keep-all; line-height:1.5;
  display:flex; flex-direction:column; padding:70px 72px 0;
}
.eyebrow{
  font-family:var(--mono); font-size:20px; letter-spacing:.2em; line-height:1.2;
  text-transform:uppercase; color:var(--accent); font-weight:600;
  display:flex; align-items:center; gap:16px; flex:none;
}
.eyebrow::after{content:""; flex:1; height:2px; background:var(--rule);}
.foot{
  margin-top:auto; padding:26px 0 62px; border-top:2px solid var(--ink);
  display:flex; justify-content:space-between; align-items:baseline; gap:20px;
  font-size:21px; line-height:1.5; color:var(--steel); letter-spacing:-.02em; flex:none;
}
.foot b{color:var(--ink); font-weight:700;}
.handle{font-family:var(--mono); font-size:20px; color:var(--steel-2); letter-spacing:.02em;}
"""

# ── 1. 표지 ──────────────────────────────────────────────────────
COVER = """
<style>
h1{font-size:84px; font-weight:800; line-height:1.1; letter-spacing:-.05em; margin-top:44px;}
h1 em{font-style:normal; color:var(--accent);}
.sub{font-size:32px; color:var(--steel); line-height:1.45; margin-top:26px; font-weight:500;}
.what{
  margin-top:40px; display:flex; flex-direction:column; gap:0;
  border-top:2px solid var(--ink); border-bottom:2px solid var(--ink);
}
.what div{
  padding:19px 4px; font-size:27px; letter-spacing:-.03em;
  display:flex; gap:18px; align-items:baseline;
}
.what div + div{border-top:1px solid var(--rule);}
.what i{
  font-style:normal; font-family:var(--mono); font-size:19px;
  color:var(--accent); font-weight:700; flex:none; width:34px;
}
.what b{font-weight:700;}
.slab{
  margin-top:36px; background:var(--ink); color:#fff; border-radius:6px;
  padding:30px 34px; display:flex; flex-direction:column; gap:12px;
}
.slab .n{font-family:var(--mono); font-size:18px; letter-spacing:.16em; color:#8996A3;}
.slab .t{font-size:28px; font-weight:700; line-height:1.5; letter-spacing:-.03em;}
.slab .t b{color:#FF7A3D;}
</style>
<p class="eyebrow">전자책 · PDF 26면</p>
<h1>AI 활용할 줄은<br>아는데<br><em>어떻게 수익화 할까</em></h1>
<p class="sub">__SUBTITLE__</p>
<div class="what">
  <div><i>01</i><span>수익 모델 <b>4종</b>과 실제 시장 단가</span></div>
  <div><i>02</i><span>내 조건에 맞는 모델 <b>선택 기준</b></span></div>
  <div><i>03</i><span>아이템 발굴과 <b>시장 검증법</b></span></div>
  <div><i>04</i><span><b>견적 산정</b>과 범위 합의</span></div>
  <div><i>05</i><span>첫 문의부터 <b>입금까지의 프로세스</b></span></div>
  <div><i>06</i><span>결제 · 납품 · 법무 &nbsp;·&nbsp; 프롬프트 <b>9종</b></span></div>
</div>
<div class="slab">
  <p class="n">이 자료의 기준</p>
  <p class="t">단가·수수료·법 조항은 전부 <b>확인해서</b> 넣었습니다.<br>
  수치마다 <b>확인 경로</b>를 부록에 함께 적었습니다.</p>
</div>
<div class="foot">
  <span><b>라스트 아더</b> · 앞 3면 무료 미리보기</span>
  <span class="handle">@ai.lo.lo</span>
</div>
"""

# ── 2. 여섯 칸 ───────────────────────────────────────────────────
# 네 가지 수익화 모델. 이게 이 책의 1부이자 제목이 약속한 답이다.
MODELS = [
    ("①", "제품 판매", "5천~5만원", "며칠", "트래픽"),
    ("②", "제작 대행", "15만~200만원", "1~3주", "내 공수"),
    ("③", "운영 대행", "월 과금·누적", "1개월+", "판매 난이도"),
    ("④", "교육·컨설팅", "편차 큼", "가장 김", "레퍼런스"),
]

WALLS = (
    """
<style>
h1{font-size:58px; font-weight:800; line-height:1.18; letter-spacing:-.045em; margin-top:32px;}
.lede{font-size:25px; color:var(--steel); margin-top:16px; line-height:1.5;}
.rows{margin-top:30px; display:flex; flex-direction:column; gap:2px;
      background:var(--rule); border:2px solid var(--ink); border-radius:6px; overflow:hidden;}
.hd{background:var(--ink); color:#fff; padding:14px 24px; display:grid;
    grid-template-columns:52px 1fr 250px 150px; gap:14px;
    font-size:20px; font-weight:700; letter-spacing:-.02em;}
.hd span:nth-child(3), .hd span:nth-child(4){text-align:right;}
.r{background:var(--panel); padding:22px 24px; display:grid;
   grid-template-columns:52px 1fr 250px 150px; align-items:baseline; gap:14px;}
.r .n{font-family:var(--mono); font-size:24px; font-weight:700; color:var(--accent);}
.r .t{font-size:30px; font-weight:800; letter-spacing:-.035em;}
.r .p{font-size:26px; font-weight:700; text-align:right; letter-spacing:-.035em;}
.r .w{font-size:24px; color:var(--steel); text-align:right; letter-spacing:-.03em;}
.r .lim{grid-column:2 / -1; font-size:22px; color:var(--steel-2);
        margin-top:6px; letter-spacing:-.02em;}
.slab{
  margin-top:28px; background:var(--ink); color:#fff; border-radius:6px;
  padding:26px 30px; font-size:26px; line-height:1.5; letter-spacing:-.03em; font-weight:600;
}
.slab b{color:#FF7A3D;}
</style>
<p class="eyebrow">AI 수익화 모델</p>
<h1>구조는 네 가지뿐입니다</h1>
<p class="lede">객단가도, 리드타임도, 확장 방식도<br>전부 다른 사업입니다.</p>
<div class="rows">
  <div class="hd"><span></span><span>모델</span><span>객단가</span><span>리드타임</span></div>
"""
    + "".join(
        f'<div class="r"><span class="n">{n}</span><span class="t">{t}</span>'
        f'<span class="p">{price}</span><span class="w">{when}</span>'
        f'<span class="lim">병목 — {lim}</span></div>'
        for n, t, price, when, lim in MODELS
    )
    + """
</div>
<div class="slab">
  오디언스가 없으면 <b>①번은 0원입니다.</b><br>
  소수에게 고단가로 파는 쪽이 먼저입니다.
</div>
<div class="foot">
  <span><b>AI 활용할 줄은 아는데 어떻게 수익화 할까</b> · PDF 26면</span>
  <span class="handle">@ai.lo.lo</span>
</div>
"""
)

# ── 3. 수수료 비교 ───────────────────────────────────────────────
# 자동발송 여부까지 같이 보여야 판단이 된다. 수수료만 보면 스마트스토어가
# 싸 보이는데, 자동발송이 없다는 게 실제로는 더 큰 비용이다.
FEES = [
    ("래피드", "1.6%", "O", True),
    ("리틀리", "1~5%", "O", True),
    ("스마트스토어", "약 6%", "X", False),
    ("크몽", "4.4~16.4%", "O", False),
    ("탈잉", "20%", "—", False),
    ("클래스101", "20% 이상", "—", False),
    ("토스페이먼츠", "0.63~3.4%", "직접 구현", False),
]

FEE = (
    """
<style>
h1{font-size:58px; font-weight:800; line-height:1.18; letter-spacing:-.045em; margin-top:30px;}
.lede{font-size:25px; color:var(--steel); margin-top:16px; line-height:1.5;}
table{width:100%; border-collapse:collapse; margin-top:26px;
      border:2px solid var(--ink); border-radius:6px; overflow:hidden;}
th{background:var(--ink); color:#fff; font-size:21px; font-weight:700;
   padding:14px 20px; text-align:left; letter-spacing:-.02em;}
th:not(:first-child), td:not(:first-child){text-align:right;}
td{padding:13px 20px; font-size:26px; border-top:1px solid var(--rule);
   background:var(--panel); letter-spacing:-.03em;}
td:first-child{font-weight:700;}
tr.hot td{background:var(--accent-soft);}
tr.hot td:nth-child(2){color:var(--accent); font-weight:800;}
.x{color:var(--accent); font-weight:800;}
.o{color:var(--machine); font-weight:800;}
.gap{
  margin-top:24px; padding:20px 0; border-top:2px solid var(--ink);
  border-bottom:2px solid var(--ink); text-align:center;
}
.gap .g1{font-size:23px; color:var(--steel); letter-spacing:-.02em;}
.gap .g2{font-size:36px; font-weight:800; letter-spacing:-.04em; margin-top:8px;}
.gap .g2 b{font-weight:800;}
.gap .g2 .hot{color:var(--accent);}
.gap .g3{font-size:22px; color:var(--steel); margin-top:10px; letter-spacing:-.02em;}
.kicker{
  margin-top:26px; background:var(--ink); color:#fff; border-radius:6px;
  padding:24px 30px; font-size:26px; line-height:1.5; letter-spacing:-.03em; font-weight:600;
}
.kicker b{color:#FF7A3D;}
</style>
<p class="eyebrow">2026년 7월 확인 기준</p>
<h1>디지털 파일,<br>어디서 팔면 얼마 떼나</h1>
<p class="lede">"높다/낮다"로는 판단이 안 됩니다.</p>
<table>
<tr><th>플랫폼</th><th>수수료</th><th>자동 발송</th></tr>
"""
    + "".join(
        f'<tr class="{"hot" if hot else ""}"><td>{name}</td><td>{fee}</td>'
        f'<td class="{"x" if auto == "X" else "o" if auto == "O" else ""}">{auto}</td></tr>'
        for name, fee, auto, hot in FEES
    )
    + """
</table>
<div class="gap">
  <p class="g1">29,000원짜리 한 권을 팔면</p>
  <p class="g2"><b>탈잉 5,800원</b> 뗀다 &nbsp;·&nbsp; <b class="hot">래피드 464원</b> 뗀다</p>
  <p class="g3">그 차이가 손님 유입의 값입니다. 공짜는 없습니다.</p>
</div>
<div class="kicker">
  그리고 수수료만 보면 안 됩니다. <b>스마트스토어는 파일 자동발송이 없고</b>,
  정산도 구매확정 이후라 실질 2~3주 걸립니다.
</div>
<div class="foot">
  <span>요율은 바뀝니다 · <b>본인 등급은 직접 확인</b></span>
  <span class="handle">@ai.lo.lo</span>
</div>
"""
)

# 표지 부제. 전환 문구라 원고와 카드가 어긋나면 안 되므로 원고 머리말에서 읽는다.
SUBTITLE = "네 가지 수익 모델과 첫 매출까지의 실행 순서"

CARDS = {
    "01-cover": COVER.replace("__SUBTITLE__", SUBTITLE),
    "02-walls": WALLS,
    "03-fees": FEE,
}


def shoot(chrome: str, html: Path, png: Path, w: int, h: int) -> None:
    subprocess.run(
        [
            chrome,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            f"--window-size={w},{h}",
            f"--screenshot={png}",
            html.as_uri(),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )


PROBE_H = 2400
FOOT_PAD = 62  # .foot 의 padding-bottom. 마지막 글자 아래 남길 여백


def render(chrome: str, html: Path, png: Path) -> int:
    """넉넉한 창으로 찍고 카드 크기로 잘라낸다. 넘친 픽셀 수를 돌려준다.

    창 높이를 1350 으로 맞춰 찍으면 뷰포트 경계에서 마지막 줄이 통째로
    빠지는 경우가 있다 — 실제로 푸터를 두 번 날렸다. 크게 찍어서 자르면
    그 경우가 사라지고, 자르기 전에 내용이 얼마나 넘치는지도 잴 수 있다.
    """
    from PIL import Image

    probe = png.with_suffix(".probe.png")
    probe.unlink(missing_ok=True)
    shoot(chrome, html, probe, W, PROBE_H)
    if not probe.exists():
        raise RuntimeError(f"렌더 실패: {html.name}")

    im = Image.open(probe).convert("RGB")
    bg = im.getpixel((5, PROBE_H - 5))
    last = 0
    for y in range(im.height - 1, -1, -1):
        if any(im.getpixel((x, y)) != bg for x in range(0, im.width, 8)):
            last = y
            break

    im.crop((0, 0, W, H)).save(png)
    probe.unlink(missing_ok=True)
    return (last + FOOT_PAD) - H


def main() -> int:
    failed = False
    chrome = find_chromium()
    if not chrome:
        print("크로미움을 못 찾았습니다.", file=sys.stderr)
        return 1

    faces = font_faces()
    if not faces:
        print(
            "경고: Pretendard 를 못 찾았습니다. 한글이 중국어 폰트로 떨어집니다.\n"
            "      ~/.fonts 에 Pretendard-{Regular,SemiBold,Bold}.otf 를 넣으세요.",
            file=sys.stderr,
        )
    css = BASE.replace("__FONT_FACES__", faces)

    OUT.mkdir(exist_ok=True)
    for name, body in CARDS.items():
        html = OUT / f"{name}.html"
        png = OUT / f"{name}.png"
        html.write_text(
            '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
            f"<style>{css}</style></head><body>{body}</body></html>\n",
            encoding="utf-8",
        )
        png.unlink(missing_ok=True)  # 실패해도 이전 파일이 남는다
        over = render(chrome, html, png)
        flag = "" if over <= 0 else f"  ← {over}px 넘침. 내용을 줄이세요"
        print(f"{png.relative_to(ROOT.parent)}  ({png.stat().st_size // 1024} KB){flag}")
        if over > 0:
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
