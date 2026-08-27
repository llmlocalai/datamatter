import Link from 'next/link';

/** Fiscal-year selector as links, so the page stays a server component. */
export function FyPicker({ years, active, base, partial }: {
  years: number[]; active: number; base: string; partial?: number[];
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {years.map((y) => {
        const isPartial = partial?.includes(y);
        return (
          <Link key={y} href={`${base}?fy=${y}`} scroll={false}
            aria-current={y === active ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors tnum ${
              y === active ? 'bg-accent-500 text-navy-950'
                           : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
            FY{y}{isPartial ? ' *' : ''}
          </Link>
        );
      })}
      {partial?.length ? (
        <span className="text-[11px] text-navy-500 ml-1">* in progress</span>
      ) : null}
    </div>
  );
}
