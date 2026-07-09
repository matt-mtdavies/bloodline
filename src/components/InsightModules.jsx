/*
 * Tree Insights — the Wave-1 visual modules. Each takes the precomputed data
 * from lib/insightModules.js and renders one Bloodline card: icon + serif
 * headline, a drawn comparison (the chart IS the insight), and a caption that
 * says why it matters. A module whose data is null simply isn't rendered —
 * thresholds live in the compute layer, not here.
 *
 * Charts are inline SVG sized by viewBox so they scale with the sheet. Colors
 * are the app's own: terracotta for the living/primary series, the memorial
 * violet for the deceased — the same encoding the tree itself uses.
 */

const ACC = '#c2603a';
const ACC_SOFT = '#f0d9cd';
const MEMORIAL = '#6b5e7a';
const INK = '#241f1c';
const SOFT = '#6b6260';
const FAINT = '#b0a9a5';
const HAIR = '#ece7df';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve'];
const asWord = (n) => (n >= 0 && n <= 12 ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function InsightModules({ modules, onNavigate }) {
  if (!modules) return null;
  const { giftOfYears, fullestYear, strata, brood, names, heartlands, birthdays } = modules;
  const chapters = [
    ['Deep time', [
      giftOfYears && <GiftModule key="gift" data={giftOfYears} />,
      fullestYear && <FullestModule key="fullest" data={fullestYear} />,
    ]],
    ['The shape of us', [
      strata && <StrataModule key="strata" data={strata} />,
      brood && <BroodModule key="brood" data={brood} onNavigate={onNavigate} />,
    ]],
    ['Names', [
      names && <NamesModule key="names" data={names} />,
    ]],
    ['Places', [
      heartlands && <HeartlandsModule key="heart" data={heartlands} />,
    ]],
    ['Seasons', [
      birthdays && <BirthdaysModule key="bday" data={birthdays} onNavigate={onNavigate} />,
    ]],
  ]
    .map(([label, items]) => [label, items.filter(Boolean)])
    .filter(([, items]) => items.length);

  if (!chapters.length) return null;
  return (
    <div className="tim-wrap">
      {chapters.map(([label, items]) => (
        <section key={label} className="tim-chapter">
          <h3 className="tim-chapter__label">{label}</h3>
          {items}
        </section>
      ))}
    </div>
  );
}

function Module({ icon, title, sub, caption, children }) {
  return (
    <div className="tim">
      <div className="tim__top">
        <span className="tim__ico">{icon}</span>
        <div>
          <div className="tim__title">{title}</div>
          {sub && <div className="tim__sub">{sub}</div>}
        </div>
      </div>
      {children && <div className="tim__body">{children}</div>}
      {caption && <p className="tim__caption">{caption}</p>}
    </div>
  );
}

/* ── Deep time ─────────────────────────────────────────────────────────── */

function GiftModule({ data }) {
  const { cohorts, first, last, gained } = data;
  const title = gained >= 5
    ? `The family gained ${gained} years`
    : 'The length of a life, era by era';
  return (
    <Module
      icon={<TrendIcon />}
      title={title}
      sub="Average length of life, by the decade people were born into."
      caption={<>Relatives born in the <b>{first.decade}s</b> lived
        to <b>{first.avg}</b> on average. Those born in
        the <b>{last.decade}s</b>: <b>{last.avg}</b>.</>}
    >
      <GiftChart cohorts={cohorts} />
    </Module>
  );
}

function GiftChart({ cohorts }) {
  const W = 340, H = 170, L = 34, R = 20, T = 26, B = 34;
  const vals = cohorts.map((c) => c.avg);
  const lo = Math.floor((Math.min(...vals) - 6) / 10) * 10;
  const hi = Math.ceil((Math.max(...vals) + 6) / 10) * 10;
  const x = (i) => L + (cohorts.length === 1 ? 0.5 : i / (cohorts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const grid = [];
  for (let v = lo; v <= hi; v += Math.ceil((hi - lo) / 3 / 10) * 10 || 10) grid.push(v);
  const pts = cohorts.map((c, i) => `${x(i)},${y(c.avg)}`).join(' ');
  const everyOther = cohorts.length > 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Average lifespan by birth decade, from ${cohorts[0].avg} years for the ${cohorts[0].decade}s to ${cohorts[cohorts.length - 1].avg} for the ${cohorts[cohorts.length - 1].decade}s`}>
      {grid.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={HAIR} strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3.5} fontSize="10" fill={FAINT} textAnchor="end">{v}</text>
        </g>
      ))}
      <polyline points={pts} fill="none" stroke={ACC} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {cohorts.map((c, i) => {
        const end = i === 0 || i === cohorts.length - 1;
        return (
          <g key={c.decade}>
            <circle cx={x(i)} cy={y(c.avg)} r="4.5" fill={ACC} stroke="#fff" strokeWidth="2" />
            {(!everyOther || i % 2 === 0 || end) && (
              <text x={x(i)} y={H - 12} fontSize="10" fill={FAINT} textAnchor="middle">{c.decade}s</text>
            )}
            {end && (
              <text x={x(i)} y={y(c.avg) - 11} fontSize="12" fontWeight="700" fill={INK}
                textAnchor={i === 0 ? 'start' : 'end'}>{c.avg} yrs</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function FullestModule({ data }) {
  const { peak, isNow, firstYear, firstCount } = data;
  return (
    <Module
      icon={<PeopleIcon />}
      title={isNow ? 'Your family has never been bigger' : `${peak.year} was the family's fullest year`}
      sub={`How many relatives were alive, year by year since ${firstYear}.`}
      caption={isNow
        ? <>From <b>{firstCount || 'a handful of'} {firstCount === 1 ? 'person' : 'people'}</b> in {firstYear} to <b>{peak.count} alive right now</b> — today is the fullest the family has ever been.</>
        : <><b>{peak.count} relatives were alive at once in {peak.year}</b> — the fullest the family has ever been.</>}
    >
      <AliveChart data={data} />
    </Module>
  );
}

function AliveChart({ data }) {
  const { series, peak, isNow, thisYear } = data;
  const W = 340, H = 170, L = 34, R = 30, T = 22, B = 34;
  const minYear = series[0].year;
  const maxCount = Math.max(...series.map((s) => s.count));
  const yMax = Math.max(10, Math.ceil(maxCount / 50) * 50);
  const x = (yr) => L + (yr - minYear) / (thisYear - minYear) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const line = series.map((s) => `${x(s.year)},${y(s.count)}`).join(' ');
  const mid = Math.round((minYear + thisYear) / 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Living relatives per year, peaking at ${peak.count} in ${isNow ? 'the present day' : peak.year}`}>
      {[0, yMax / 2, yMax].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={HAIR} strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3.5} fontSize="10" fill={FAINT} textAnchor="end">{v}</text>
        </g>
      ))}
      <polygon points={`${x(minYear)},${y(0)} ${line} ${x(thisYear)},${y(0)}`} fill={ACC} opacity="0.1" />
      <polyline points={line} fill="none" stroke={ACC} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(peak.year)} cy={y(peak.count)} r="5" fill={ACC} stroke="#fff" strokeWidth="2" />
      <text x={x(peak.year) - 8} y={y(peak.count) - 10} fontSize="12" fontWeight="700" fill={INK} textAnchor="end">
        {peak.count}{isNow ? ' alive today' : ` in ${peak.year}`}
      </text>
      <text x={x(minYear)} y={H - 12} fontSize="10" fill={FAINT} textAnchor="start">{minYear}</text>
      <text x={x(mid)} y={H - 12} fontSize="10" fill={FAINT} textAnchor="middle">{mid}</text>
      <text x={x(thisYear)} y={H - 12} fontSize="10" fill={FAINT} textAnchor="end">Today</text>
    </svg>
  );
}

/* ── The shape of us ───────────────────────────────────────────────────── */

function StrataModule({ data }) {
  const { rows, widest, viewerLabel, viewerIsWidest, living, remembered } = data;
  const max = widest.total;
  return (
    <Module
      icon={<LayersIcon />}
      title={`${cap(asWord(rows.length))} generations, stacked`}
      sub="Everyone in the tree, oldest generation at the top."
      caption={viewerIsWidest
        ? <>Your generation, <b>{viewerLabel}, is the widest the family has ever been</b> — {widest.total} people across it.</>
        : <><b>{widest.label} is the widest generation</b> — {widest.total} people across it{viewerLabel ? <>; you sit in {viewerLabel}</> : null}.</>}
    >
      <div className="tim-strata">
        {rows.map((r) => (
          <div className="tim-strata__row" key={r.gen}>
            <span className="tim-strata__g">{r.label}</span>
            <div className="tim-strata__track">
              {r.remembered > 0 && (
                <span className="tim-strata__seg tim-strata__seg--rem" style={{ width: `${(r.remembered / max) * 100}%` }} />
              )}
              {r.living > 0 && (
                <span className="tim-strata__seg tim-strata__seg--liv" style={{ width: `${(r.living / max) * 100}%` }} />
              )}
            </div>
            <span className="tim-strata__n">{r.total}</span>
          </div>
        ))}
      </div>
      <div className="tim-legend">
        <span><i style={{ background: ACC }} />Living · {living}</span>
        <span><i style={{ background: MEMORIAL }} />Remembered · {remembered}</span>
      </div>
    </Module>
  );
}

function BroodModule({ data, onNavigate }) {
  const { record, trend } = data;
  const title = record
    ? `${record.parentNames.join(' & ')} raised ${asWord(record.count)}`
    : 'How full the households were';
  const first = trend && trend[0];
  const last = trend && trend[trend.length - 1];
  return (
    <Module
      icon={<FamilyIcon />}
      title={title}
      sub={record
        ? `The fullest household in the tree${record.span ? `, ${record.span}` : ''}.`
        : 'Average children per household, over time.'}
      caption={trend
        ? <>Households begun in the <b>{first.label}</b> averaged <b>{first.avg} children</b>. Those begun in the <b>{last.label}</b>: <b>{last.avg}</b>.</>
        : null}
    >
      {record && (
        <button
          className="tim-picto"
          onClick={() => onNavigate?.(record.parentIds[0])}
          aria-label={`${record.count} children — open ${record.parentNames.join(' and ')}`}
        >
          {Array.from({ length: record.count }, (_, i) => <KidGlyph key={i} />)}
        </button>
      )}
      {trend && <BroodChart trend={trend} />}
    </Module>
  );
}

function BroodChart({ trend }) {
  const W = 340, H = 130, L = 16, R = 16, T = 20, B = 28;
  const slot = (W - L - R) / trend.length;
  const bw = Math.min(22, slot * 0.6);
  const maxAvg = Math.max(...trend.map((t) => t.avg));
  const y = (v) => T + (1 - v / (maxAvg + 1)) * (H - T - B);
  const everyOther = trend.length > 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Average children per household, from ${trend[0].avg} (${trend[0].label}) to ${trend[trend.length - 1].avg} (${trend[trend.length - 1].label})`}>
      {trend.map((t, i) => {
        const cx = L + slot * i + slot / 2;
        const top = y(t.avg), bot = H - B;
        const end = i === 0 || i === trend.length - 1;
        return (
          <g key={t.start}>
            <path
              d={`M${cx - bw / 2},${bot} L${cx - bw / 2},${top + 4} Q${cx - bw / 2},${top} ${cx - bw / 2 + 4},${top} L${cx + bw / 2 - 4},${top} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + 4} L${cx + bw / 2},${bot} Z`}
              fill={end ? ACC : ACC_SOFT}
            />
            {(!everyOther || end || (i % 2 === 0 && i < trend.length - 2)) && (
              <text x={cx} y={H - 10} fontSize="10" fill={FAINT} textAnchor="middle">{t.label}</text>
            )}
            {end && <text x={cx} y={top - 7} fontSize="12" fontWeight="700" fill={INK} textAnchor="middle">{t.avg}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function KidGlyph() {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
      <circle cx="9" cy="5" r="3.4" fill="currentColor" />
      <path d="M9 9.5c-3.6 0-5.5 2.6-5.5 6h11c0-3.4-1.9-6-5.5-6z" fill="currentColor" />
    </svg>
  );
}

/* ── Names ─────────────────────────────────────────────────────────────── */

function NamesModule({ data }) {
  const { top, thread } = data;
  const max = top[0].count;
  const plural = /(?:s|x|z|ch|sh)$/i.test(top[0].name) ? 'es' : 's';
  return (
    <Module
      icon={<TypeIcon />}
      title={`${cap(asWord(top[0].count))} ${top[0].name}${plural} and counting`}
      sub="The names your family keeps coming back to."
      caption={<><b>{thread.name} has appeared in {thread.present} of
        your {thread.generations.length} generations</b>{thread.first != null
        ? <> — first in {thread.first}{thread.last !== thread.first ? <>, most recently in {thread.last}</> : null}</>
        : null}.</>}
    >
      <div className="tim-names">
        {top.map((n) => (
          <div className="tim-names__row" key={n.name}>
            <span className="tim-names__name">{n.name}</span>
            <div className="tim-names__track">
              <div className="tim-names__fill" style={{ width: `${(n.count / max) * 100}%` }} />
            </div>
            <span className="tim-names__count">{n.count}</span>
          </div>
        ))}
      </div>
      <div className="tim-thread" aria-label={`${thread.name} appears in ${thread.present} of ${thread.generations.length} generations`}>
        {thread.generations.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}
      </div>
    </Module>
  );
}

/* ── Places ────────────────────────────────────────────────────────────── */

function HeartlandsModule({ data }) {
  const { places, migration } = data;
  const max = places[0].count;
  return (
    <Module
      icon={<PinIcon />}
      title={`${places[0].display} is your heartland`}
      sub="Where the family was born, and how far it has walked."
      caption={migration
        ? <>The family's birthplace has moved <b>{asWord(migration.length - 1)} time{migration.length === 2 ? '' : 's'}</b> across the generations.</>
        : null}
    >
      <div className="tim-names">
        {places.map((p) => (
          <div className="tim-names__row" key={p.display}>
            <span className="tim-names__name tim-names__name--place">{p.display}</span>
            <div className="tim-names__track">
              <div className="tim-names__fill" style={{ width: `${(p.count / max) * 100}%` }} />
            </div>
            <span className="tim-names__count">{p.count}</span>
          </div>
        ))}
      </div>
      {migration && (
        <div className="tim-mig" aria-label="Migration path across the generations">
          {migration.map((s, i) => (
            <span className="tim-mig__step" key={`${s.display}-${i}`}>
              {i > 0 && <ArrowIcon />}
              <b>{s.display}</b>
              {s.era && <em>{s.era}</em>}
            </span>
          ))}
        </div>
      )}
    </Module>
  );
}

/* ── Seasons ───────────────────────────────────────────────────────────── */

function BirthdaysModule({ data, onNavigate }) {
  const { peakLabel, peakCount, twins } = data;
  const twin = twins[0];
  return (
    <Module
      icon={<WheelIcon />}
      title={`${peakLabel} is birthday season`}
      sub="Every family birthday, arranged around the year."
      caption={<>
        <b>{peakCount} birthdays in {peakLabel}</b>
        {twin && <> — and birthday twins: {twinName(twin, 'a', onNavigate)} and {twinName(twin, 'b', onNavigate)}, both {twin.dateLabel}.</>}
        {!twin && '.'}
      </>}
    >
      <div className="tim-wheel"><BirthdayWheel data={data} /></div>
    </Module>
  );
}

function twinName(twin, side, onNavigate) {
  const id = twin[`${side}Id`], name = twin[`${side}Name`];
  return (
    <button className="tim-linky" onClick={() => onNavigate?.(id)}>{name}</button>
  );
}

function BirthdayWheel({ data }) {
  const { months, peakMonth, peakCount, peakLabel } = data;
  const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const cx = 150, cy = 122, r0 = 34, rMax = 88;
  const petals = months.map((n, i) => {
    const a0 = (i / 12) * Math.PI * 2 - Math.PI / 2 + 0.045;
    const a1 = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2 - 0.045;
    const r = r0 + (peakCount ? (n / peakCount) : 0) * (rMax - r0);
    const p = (a, rad) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
    const [x0, y0] = p(a0, r0), [x1, y1] = p(a1, r0), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    const [lx, ly] = p((a0 + a1) / 2, rMax + 13);
    return { i, n, d: `M${x0},${y0} A${r0},${r0} 0 0 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 0 0 ${x3},${y3} Z`, lx, ly };
  });
  return (
    <svg viewBox="0 0 300 240" width="86%" role="img"
      aria-label={`Birthdays per month arranged in a ring, ${peakLabel} the largest with ${peakCount}`}>
      {petals.map((pt) => (
        <g key={pt.i}>
          <path d={pt.d} fill={pt.i === peakMonth ? ACC : ACC_SOFT} />
          <text x={pt.lx} y={pt.ly + 3.5} fontSize="10.5" textAnchor="middle"
            fill={pt.i === peakMonth ? INK : FAINT} fontWeight={pt.i === peakMonth ? 700 : 400}>
            {LETTERS[pt.i]}
          </text>
        </g>
      ))}
      <text x={cx} y={cy - 2} fontSize="26" fontWeight="700" fill={INK} textAnchor="middle"
        style={{ fontFamily: "var(--display, Georgia, serif)" }}>{peakCount}</text>
      <text x={cx} y={cy + 15} fontSize="10.5" fill={SOFT} textAnchor="middle">in {peakLabel}</text>
    </svg>
  );
}

/* ── Icons (same 18px outline family as the fact cards) ────────────────── */
const ip = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
function TrendIcon() {
  return (<svg {...ip}><path d="M4 17l5-5 4 3 7-8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M16 7h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function PeopleIcon() {
  return (<svg {...ip}><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.8M20.5 19a5.5 5.5 0 00-4-5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>);
}
function LayersIcon() {
  return (<svg {...ip}><path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M3 13l9 5 9-5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>);
}
function FamilyIcon() {
  return (<svg {...ip}><circle cx="12" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.6" /><circle cx="5.5" cy="9" r="2" stroke="currentColor" strokeWidth="1.6" /><circle cx="18.5" cy="9" r="2" stroke="currentColor" strokeWidth="1.6" /><path d="M8.5 19a3.5 3.5 0 017 0M2.5 17.5a3 3 0 015-2M21.5 17.5a3 3 0 00-5-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>);
}
function TypeIcon() {
  return (<svg {...ip}><path d="M6 4h12M12 4v16m-4 0h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>);
}
function PinIcon() {
  return (<svg {...ip}><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.7" /></svg>);
}
function WheelIcon() {
  return (<svg {...ip}><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" /><path d="M12 12l4-2.5M12 12V7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>);
}
function ArrowIcon() {
  return (<svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M1 5h11m-4-3.5L12 5l-4 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
