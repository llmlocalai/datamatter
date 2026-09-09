'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

/**
 * The roster's search box, programme picker and column filters.
 *
 * Everything here writes to the query string and nothing here holds data. That
 * is deliberate: the sort and the filters run in Postgres over every budget line
 * rather than over the sixty on the screen, so ordering by newest request really
 * does show the largest line in the roster and not the largest line on page one
 * -- and any view a reader arrives at is a link they can send.
 */

export interface PickerSystem {
  category: string | null;
  programName: string;
  aliases: string | null;
  lines: number;
}

export interface FacetOption { key: string; label?: string; lines: number }

const SELECT =
  'px-3 py-2 rounded-lg bg-navy-800 border border-navy-700 text-sm text-navy-100 ' +
  'focus:outline-none focus:ring-2 focus:ring-accent-500 max-w-full';

export default function RosterControls({
  systems, fundTypes, appropriations, weaponCategories, bsaTitles, components,
}: {
  systems: PickerSystem[];
  fundTypes: FacetOption[];
  appropriations: FacetOption[];
  weaponCategories: FacetOption[];
  bsaTitles: FacetOption[];
  components: FacetOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  const push = useCallback((over: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(over)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    next.delete('page');          // a new filter starts at the first page
    next.delete('bli');
    const s = next.toString();
    router.push(s ? `/program?${s}` : '/program', { scroll: false });
  }, [params, router]);

  const grouped = useMemo(() => {
    const by = new Map<string, PickerSystem[]>();
    for (const s of systems) {
      const k = s.category || 'Not categorised in the book';
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(s);
    }
    return Array.from(by.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [systems]);

  const val = (k: string) => params.get(k) ?? '';

  const Filter = ({ name, label, options }: {
    name: string; label: string; options: FacetOption[];
  }) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] uppercase tracking-wider text-navy-500">{label}</span>
      <select className={SELECT} value={val(name)} aria-label={label}
              onChange={(e) => push({ [name]: e.target.value })}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {(o.label ?? o.key)} &middot; {o.lines.toLocaleString()}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-5">
      <form className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); push({ q, system: '' }); }}>
        <label className="flex flex-col gap-1 flex-1 min-w-[18rem]">
          <span className="text-[11px] uppercase tracking-wider text-navy-500">
            Search the roster
          </span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="f35, JSF, F-35, black hawk, DDG, 1506N, 017-1506…"
            aria-label="Search budget lines"
            className="px-3 py-2 rounded-lg bg-navy-800 border border-navy-700 text-sm text-navy-100 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-accent-500" />
        </label>
        <button type="submit"
          className="px-4 py-2 rounded-lg bg-accent-500 text-navy-950 text-sm font-semibold hover:bg-accent-400 transition-colors">
          Search
        </button>

        <label className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-none sm:w-96">
          <span className="text-[11px] uppercase tracking-wider text-navy-500">
            Or open a weapon system
          </span>
          <select className={SELECT} value={val('system')} aria-label="Weapon system"
                  onChange={(e) => push({ system: e.target.value, q: '' })}>
            <option value="">
              {systems.length} systems the weapons book names
            </option>
            {grouped.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>
                {list.map((s) => (
                  <option key={s.programName} value={s.programName}>
                    {s.programName}
                    {s.aliases ? ` (${s.aliases})` : ''}
                    {s.lines ? ` · ${s.lines} line${s.lines === 1 ? '' : 's'}`
                             : ' · no budget line tied'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Filter name="fund" label="Fund type" options={fundTypes} />
        <Filter name="org" label="Service or agency" options={components} />
        <Filter name="approp" label="Appropriation" options={appropriations} />
        <Filter name="cat" label="Category · weapons book" options={weaponCategories} />
        <Filter name="bsa" label="Category · J-book sub-activity" options={bsaTitles} />
      </div>
    </div>
  );
}
