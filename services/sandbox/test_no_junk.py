#!/usr/bin/env python3
"""Verify every output format returns EXACTLY the intended file(s) — no stray
tool artifacts (e.g. matplotlib's fontlist-vNNN.json font cache)."""
import json, os, sys, urllib.request

URL = os.environ.get("SANDBOX_URL", "http://localhost:8002")

def run(code, lang="python"):
    body = json.dumps({"code": code, "language": lang, "timeout_s": 40}).encode()
    req = urllib.request.Request(f"{URL}/exec", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())

CASES = [
    ("png chart (matplotlib)", "import matplotlib.pyplot as plt\nplt.plot([1,2,3],[3,1,2]); plt.title('t'); plt.savefig('chart.png')", {"chart.png"}),
    ("png + second plot", "import matplotlib.pyplot as plt\nfor n in ['a','b']:\n    plt.figure(); plt.plot([1,2]); plt.savefig(n+'.png')", {"a.png","b.png"}),
    ("xlsx (pandas)", "import pandas as pd\npd.DataFrame({'x':[1,2]}).to_excel('out.xlsx', index=False)", {"out.xlsx"}),
    ("xlsx + chart together", "import pandas as pd, matplotlib.pyplot as plt\npd.DataFrame({'x':[1,2]}).to_excel('d.xlsx', index=False)\nplt.plot([1,2]); plt.savefig('p.png')", {"d.xlsx","p.png"}),
    ("csv", "open('data.csv','w').write('a,b\\n1,2\\n')", {"data.csv"}),
    ("docx", "from docx import Document\nd=Document(); d.add_paragraph('hi'); d.save('r.docx')", {"r.docx"}),
    ("pdf (reportlab)", "from reportlab.pdfgen import canvas\nc=canvas.Canvas('o.pdf'); c.drawString(72,800,'x'); c.save()", {"o.pdf"}),
    ("pdf with chart.png alongside", "import matplotlib.pyplot as plt\nfrom reportlab.pdfgen import canvas\nplt.plot([1,2]); plt.savefig('chart.png')\nc=canvas.Canvas('report.pdf'); c.drawImage('chart.png',72,500,200,150); c.save()", {"chart.png","report.pdf"}),
    ("pptx", "from pptx import Presentation\np=Presentation(); p.save('d.pptx')", {"d.pptx"}),
    ("json", "import json; json.dump({'a':1}, open('o.json','w'))", {"o.json"}),
    ("html", "open('page.html','w').write('<h1>hi</h1>')", {"page.html"}),
    ("txt", "open('notes.txt','w').write('hello')", {"notes.txt"}),
    ("no files", "print('nothing produced')", set()),
    ("node json", "const fs=require('fs'); fs.writeFileSync('n.json', JSON.stringify({ok:1}))", {"n.json"}),
]

def main():
    passed = fail = 0
    for name, code, expected in CASES:
        lang = "node" if name.startswith("node") else "python"
        try:
            res = run(code, lang)
        except Exception as e:
            print(f"  [FAIL] {name}: request error {e}"); fail += 1; continue
        got = {f["name"] for f in res.get("files", [])}
        ok = res.get("ok") and got == expected
        extra = got - expected
        missing = expected - got
        tag = "PASS" if ok else "FAIL"
        detail = f"files={sorted(got) or '—'}"
        if extra: detail += f"  EXTRA={sorted(extra)}"
        if missing: detail += f"  MISSING={sorted(missing)}"
        print(f"  [{tag}] {name:26} {detail}")
        passed += ok; fail += (not ok)
    print(f"\n{passed}/{passed+fail} passed — {'ALL PASS' if fail==0 else str(fail)+' FAILED'}")
    sys.exit(0 if fail == 0 else 1)

if __name__ == "__main__":
    main()
