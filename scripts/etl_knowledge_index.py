#!/usr/bin/env python3
"""
ETL: Regulatory Q&A knowledge index (retrieval for the web app)
==============================================================

Builds a lexical retrieval index (BM25) over the curated DoD-FM knowledge wiki
and re-ranks results by *source authority* — mirroring the spirit of
knowledge-bank/source_authority.json (primary regulation/statute outranks
secondary summaries and trade press).

Why this and not the ChromaDB vector index:
  The 1.86M-embedding ChromaDB index powers the *local* Open WebUI agent, where
  a GPU/CPU embedder is available. A Vercel serverless function has no embedder
  and cannot load 1.8M vectors per request. For regulatory lookups — which are
  dominated by exact statutory/technical terms (Antideficiency Act, FIAR Wave 3,
  A-123, U.S. Code 31) — precise lexical matching with an authority re-rank is
  both serverless-safe and often more accurate than semantic similarity.

Output: app/api/data/knowledge_index.json
  {
    "docs": [ {id, page, title, section, text, authority} , ... ],
    "idf":  { term: idf_value },
    "params": {k1, b}
  }
"""
from __future__ import annotations

import json
import math
import os
import re

WIKI = "/Volumes/AI_DATA/knowledge-bank/Wiki/DOD-FM"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "app", "api", "data")

# Authority boost: pages whose title references a primary authority get a higher
# base score, so FMR / OMB / GAO / statute / antideficiency / FIAR material ranks
# above generic operational pages. (Reflects source_authority.json tiering.)
AUTH_KEYWORDS = {
    1.35: ["FMR", "Financial Management Regulation", "OMB", "Circular", "U.S. Code",
           "US Code", "Appropriation", "NDAA", "Antideficiency", "Apportionment",
           "Statute", "Enactment"],
    1.20: ["GAO", "FIAR", "Audit", "Comptroller", "Treasury", "USSGL", "Budgetary",
           "Working Capital", "Disbursing"],
}
DEFAULT_AUTH = 1.0

TOKEN_RE = re.compile(r"[a-z0-9]+")
STOP = set(
    "a an the of and or to in on for is are was were be been being with as by at from "
    "that this these those it its into over under than then when which who whom whose "
    "do does did done have has had will would can could should may might must not no "
    "we our you your they them their he she his her i my me up out about after before "
    "if so than too very also just more most less many much each other all any some".split()
)


def authority_for(title: str, text: str) -> float:
    hay = (title + " " + text[:400]).upper()
    best = DEFAULT_AUTH
    for score, kws in AUTH_KEYWORDS.items():
        if any(kw.upper() in hay for kw in kws):
            best = max(best, score)
    return best


def chunk_page(path: str):
    """Split a wiki page into titled, section-anchored chunks."""
    with open(path, encoding="utf-8", errors="ignore") as f:
        body = f.read()
    title = os.path.splitext(os.path.basename(path))[0].replace("-", " ").strip()

    # Capture the source line from the wiki-meta comment for citation.
    m = re.search(r"wiki-meta:\s*sources=\[([^\]]+)\]", body)
    source = m.group(1).strip() if m else ""
    # Drop the leading H1 (it duplicates `title`) and all HTML comments so the
    # first real content chunk is a substantive definition, not a header.
    body = re.sub(r"^#\s+.*\n", "", body, count=1)
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.DOTALL)


    # Split into sections on '## ' / '### ' / bold **Lead-in:** blocks.
    raw_sections = re.split(r"\n(?=#{2,3}\s|\*\*)", body)
    chunks = []
    cid = 0
    for sec in raw_sections:
        sec = sec.strip()
        if len(sec) < 50:
            continue
        # trim the leading '## Title' to a short section label
        first_line = sec.splitlines()[0].strip().lstrip("#").strip()
        section = first_line[:60] if first_line else ""
        text = " ".join(sec.split())  # normalize whitespace
        # Demote pure cross-link / meta chunks (e.g. a "Related: [[...]]" or a
        # bare section header) — they rank on shared titles but answer nothing.
        no_links = re.sub(r"\[\[([^\]]+)\]\]", " ", text)
        # Strip markdown emphasis, then test for a pure cross-reference /
        # navigation label ("**Related:**", "Authoritative sources:"). Substantive
        # sections (One-line definition, Key rules, Why it matters) stay full-authority.
        plain = re.sub(r"[\*#]", "", text).strip()
        is_meta = bool(
            re.match(r"^(Related|Authoritative sources|Last verified)\s*:", plain)
            and len(no_links.strip()) < 120
        )
        auth = 0.3 if is_meta else authority_for(title, text)
        chunks.append(
             {
              "id": f"{title}::{cid}",
              "page": title,
              "title": title,
              "section": section or title,
              "text": text[:1600],
              "source": source,
              "authority": auth,
             }
        )
        cid += 1
    return chunks


def main():
    docs = []
    files = sorted(f for f in os.listdir(WIKI) if f.endswith(".md"))
    print(f"indexing {len(files)} wiki pages from {WIKI}", flush=True)
    for fn in files:
        docs.extend(chunk_page(os.path.join(WIKI, fn)))

    # Tokenize + compute document frequency for IDF.
    doc_tokens = []
    df = {}
    N = len(docs)
    for d in docs:
        toks = [t for t in TOKEN_RE.findall(d["text"].lower()) if t not in STOP and len(t) > 1]
        d["_tokens"] = toks
        doc_tokens.append(toks)
        for t in set(toks):
            df[t] = df.get(t, 0) + 1

    idf = {t: math.log(1 + (N - n + 0.5) / (n + 0.5)) for t, n in df.items()}

    # Strip the transient _tokens; keep a compact per-doc term freq for scoring.
    out_docs = []
    for i, d in enumerate(docs):
        tf = {}
        for t in doc_tokens[i]:
            tf[t] = tf.get(t, 0) + 1
        out_docs.append(
            {
             "id": d["id"],
              "page": d["page"],
              "title": d["title"],
              "section": d["section"],
              "text": d["text"],
              "source": d["source"],
              "authority": round(d["authority"], 2),
              "len": len(doc_tokens[i]),
              "tf": tf,
            }
        )

    # Global avg length for BM25 length normalization.
    avg_len = sum(d["len"] for d in out_docs) / max(1, len(out_docs))

    os.makedirs(OUT_DIR, exist_ok=True)
    out = {
         "source": "DoD-FM knowledge wiki (curated, authority-tagged)",
         "corpus": "knowledge-bank/Wiki/DOD-FM",
         "doc_count": len(out_docs),
         "term_count": len(idf),
         "avg_doc_len": round(avg_len, 2),
         "params": {"k1": 1.5, "b": 0.75},
         "idf": idf,
         "docs": out_docs,
     }
    path = os.path.join(OUT_DIR, "knowledge_index.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"\nWROTE {path}")
    print(f"   {len(out_docs)} chunks, {len(idf)} terms, avg len {avg_len:.1f}")


if __name__ == "__main__":
    main()
