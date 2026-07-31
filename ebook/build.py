#!/usr/bin/env python3
"""manuscript.md → ebook.html → ebook.pdf

사용:
    pip install markdown
    python3 ebook/build.py

PDF 렌더링은 크로미움 헤드리스를 씁니다. 한글은 Pretendard 를 쓰고,
없으면 시스템 폰트로 떨어집니다(그 경우 자간이 어색해집니다 — 아래 안내 참고).
"""

import base64
import re
import shutil
import subprocess
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "manuscript.md"
HTML = ROOT / "ebook.html"
PDF = ROOT / "ebook.pdf"

# 판매용 파일에 미기입 자리가 남아 나가는 사고를 막는다 (판매 페이지와 같은 규칙)
PLACEHOLDER = re.compile(r"「([^」]*)」")

FONT_DIRS = [Path.home() / ".fonts", Path("/usr/share/fonts")]
FONT_WEIGHTS = {"Regular": 400, "SemiBold": 600, "Bold": 700}


def font_faces() -> str:
    """설치된 Pretendard 를 base64 로 HTML 안에 심는다.

    한글이 중국어 폰트(WenQuanYi)로 떨어지면 한국어 독자에게 자형이 눈에 띄게
    어색하다. local() 은 헤드리스 크로미움이 무시하고, file:// url() 은
    --allow-file-access-from-files 를 줘도 차단된다. 데이터 URI 만 확실하다.
    HTML 이 몇 MB 커지지만 중간 산출물이고, PDF 에는 서브셋만 들어간다.
    """
    faces = []
    for style, weight in FONT_WEIGHTS.items():
        for d in FONT_DIRS:
            hit = next(d.rglob(f"Pretendard-{style}.otf"), None) if d.exists() else None
            if hit:
                b64 = base64.b64encode(hit.read_bytes()).decode("ascii")
                faces.append(
                    f'@font-face{{font-family:"Pretendard";'
                    f'src:url("data:font/otf;base64,{b64}") format("opentype");'
                    f"font-weight:{weight};font-style:normal;}}"
                )
                break
    return "\n".join(faces)


CSS = """
@page { size: A4; margin: 20mm 18mm 22mm; }

__FONT_FACES__

:root{
  --ink:#14181D; --steel:#4A555F; --steel-2:#7B8792;
  --rule:#D9DFE5; --accent:#C8410A; --accent-soft:#FBE7DC; --panel:#F4F6F8;
}
*{ box-sizing:border-box; }
body{
  font-family:"Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif;
  color:var(--ink); font-size:10.5pt; line-height:1.75;
  letter-spacing:-.01em; word-break:keep-all; margin:0;
}

h1{
  font-size:26pt; font-weight:700; letter-spacing:-.03em; line-height:1.2;
  margin:0 0 6mm; text-wrap:balance;
}
/* 장마다 페이지를 끊지 않는다 — 짧은 장이 많아 빈 면이 크게 남는다.
   흐르게 두되 제목이 페이지 끝에 혼자 남는 것만 막는다. */
h2{
  font-size:15pt; font-weight:700; letter-spacing:-.025em; line-height:1.3;
  margin:12mm 0 4mm; padding-top:3mm; border-top:2px solid var(--ink);
  break-after:avoid; break-inside:avoid;
}
body > h2:first-of-type{ margin-top:0; }
/* 부록은 새 면에서 시작한다 — 여기부터가 실제로 쓰는 부분이라 찾기 쉬워야 한다.
   원고에서 {: .page-break } 로 표시한다 (자동 생성 id 는 불안정해서 안 쓴다). */
.page-break{ break-before:page; }
h3{
  font-size:11.5pt; font-weight:700; letter-spacing:-.02em;
  margin:7mm 0 2mm; break-after:avoid;
}
p{ margin:0 0 3.5mm; }
strong{ font-weight:700; }

ul,ol{ margin:0 0 4mm; padding-left:5mm; }
li{ margin-bottom:1.5mm; }

hr{ border:none; border-top:1px solid var(--rule); margin:6mm 0; }

blockquote{
  margin:4mm 0; padding:3mm 4mm;
  background:var(--panel); border-left:3px solid var(--accent);
  border-radius:0 2px 2px 0; break-inside:avoid;
}
blockquote p:last-child{ margin-bottom:0; }

table{
  width:100%; border-collapse:collapse; margin:4mm 0;
  font-size:9.5pt; break-inside:avoid;
}
th,td{
  border:1px solid var(--rule); padding:2mm 2.5mm;
  text-align:left; vertical-align:top;
}
th{ background:var(--panel); font-weight:700; }

code{
  /* 라틴은 고정폭, 한글은 Pretendard. 안 넣으면 프롬프트 블록의 한글이
     중국어 폰트로 떨어진다 — 부록 A 가 이 책의 핵심이라 그러면 안 된다. */
  font-family:"SFMono-Regular",Menlo,Consolas,"Pretendard",monospace;
  font-size:9pt; background:var(--accent-soft); color:var(--accent);
  padding:.5mm 1.2mm; border-radius:2px;
}
pre{
  background:var(--panel); border:1px solid var(--rule); border-radius:3px;
  padding:3.5mm 4mm; margin:4mm 0; overflow:visible;
  white-space:pre-wrap; word-break:break-word; font-size:8.5pt; line-height:1.6;
}
pre code{ background:none; color:var(--ink); padding:0; font-size:inherit; }

/* 표지 */
.cover{
  break-after:page; padding-top:55mm;
}
.cover .eyebrow{
  font-size:9pt; letter-spacing:.18em; text-transform:uppercase;
  color:var(--steel-2); margin-bottom:5mm;
}
.cover h1{ font-size:34pt; }
.cover .sub{ font-size:13pt; color:var(--steel); margin-top:5mm; line-height:1.6; }
.cover .foot{
  margin-top:70mm; padding-top:4mm; border-top:1px solid var(--rule);
  font-size:9pt; color:var(--steel-2);
}
"""

