#!/usr/bin/env python3
"""manuscript.md → ebook.html → ebook.pdf

사용:
    pip install markdown
    python3 build_book.py book      # book/manuscript.md → book/ebook.pdf
    python3 build_book.py ebook

표지 문구는 원고 맨 위 주석에서 읽습니다. 책마다 스크립트를 복제하지
않으려고 이렇게 뒀습니다.

    <!--
    eyebrow: 실전 가이드
    title: 제목<br>두 줄 가능
    subtitle: 부제
    -->

PDF 렌더링은 크로미움 헤드리스를 씁니다. 한글은 Pretendard 를 쓰고,
없으면 시스템 폰트로 떨어집니다(그 경우 자간이 어색해집니다 — 아래 안내 참고).
"""

import base64
import html as html_mod
import re
import shutil
import subprocess
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent

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
  <p class="eyebrow">__EYEBROW__</p>
  <h1>__TITLE__</h1>
  <p class="sub">__SUBTITLE__</p>
  <p class="foot">
    이 자료는 작업 시간 단축을 위한 것입니다.<br>
    수익·성과를 보장하지 않습니다.
  </p>
</div>
"""

FRONT_MATTER = re.compile(r"\A<!--\s*\n(.*?)\n-->\s*\n", re.DOTALL)


def read_front_matter(text: str) -> tuple[dict[str, str], str]:
    """원고 맨 위 주석에서 표지 문구를 떼어낸다.

    <br> 은 그대로 살려야 표지에서 줄을 끊을 수 있으므로, 이스케이프한 뒤
    <br> 만 되돌린다. 없으면 빈 dict 을 주고 호출부에서 기본값을 채운다.
    """
    m = FRONT_MATTER.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        meta[k.strip()] = html_mod.escape(v.strip()).replace("&lt;br&gt;", "<br>")
    return meta, text[m.end():]


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


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("사용: python3 build_book.py <디렉터리>   예) book, ebook", file=sys.stderr)
        return 2

    book = (ROOT / argv[0]).resolve()
    src = book / "manuscript.md"
    html_out = book / "ebook.html"
    pdf_out = book / "ebook.pdf"

    if not src.exists():
        print(f"원고가 없습니다: {src}", file=sys.stderr)
        return 1

    text = src.read_text(encoding="utf-8")
    meta, text = read_front_matter(text)

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

    title = meta.get("title") or book.name
    cover = (
        COVER.replace("__EYEBROW__", meta.get("eyebrow", ""))
        .replace("__TITLE__", title)
        .replace("__SUBTITLE__", meta.get("subtitle", ""))
    )
    # <title> 은 PDF 메타데이터로 들어가므로 표지의 줄바꿈 태그를 뺀다
    doc_title = title.replace("<br>", " ")

    html_out.write_text(
        "<!doctype html>\n"
        '<html lang="ko"><head><meta charset="utf-8">'
        f"<title>{doc_title}</title>"
        f"<style>{css}</style></head><body>{cover}{body}</body></html>\n",
        encoding="utf-8",
    )
    print(f"HTML 생성: {html_out.relative_to(ROOT)}")

    chrome = find_chromium()
    if not chrome:
        print("크로미움을 못 찾았습니다. HTML 을 브라우저에서 열어 PDF로 인쇄하세요.")
        return 0

    # 크로미움은 실패해도 이전 PDF 를 지우지 않는다. 먼저 지워야 성공 판정이 맞다.
    pdf_out.unlink(missing_ok=True)

    cmd = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--no-pdf-header-footer",
        "--allow-file-access-from-files",
        f"--print-to-pdf={pdf_out}",
        html_out.as_uri(),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if not pdf_out.exists():
        print("PDF 생성 실패:", r.stderr[-800:], file=sys.stderr)
        return 1

    size_kb = pdf_out.stat().st_size / 1024
    print(f"PDF 생성: {pdf_out.relative_to(ROOT)} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
