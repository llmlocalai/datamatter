
# --------------------------------------------------------------- assembly ---
ELEMENTS = [
  (1,  'Financial statement / account', 'account'),
  (2,  'Assertion',                     'assertion'),
  (3,  'Audit risk',                    'risk'),
  (4,  'Control',                       'control'),
  (5,  'Control failure',               'failure'),
  (6,  'Root cause',                    'root_cause'),
  (7,  'Population / exposure',         'exposure'),
  (8,  'Historical audit evidence',     'evidence'),
  (9,  'Remediation',                   'remediation'),
  (10, 'Outcome',                       None),   # computed, never written above
]

# A handful of reported elements cite a document other than the FY2025 auditor's
# report they were read alongside. Named here rather than inline so the citation
# is a fact about the row and not a string buried in prose.
CITE_OVERRIDE = {
  ('elc', 'exposure'): 'DoD FY2025 Agency Financial Report, FMFIA assurance statement; ' + SRC[2025][0],
  ('oversight_dod', 'exposure'): SRC_GAO26[0],
  ('jsf', 'evidence'): SRC[2025][0] + '; DoD OIG report DODIG-2026-061',
}

ROSTER_YEARS = sorted(ROSTER)          # years for which a roster is published
CURRENT_FY = 2025

def fail(msg):
    print('FAIL  ' + msg, file=sys.stderr)
    fail.n += 1
fail.n = 0

# --- checks that run before anything is emitted ------------------------------
# These are not decoration. The FY2018 entity table was dropped because check 1
# caught it 4 short of its own published total, and a set of FY2019 sub-allotted
# rows was discarded because adding them overshot by 56. A transcription that is
# not footed against the source's own total is a guess with a citation on it.
for y in YEARS:
    fy = y['fiscal_year']
    if y['nfrs_new'] is not None and y['nfrs_reissued'] is not None:
        if y['nfrs_new'] + y['nfrs_reissued'] != y['nfrs_issued']:
            fail(f'FY{fy}: new + reissued ({y["nfrs_new"]}+{y["nfrs_reissued"]}) '
                 f'does not equal issued ({y["nfrs_issued"]}).')
    rows = ENTITIES.get(fy)
    if rows:
        s = sum(r[3] for r in rows)
        if s != y['nfrs_issued']:
            fail(f'FY{fy}: entity NFR rows sum to {s}, published total is {y["nfrs_issued"]}. '
                 f'Do not publish this year at entity grain until it foots.')
        mws = [r[1] for r in rows if r[1] is not None]
        if mws and y['mw_total'] is not None and sum(mws) != y['mw_total']:
            fail(f'FY{fy}: entity material weaknesses sum to {sum(mws)}, published total '
                 f'is {y["mw_total"]}.')
        ncs = [r[2] for r in rows if r[2] is not None]
        if ncs and y['noncompliance_total'] is not None and sum(ncs) != y['noncompliance_total']:
            fail(f'FY{fy}: entity non-compliance sums to {sum(ncs)}, published total '
                 f'is {y["noncompliance_total"]}.')
    r = ROSTER.get(fy)
    if r is not None and y['mw_agency_wide'] is not None and len(r) != y['mw_agency_wide']:
        fail(f'FY{fy}: roster holds {len(r)} entries, the report states '
             f'{y["mw_agency_wide"]} Agency-Wide material weaknesses.')
    if r is not None and len({k for k, _ in r}) != len(r):
        fail(f'FY{fy}: roster repeats a canonical key, so persistence would double-count it.')

roster_keys = {k for y in ROSTER for k, _ in ROSTER[y]}
for k in roster_keys:
    if k not in OBSTACLE:
        fail(f'{k}: no obstacle grouping.')
for k in {k for k, _ in ROSTER[CURRENT_FY]}:
    if k not in OBJECT:
        fail(f'{k}: on the FY{CURRENT_FY} roster with no audit-risk object.')
for k in OBJECT:
    if k not in {kk for kk, _ in ROSTER[CURRENT_FY]}:
        fail(f'{k}: has an audit-risk object but is not on the FY{CURRENT_FY} roster.')
    if OBJECT[k]['coverage'] not in ('testable', 'partial', 'absent'):
        fail(f'{k}: coverage "{OBJECT[k]["coverage"]}" is not one of testable/partial/absent.')
    for _, _, field in ELEMENTS:
        if field and field not in OBJECT[k]:
            fail(f'{k}: element field {field} is missing.')

if fail.n:
    print(f'\n{fail.n} check(s) failed. Nothing written.', file=sys.stderr)
    sys.exit(2)

# --- rows --------------------------------------------------------------------
year_rows = [dict(fiscal_year=y['fiscal_year'], opinion=y['opinion'],
                  nfrs_issued=y['nfrs_issued'], nfrs_new=y['nfrs_new'],
                  nfrs_reissued=y['nfrs_reissued'], nfrs_closed=y['nfrs_closed'],
                  mw_total=y['mw_total'], noncompliance_total=y['noncompliance_total'],
                  mw_agency_wide=y['mw_agency_wide'],
                  entity_rows_published=bool(ENTITIES.get(y['fiscal_year'])),
                  roster_published=y['fiscal_year'] in ROSTER,
                  citation=y['citation'], source_url=y['source_url'], note=y['note'])
             for y in YEARS]

