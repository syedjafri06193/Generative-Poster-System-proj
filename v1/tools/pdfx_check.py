#!/usr/bin/env python3
"""Structural PDF/X-4 checks (ISO 15930-7) for files written by this project.

    python3 tools/pdfx_check.py poster.pdf [more.pdf ...]

Independent of the TypeScript writer: it reads the file back with pikepdf
(qpdf) and checks the requirements a prepress tool flags. Exit status 0 when
every file passes. This is not a certified validator — it covers the rules
this writer can get wrong, including the transparency-group colour space
(design guide §11.4) that colour-only checks miss.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pikepdf

COLOR_OPS_RGB = {"rg", "RG"}
ALLOWED_CS = {"/DeviceCMYK", "/DeviceGray", "/Separation", "/DeviceN"}


def rect(a) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = (float(v) for v in a)
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def inside(inner, outer, tol=1e-3) -> bool:
    return inner[0] >= outer[0] - tol and inner[1] >= outer[1] - tol and inner[2] <= outer[2] + tol and inner[3] <= outer[3] + tol


def check(path: Path) -> list[str]:
    errors: list[str] = []
    raw = path.read_bytes()
    m = re.match(rb"%PDF-(\d\.\d)", raw)
    if not m:
        return ["not a PDF file"]
    if float(m.group(1)) > 1.6:
        errors.append(f"PDF version {m.group(1).decode()} is newer than 1.6")

    with pikepdf.open(path) as pdf:
        if pdf.is_encrypted or "/Encrypt" in pdf.trailer:
            errors.append("file is encrypted")
        root = pdf.Root
        if "/AA" in root or ("/Names" in root and "/JavaScript" in root.Names):
            errors.append("document-level actions or JavaScript present")

        # Output intent
        intents = [oi for oi in root.get("/OutputIntents", []) if oi.get("/S") == "/GTS_PDFX"]
        if len(intents) != 1:
            errors.append(f"expected exactly one /GTS_PDFX output intent, found {len(intents)}")
        else:
            oi = intents[0]
            if "/OutputConditionIdentifier" not in oi:
                errors.append("output intent has no /OutputConditionIdentifier")
            prof = oi.get("/DestOutputProfile")
            if prof is None:
                errors.append("output intent has no embedded /DestOutputProfile")
            else:
                icc = prof.read_bytes()
                if icc[16:20] != b"CMYK":
                    errors.append(f"output profile colour space is {icc[16:20]!r}, expected CMYK")
                if icc[12:16] != b"prtr":
                    errors.append(f"output profile class is {icc[12:16]!r}, expected 'prtr' (output device)")
                if int(prof.get("/N", 0)) != 4:
                    errors.append("output profile /N is not 4")

        # Info dictionary
        info = pdf.trailer.get("/Info")
        if info is None:
            errors.append("no Info dictionary")
        else:
            if not str(info.get("/GTS_PDFXVersion", "")).startswith("PDF/X-4"):
                errors.append("Info /GTS_PDFXVersion is not PDF/X-4")
            if info.get("/Trapped") not in (pikepdf.Name("/True"), pikepdf.Name("/False")):
                errors.append("Info /Trapped must be /True or /False")
            for k in ("/CreationDate", "/ModDate", "/Title"):
                if k not in info:
                    errors.append(f"Info has no {k}")

        # XMP
        if "/Metadata" not in root:
            errors.append("no XMP metadata stream")
        else:
            xmp = root.Metadata.read_bytes().decode("utf-8")
            def tag(name):
                mm = re.search(rf"<{name}>(.*?)</{name}>", xmp, re.S)
                return mm.group(1).strip() if mm else None
            if tag("pdfxid:GTS_PDFXVersion") != "PDF/X-4":
                errors.append("XMP pdfxid:GTS_PDFXVersion is not PDF/X-4")
            for t in ("xmpMM:VersionID", "xmpMM:RenditionClass", "xmpMM:DocumentID", "xmp:CreateDate", "xmp:ModifyDate"):
                if not tag(t):
                    errors.append(f"XMP has no {t}")
            title = re.search(r'<rdf:li xml:lang="x-default">(.*?)</rdf:li>', xmp)
            if info is not None and title and str(info.get("/Title")) != title.group(1):
                errors.append("XMP dc:title does not match Info /Title")
            if tag("pdf:Trapped") not in ("True", "False"):
                errors.append("XMP pdf:Trapped missing")

        # Pages
        for i, page in enumerate(pdf.pages, 1):
            obj = page.obj
            if "/TrimBox" not in obj and "/ArtBox" not in obj:
                errors.append(f"page {i}: no TrimBox")
                continue
            media = rect(obj.MediaBox)
            bleed = rect(obj.get("/BleedBox", obj.MediaBox))
            trim = rect(obj.TrimBox)
            if not inside(bleed, media):
                errors.append(f"page {i}: BleedBox is not inside MediaBox")
            if not inside(trim, bleed):
                errors.append(f"page {i}: TrimBox is not inside BleedBox")
            group = obj.get("/Group")
            if group is not None and group.get("/S") == "/Transparency" and group.get("/CS") != pikepdf.Name("/DeviceCMYK"):
                errors.append(f"page {i}: transparency group colour space is {group.get('/CS')}, must be DeviceCMYK for a CMYK output intent (§11.4)")
            res = obj.get("/Resources", pikepdf.Dictionary())
            for name, xo in res.get("/XObject", {}).items():
                if "/OPI" in xo:
                    errors.append(f"page {i}: XObject {name} uses OPI")
                g = xo.get("/Group")
                if g is not None and g.get("/S") == "/Transparency" and g.get("/CS") != pikepdf.Name("/DeviceCMYK"):
                    errors.append(f"page {i}: Form XObject {name} transparency group is not DeviceCMYK")
            for name, font in res.get("/Font", {}).items():
                fd = font.get("/FontDescriptor")
                if fd is None or not any(k in fd for k in ("/FontFile", "/FontFile2", "/FontFile3")):
                    errors.append(f"page {i}: font {name} is not embedded")
            for operands, operator in pikepdf.parse_content_stream(page):
                op = str(operator)
                if op in COLOR_OPS_RGB:
                    errors.append(f"page {i}: DeviceRGB colour operator {op}")
                    break
                if op in ("cs", "CS") and str(operands[0]) not in ALLOWED_CS:
                    errors.append(f"page {i}: colour space {operands[0]} is not CMYK/Gray/Separation")
                    break
    return errors


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    report = {p: check(Path(p)) for p in argv}
    print(json.dumps(report, indent=2))
    return 1 if any(report.values()) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