COVER = """
<div class="cover">
  <p class="eyebrow">프롬프트 팩 + 실전 가이드</p>
  <h1>기사 하나로<br>콘텐츠 20개</h1>
  <p class="sub">인스타 카드뉴스·릴스를<br>다국어로 대량 발행하는 실전 가이드</p>
  <p class="foot">
    이 자료는 콘텐츠 제작 시간 단축을 위한 것입니다.<br>
    조회수·팔로워·수익을 보장하지 않습니다.
  </p>
</div>
"""


def find_chromium() -> str | None:
    for c in (
        "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        "/opt/pw-browsers/chromium/chrome-linux/chrome",
    ):
        if Path(c).exists():
            return c
    for name in ("chromium", "chromium-browser", "google-chrome"):
        p = shutil.which(name)
        if p:
            return p
    return None


def main() -> int:
    if not SRC.exists():
        print(f"원고가 없습니다: {SRC}", file=sys.stderr)
        return 1

    text = SRC.read_text(encoding="utf-8")

    holes = PLACEHOLDER.findall(text)
    if holes:
        print("원고에 미기입 자리가 남아 있습니다:", file=sys.stderr)
        for h in holes:
            print(f"  「{h or '(빈 자리)'}」", file=sys.stderr)
        print("채운 뒤 다시 실행하세요.", file=sys.stderr)
        return 1

    # 첫 h1 은 표지가 대신하므로 본문에서 뺀다
    body_md = re.sub(r"\A#\s+.*?\n", "", text, count=1)

    body = markdown.markdown(
        body_md,
        extensions=["tables", "fenced_code", "sane_lists", "attr_list", "toc"],
    )

    faces = font_faces()
    if not faces:
        print(
            "경고: Pretendard 를 못 찾았습니다. 한글이 중국어 폰트로 렌더링되어\n"
            "      자형이 어색해집니다. ~/.fonts 에 Pretendard-{Regular,SemiBold,Bold}.otf\n"
            "      를 넣고 다시 실행하세요.",
            file=sys.stderr,
        )
    css = CSS.replace("__FONT_FACES__", faces)

    HTML.write_text(
        "<!doctype html>\n"
        '<html lang="ko"><head><meta charset="utf-8">'
        "<title>기사 하나로 콘텐츠 20개</title>"
        f"<style>{css}</style></head><body>{COVER}{body}</body></html>\n",
        encoding="utf-8",
    )
    print(f"HTML 생성: {HTML.relative_to(ROOT.parent)}")

    chrome = find_chromium()
    if not chrome:
        print("크로미움을 못 찾았습니다. HTML 을 브라우저에서 열어 PDF로 인쇄하세요.")
        return 0

    cmd = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--no-pdf-header-footer",
        "--allow-file-access-from-files",
        f"--print-to-pdf={PDF}",
        HTML.as_uri(),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if not PDF.exists():
        print("PDF 생성 실패:", r.stderr[-800:], file=sys.stderr)
        return 1

    size_kb = PDF.stat().st_size / 1024
    print(f"PDF 생성: {PDF.relative_to(ROOT.parent)} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