entity_rows = []
for fy, rows in sorted(ENTITIES.items()):
    for i, (name, mw, nc, nfr) in enumerate(rows):
        entity_rows.append(dict(fiscal_year=fy, sort_order=(i + 1) * 10, entity=name,
                                mw_count=mw, noncompliance_count=nc, nfr_count=nfr,
                                citation=SRC[fy][0]))

mw_rows = []
for fy in ROSTER_YEARS:
    for i, (key, label) in enumerate(ROSTER[fy]):
        mw_rows.append(dict(fiscal_year=fy, rank_in_report=i + 1, mw_key=key,
                            printed_label=label, obstacle=OBSTACLE[key],
                            citation=ROSTER_CITE[fy]))

# Element 10 is computed here, from the roster rows above, and is the only
# element whose text this file does not contain. An outcome asserted beside the
# roster it is meant to summarise would be a restatement with a verdict on it.
def outcome_for(key):
    present = [fy for fy in ROSTER_YEARS if key in {k for k, _ in ROSTER[fy]}]
    first, last, n = present[0], present[-1], len(present)
    labels = {ROSTER[fy][[k for k, _ in ROSTER[fy]].index(key)][1] for fy in present}
    gap = [fy for fy in ROSTER_YEARS if fy not in present and first < fy < last]
    if last == CURRENT_FY:
        state = 'open'
        txt = (f'Open. On the roster in {n} of the {len(ROSTER_YEARS)} years a roster is '
               f'published, first in FY{first}, and carried into FY{CURRENT_FY}.')
    else:
        state = 'off the current roster'
        txt = (f'Not on the FY{CURRENT_FY} roster. Last published FY{last}, first FY{first}, '
               f'{n} of {len(ROSTER_YEARS)} roster years.')
    if gap:
        txt += (' Absent from the roster in ' + ', '.join(f'FY{g}' for g in gap)
                + ', which is a gap in the roster rather than evidence of a closure and a '
                  'reissue -- FY2023 publishes no roster at all.')
    if len(labels) > 1:
        txt += (' Printed under ' + str(len(labels)) + ' different titles over that period; '
                'the pairing is this site’s, not the Department’s.')
    return state, txt, first, last, n

object_rows, element_rows = [], []
for key, o in OBJECT.items():
    state, otxt, first, last, n = outcome_for(key)
    object_rows.append(dict(
        mw_key=key, label=o['label'], obstacle=OBSTACLE[key],
        first_roster_year=first, last_roster_year=last, roster_years_present=n,
        roster_years_available=len(ROSTER_YEARS), outcome_state=state,
        expected_relationship=o['relationship'], data_required=o['data_required'],
        coverage=o['coverage'], coverage_note=o['coverage_note'],
        sort_order=[k for k, _ in ROSTER[CURRENT_FY]].index(key) + 1))
    for no, name, field in ELEMENTS:
        if field is None:
            element_rows.append(dict(mw_key=key, element_no=no, element_name=name,
                                     element_text=otxt, basis='derived',
                                     citation='Computed from the published rosters, '
                                              + ', '.join(f'FY{y}' for y in ROSTER_YEARS)))
            continue
        text, basis = o[field]
        cite = CITE_OVERRIDE.get((key, field))
        if cite is None:
            cite = SRC[CURRENT_FY][0] if basis == 'reported' \
                   else 'Structured reading of ' + SRC[CURRENT_FY][0]
        element_rows.append(dict(mw_key=key, element_no=no, element_name=name,
                                 element_text=text, basis=basis, citation=cite))

out = dict(
    _note=('Built by scripts/build_nfr_seed.py from named DoD OIG and GAO reports. '
           'Do not hand-edit: edit the script and re-run. Individual NFRs are not '
           'public documents; nothing here is an extracted NFR.'),
    vintage=VINTAGE,
    generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    current_fiscal_year=CURRENT_FY,
    roster_years=ROSTER_YEARS,
    rows=dict(dm_nfr_year=year_rows, dm_nfr_entity=entity_rows, dm_nfr_mw=mw_rows,
              dm_nfr_object=object_rows, dm_nfr_element=element_rows))

path = 'database/seed_nfr.json'
with open(path, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
    f.write('\n')

print(f'wrote {path}')
for t, r in out['rows'].items():
    print(f'  {t:<18} {len(r):>5} rows')
print(f'  checks passed: {len(YEARS)} years, {len(ENTITIES)} entity tables footed, '
      f'{len(ROSTER_YEARS)} rosters, {len(OBJECT)} audit-risk objects x 10 elements')
cov = {}
for o in object_rows:
    cov[o['coverage']] = cov.get(o['coverage'], 0) + 1
print('  coverage against this site’s sources: '
      + ', '.join(f'{v} {k}' for k, v in sorted(cov.items())))
