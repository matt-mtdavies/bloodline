import { useRef, useState, useMemo } from 'react';
import { toBlob } from 'html-to-image';
import Avatar from './Avatar.jsx';
import { lifespan } from '../lib/dates.js';
import { aliveInYear, handshakesTo } from '../lib/insightModules.js';

/*
 * Tree Insights — the Wave-1/2 visual modules. Each takes the precomputed data
 * from lib/insightModules.js and renders one Bloodline card: icon + serif
 * headline, a drawn comparison (the chart IS the insight), and a caption that
 * says why it matters. A module whose data is null simply isn't rendered —
 * thresholds live in the compute layer, not here.
 *
 * Charts are inline SVG sized by viewBox so they scale with the sheet. Colors
 * are the app's own: terracotta for the living/primary series, the memorial
 * violet for the deceased — the same encoding the tree itself uses.
 *
 * Every card is also a shareable image (see Module's share button) — rendered
 * straight from the live DOM via html-to-image, nothing bespoke per chart.
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

export default function InsightModules({ modules, graph, onNavigate, focusMonth = null }) {
  if (!modules) return null;
  const {
    handshakes, giftOfYears, fullestYear, strata, brood, bridges,
    names, heartlands, trades, birthdays, records, parenthood,
  } = modules;
  const chapters = [
    ['Deep time', [
      handshakes && <HandshakesModule key="hands" data={handshakes} graph={graph} onNavigate={onNavigate} />,
      giftOfYears && <GiftModule key="gift" data={giftOfYears} graph={graph} onNavigate={onNavigate} />,
      fullestYear && <FullestModule key="fullest" data={fullestYear} graph={graph} onNavigate={onNavigate} />,
    ]],
    ['The shape of us', [
      strata && <StrataModule key="strata" data={strata} graph={graph} onNavigate={onNavigate} />,
      brood && <BroodModule key="brood" data={brood} graph={graph} onNavigate={onNavigate} />,
      parenthood && <ParenthoodModule key="parenthood" data={parenthood} graph={graph} onNavigate={onNavigate} />,
      bridges && <BridgesModule key="bridge" data={bridges} onNavigate={onNavigate} />,
    ]],
    ['Names', [
      names && <NamesModule key="names" data={names} graph={graph} onNavigate={onNavigate} />,
    ]],
    ['Places & work', [
      heartlands && <HeartlandsModule key="heart" data={heartlands} graph={graph} onNavigate={onNavigate} />,
      trades && <TradesModule key="trades" data={trades} graph={graph} onNavigate={onNavigate} />,
    ]],
    ['Seasons & milestones', [
      birthdays && <BirthdaysModule key="bday" data={birthdays} graph={graph} onNavigate={onNavigate} initialMonth={focusMonth} />,
      records && <RecordsModule key="records" data={records} graph={graph} onNavigate={onNavigate} />,
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

function Module({ icon, title, sub, caption, children, id }) {
  const nodeRef = useRef(null);
  return (
    <div className="tim" ref={nodeRef} id={id}>
      <div className="tim__top">
        <span className="tim__ico">{icon}</span>
        <div>
          <div className="tim__title">{title}</div>
          {sub && <div className="tim__sub">{sub}</div>}
        </div>
      </div>
      {children && <div className="tim__body">{children}</div>}
      {caption && <p className="tim__caption">{caption}</p>}
      <ShareButton nodeRef={nodeRef} title={title} />
    </div>
  );
}

// Captures the card exactly as shown (minus this button itself) and either
// hands it to the OS share sheet — the point, since these are made to send
// to a family chat — or falls back to a plain download when Web Share
// (or file-sharing specifically) isn't available, e.g. most desktop browsers.
function ShareButton({ nodeRef, title }) {
  const [state, setState] = useState('idle'); // idle | busy | error

  const handleShare = async () => {
    if (state === 'busy' || !nodeRef.current) return;
    setState('busy');
    try {
      const blob = await toBlob(nodeRef.current, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        // The card's fonts are already loaded and rendering correctly in the
        // live page — html-to-image's font-embedding step exists for
        // producing a portable, standalone SVG, not for capturing what's
        // already on screen. Skipping it avoids a remote CSS re-fetch
        // (Google Fonts) that's slow at best and network/CORS-fragile at
        // worst, for zero visible benefit here.
        skipFonts: true,
        // The shared image is the collapsed card: no share button, no open
        // drill-down drawer, no explorer input — the chart and its caption.
        filter: (node) => !['tim__share', 'tim-drawer', 'tim-explore', 'tim-chiprow', 'tim-hs-panel']
          .some((cls) => node.classList?.contains(cls)),
      });
      if (!blob) throw new Error('empty capture');
      const fileName = `${title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Bloodline', text: title });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        // Some browsers only honor a programmatic download click when the
        // anchor is actually attached to the document.
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      setState('idle');
    } catch (err) {
      // A user cancelling the native share sheet also lands here (AbortError)
      // — that's not a failure, just don't show an error for it.
      setState(err?.name === 'AbortError' ? 'idle' : 'error');
      if (err?.name !== 'AbortError') setTimeout(() => setState('idle'), 2400);
    }
  };

  return (
    <button
      className={`tim__share${state === 'error' ? ' tim__share--error' : ''}`}
      onClick={handleShare}
      disabled={state === 'busy'}
      aria-label={state === 'error' ? "Couldn't create image — try again" : `Share "${title}"`}
      title={state === 'error' ? "Couldn't create image" : 'Share as image'}
    >
      {state === 'busy' ? <SpinnerIcon /> : state === 'error' ? <ErrorIcon /> : <ShareIcon />}
    </button>
  );
}

/* ── Drill-down drawer — the one gesture shared by every interactive card:
   tap a chart element, see exactly who is behind the number, tap a person,
   land on their profile. rows: [{ id, detail?, tag?, label? }] — label
   overrides the display name where the entry is a couple/household. ─────── */
function PeopleDrawer({ title, rows, graph, onNavigate, onClose }) {
  return (
    <div className="tim-drawer">
      <div className="tim-drawer__head">
        <span>{title}</span>
        <button className="tim-drawer__close" onClick={onClose} aria-label="Close list">×</button>
      </div>
      <div className="tim-drawer__list">
        {rows.map(({ id, detail, tag, label }, i) => {
          const person = graph?.byId?.get(id);
          if (!person) return null;
          return (
            <button key={`${id}_${i}`} className="tim-drawer__row" onClick={() => onNavigate?.(id)}>
              <Avatar person={person} size={28} />
              <span className="tim-drawer__name">{label ?? person.display_name}</span>
              {tag && <em className="tim-drawer__tag">{tag}</em>}
              <span className="tim-drawer__detail">{detail ?? lifespan(person)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] ?? 'th'}`;

/* ── Deep time ─────────────────────────────────────────────────────────── */

// The chain, told from the near end toward the past: "You knew Gwen, who
// knew William, who knew John." Capped at the three oldest links so a long
// chain doesn't run the caption off the card. Shared by the deep-time
// default and any "handshakes to ___" result — the wording holds regardless
// of which direction chronology runs, since it's just walking the array.
function chainSentence(people, links, thisYear, earliestBirth) {
  const last = people.length - 1;
  const nameOf = (i) => (i === last ? 'You' : people[i].firstName);
  if (people.length === 2) {
    return <><b>You and {people[0].firstName} were alive at the same time</b> — {links[0].years} shared years.</>;
  }
  const start = Math.min(2, last);
  const parts = [];
  for (let i = start; i >= 1; i--) parts.push(nameOf(i));
  return <><b>{parts[0]} knew {parts.slice(1).concat(people[0].firstName).join(', who knew ')}</b> — hand to hand across {thisYear - earliestBirth} years.</>;
}

// The lifespan-bar chain itself — shared by the deep-time default and any
// picked-target result below it.
function HandshakeChain({ data, onNavigate }) {
  const { people, links, earliestBirth, thisYear } = data;
  // Shared time axis, padded back a touch so the earliest bar doesn't start
  // flush against the edge.
  const axisStart = Math.floor((earliestBirth - 8) / 10) * 10;
  const span = thisYear - axisStart;
  const pct = (y) => ((y - axisStart) / span) * 100;
  const last = people.length - 1;
  return (
    <div className="tim-hs">
      {people.map((p, i) => {
        const end = p.death ?? thisYear;
        const link = i < links.length ? links[i] : null;
        return (
          <div key={p.id}>
            <div className="tim-hs__row">
              <button
                className="tim-hs__name"
                onClick={() => onNavigate?.(p.id)}
                aria-label={`Open ${p.name}`}
              >
                <b>{i === last ? 'You' : p.name}</b>
                {p.death ? `${p.birth}–${p.death}` : `b. ${p.birth}`}
              </button>
              <div className="tim-hs__track">
                <div
                  className={`tim-hs__bar${p.death ? '' : ' tim-hs__bar--living'}`}
                  style={{ left: `${pct(p.birth)}%`, width: `${Math.max(pct(end) - pct(p.birth), 2)}%` }}
                />
                {link && (
                  <div
                    className="tim-hs__olap"
                    style={{ left: `${pct(link.from)}%`, width: `${Math.max(pct(link.to) - pct(link.from), 1.5)}%` }}
                  />
                )}
              </div>
            </div>
            {link && (
              <div className="tim-hs__link">
                <span />
                <span>
                  <i style={{ left: `${Math.min(Math.max((pct(link.from) + pct(link.to)) / 2, 12), 86)}%` }}>
                    {link.years} year{link.years === 1 ? '' : 's'}{i === 0 ? ' together' : ''}
                  </i>
                </span>
              </div>
            )}
          </div>
        );
      })}
      <div className="tim-hs__axis">
        <span />
        <span>
          <span>{axisStart}</span>
          <span>{Math.round(axisStart + span / 2)}</span>
          <span>Today</span>
        </span>
      </div>
    </div>
  );
}

function HandshakesModule({ data, graph, onNavigate }) {
  const { people, links, hops, earliestBirth, thisYear, anchor } = data;
  const viewerId = people[people.length - 1].id;
  const chain = chainSentence(people, links, thisYear, earliestBirth);

  // "Curious about someone else?" — the same overlap chain, to anyone you
  // pick. Computed on demand: nothing runs until a name is actually tapped.
  const [q, setQ] = useState('');
  const [targetId, setTargetId] = useState(null);
  const query = q.trim().toLowerCase();
  const matches = query
    ? graph.people.filter((p) => p.id !== viewerId && (p.display_name || '').toLowerCase().includes(query)).slice(0, 6)
    : [];
  const result = useMemo(
    () => (targetId ? handshakesTo(graph, viewerId, targetId) : null),
    [graph, viewerId, targetId],
  );
  const target = targetId ? graph.byId.get(targetId) : null;

  return (
    <Module
      icon={<HandshakeIcon />}
      title={`You are ${asWord(hops)} handshake${hops === 1 ? '' : 's'} from ${earliestBirth}`}
      sub={`Lives that overlapped, hand to hand, from you back to ${people[0].name}.`}
      caption={<>
        {chain}
        {anchor && (
          <span className="tim-hs__anchor">
            <span className="tim-hs__anchor-year">{anchor.year}</span> {anchor.title}
          </span>
        )}
      </>}
    >
      <HandshakeChain data={data} onNavigate={onNavigate} />
      <div className="tim-explore">
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setTargetId(null); }}
          placeholder="Curious about someone else? Try a name…"
          aria-label="Find how many handshakes you are from anyone in the tree"
        />
        {query && matches.length === 0 && (
          <p className="tim-explore__none">No one matches “{q.trim()}”.</p>
        )}
        {matches.length > 0 && (
          <div className="tim-chiprow">
            {matches.map((p) => (
              <button
                key={p.id}
                className={'tim-chipbtn' + (p.id === targetId ? ' tim-chipbtn--on' : '')}
                onClick={() => setTargetId((cur) => (cur === p.id ? null : p.id))}
              >
                {p.display_name}
              </button>
            ))}
          </div>
        )}
      </div>
      {target && (
        <div className="tim-hs-panel">
          <div className="tim-drawer__head">
            <span>{result ? `${asWord(result.hops)} handshake${result.hops === 1 ? '' : 's'} to ${firstNameOfDisplay(target)}` : firstNameOfDisplay(target)}</span>
            <button className="tim-drawer__close" onClick={() => setTargetId(null)} aria-label="Close">×</button>
          </div>
          {result ? (
            <>
              <p className="tim-hs-panel__lede">
                {chainSentence(result.people, result.links, result.thisYear, result.earliestBirth)}
              </p>
              <HandshakeChain data={result} onNavigate={onNavigate} />
            </>
          ) : (
            <p className="tim-explore__none tim-hs-panel__lede">
              No overlap chain found yet — a birth or death date is probably missing somewhere along the way.
            </p>
          )}
        </div>
      )}
    </Module>
  );
}

function GiftModule({ data, graph, onNavigate }) {
  const { cohorts, first, last, gained } = data;
  const [sel, setSel] = useState(null); // decade | null
  const selCohort = sel != null ? cohorts.find((c) => c.decade === sel) : null;
  const title = gained >= 5
    ? `The family gained ${gained} years`
    : 'The length of a life, era by era';
  return (
    <Module
      icon={<TrendIcon />}
      title={title}
      sub="Average length of life, by the decade people were born into. Tap a decade to meet its cohort."
      caption={<>Relatives born in the <b>{first.decade}s</b> lived
        to <b>{first.avg}</b> on average. Those born in
        the <b>{last.decade}s</b>: <b>{last.avg}</b>.</>}
    >
      <GiftChart cohorts={cohorts} selected={sel} onPick={(d) => setSel((cur) => (cur === d ? null : d))} />
      {selCohort && (
        <PeopleDrawer
          title={`Born in the ${selCohort.decade}s — ${selCohort.n} lives, avg ${selCohort.avg}`}
          rows={selCohort.people.map(({ id, span }) => ({ id, detail: `${span} years` }))}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSel(null)}
        />
      )}
    </Module>
  );
}

function GiftChart({ cohorts, selected = null, onPick }) {
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
  const slotW = cohorts.length > 1 ? (W - L - R) / (cohorts.length - 1) : W - L - R;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Average lifespan by birth decade, from ${cohorts[0].avg} years for the ${cohorts[0].decade}s to ${cohorts[cohorts.length - 1].avg} for the ${cohorts[cohorts.length - 1].decade}s. Each decade is tappable.`}>
      {grid.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={HAIR} strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3.5} fontSize="10" fill={FAINT} textAnchor="end">{v}</text>
        </g>
      ))}
      <polyline points={pts} fill="none" stroke={ACC} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {cohorts.map((c, i) => {
        const end = i === 0 || i === cohorts.length - 1;
        const on = c.decade === selected;
        return (
          <g
            key={c.decade}
            className="tim-petal"
            onClick={() => onPick?.(c.decade)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(c.decade); } }}
            aria-label={`${c.decade}s: average ${c.avg} years across ${c.n} lives`}
          >
            {/* invisible full-height hit target so the tap doesn't demand a 9px dot */}
            <rect x={x(i) - slotW / 2} y={T - 10} width={slotW} height={H - T - B + 20} fill="transparent" />
            <circle cx={x(i)} cy={y(c.avg)} r={on ? 6.5 : 4.5} fill={on ? INK : ACC} stroke="#fff" strokeWidth="2" />
            {(!everyOther || i % 2 === 0 || end) && (
              <text x={x(i)} y={H - 12} fontSize="10" fill={on ? INK : FAINT} fontWeight={on ? 700 : 400} textAnchor="middle">{c.decade}s</text>
            )}
            {end && !on && (
              <text x={x(i)} y={y(c.avg) - 11} fontSize="12" fontWeight="700" fill={INK}
                textAnchor={i === 0 ? 'start' : 'end'}>{c.avg} yrs</text>
            )}
            {on && (
              <text x={x(i)} y={y(c.avg) - 11} fontSize="12" fontWeight="700" fill={INK}
                textAnchor={i === 0 ? 'start' : i === cohorts.length - 1 ? 'end' : 'middle'}>{c.avg} yrs</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function FullestModule({ data, graph, onNavigate }) {
  const { peak, isNow, firstYear, firstCount, spans } = data;
  const [selYear, setSelYear] = useState(null);
  const alive = selYear != null ? aliveInYear(spans, selYear) : null;
  return (
    <Module
      icon={<PeopleIcon />}
      title={isNow ? 'Your family has never been bigger' : `${peak.year} was the family's fullest year`}
      sub={`How many relatives were alive, year by year since ${firstYear}. Slide across the years — see who was alive when.`}
      caption={isNow
        ? <>From <b>{firstCount || 'a handful of'} {firstCount === 1 ? 'person' : 'people'}</b> in {firstYear} to <b>{peak.count} alive right now</b> — today is the fullest the family has ever been.</>
        : <><b>{peak.count} relatives were alive at once in {peak.year}</b> — the fullest the family has ever been.</>}
    >
      <AliveChart data={data} selYear={selYear} aliveCount={alive?.length ?? 0} onScrub={setSelYear} />
      {selYear != null && (
        <PeopleDrawer
          title={`Alive in ${selYear} — ${alive.length} ${alive.length === 1 ? 'relative' : 'relatives'}`}
          rows={alive.map(({ id, ageThen }) => ({ id, detail: ageThen === 0 ? `born ${selYear}` : `age ${ageThen}` }))}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSelYear(null)}
        />
      )}
    </Module>
  );
}

// The scrubber: drag (or tap, or arrow-key) anywhere on the curve to pin a
// year; the marker, count chip and drawer follow. Horizontal pans scrub,
// vertical pans still scroll the sheet (touch-action: pan-y).
function AliveChart({ data, selYear = null, aliveCount = 0, onScrub }) {
  const { series, peak, isNow, thisYear } = data;
  const svgRef = useRef(null);
  const W = 340, H = 170, L = 34, R = 30, T = 22, B = 34;
  const minYear = series[0].year;
  const maxCount = Math.max(...series.map((s) => s.count));
  const yMax = Math.max(10, Math.ceil(maxCount / 50) * 50);
  const x = (yr) => L + (yr - minYear) / (thisYear - minYear) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const line = series.map((s) => `${x(s.year)},${y(s.count)}`).join(' ');
  const mid = Math.round((minYear + thisYear) / 2);

  const yearFromClientX = (clientX) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const vx = ((clientX - rect.left) / rect.width) * W;
    const yr = Math.round(minYear + ((vx - L) / (W - L - R)) * (thisYear - minYear));
    return Math.min(thisYear, Math.max(minYear, yr));
  };
  const dragging = useRef(false);
  const scrubTo = (clientX) => {
    const yr = yearFromClientX(clientX);
    if (yr != null) onScrub?.(yr);
  };

  const scrubbing = selYear != null;
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="slider"
      tabIndex={0}
      aria-label={`Living relatives per year, peaking at ${peak.count} in ${isNow ? 'the present day' : peak.year}. Drag or use arrow keys to pick a year.`}
      aria-valuemin={minYear}
      aria-valuemax={thisYear}
      aria-valuenow={selYear ?? peak.year}
      className="tim-scrub"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); scrubTo(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) scrubTo(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        const base = selYear ?? peak.year;
        if (e.key === 'ArrowLeft') { e.preventDefault(); onScrub?.(Math.max(minYear, base - step)); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onScrub?.(Math.min(thisYear, base + step)); }
        if (e.key === 'Escape') onScrub?.(null);
      }}
    >
      {[0, yMax / 2, yMax].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={HAIR} strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3.5} fontSize="10" fill={FAINT} textAnchor="end">{v}</text>
        </g>
      ))}
      <polygon points={`${x(minYear)},${y(0)} ${line} ${x(thisYear)},${y(0)}`} fill={ACC} opacity="0.1" />
      <polyline points={line} fill="none" stroke={ACC} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {!scrubbing && (
        <>
          <circle cx={x(peak.year)} cy={y(peak.count)} r="5" fill={ACC} stroke="#fff" strokeWidth="2" />
          <text x={x(peak.year) - 8} y={y(peak.count) - 10} fontSize="12" fontWeight="700" fill={INK} textAnchor="end">
            {peak.count}{isNow ? ' alive today' : ` in ${peak.year}`}
          </text>
        </>
      )}
      {scrubbing && (
        <g pointerEvents="none">
          <line x1={x(selYear)} x2={x(selYear)} y1={T - 6} y2={H - B} stroke={INK} strokeWidth="1.2" strokeDasharray="3 3" opacity="0.55" />
          <circle cx={x(selYear)} cy={y(aliveCount)} r="6" fill={INK} stroke="#fff" strokeWidth="2" />
          <text
            x={Math.min(Math.max(x(selYear), L + 44), W - R - 44)} y={T - 8}
            fontSize="12" fontWeight="700" fill={INK} textAnchor="middle"
          >
            {aliveCount} alive in {selYear}
          </text>
        </g>
      )}
      <text x={x(minYear)} y={H - 12} fontSize="10" fill={FAINT} textAnchor="start">{minYear}</text>
      <text x={x(mid)} y={H - 12} fontSize="10" fill={FAINT} textAnchor="middle">{mid}</text>
      <text x={x(thisYear)} y={H - 12} fontSize="10" fill={FAINT} textAnchor="end">Today</text>
    </svg>
  );
}

/* ── The shape of us ───────────────────────────────────────────────────── */

function StrataModule({ data, graph, onNavigate }) {
  const { rows, widest, viewerLabel, viewerIsWidest, living, remembered } = data;
  const max = widest.total;
  const [sel, setSel] = useState(null); // row.gen | null
  const selRow = sel != null ? rows.find((r) => r.gen === sel) : null;
  return (
    <Module
      icon={<LayersIcon />}
      title={`${cap(asWord(rows.length))} generations, stacked`}
      sub="Everyone in the tree, oldest generation at the top. Tap a row to meet a generation."
      caption={viewerIsWidest
        ? <>Your generation, <b>{viewerLabel}, is the widest the family has ever been</b> — {widest.total} people across it.</>
        : <><b>{widest.label} is the widest generation</b> — {widest.total} people across it{viewerLabel ? <>; you sit in {viewerLabel}</> : null}.</>}
    >
      <div className="tim-strata">
        {rows.map((r) => (
          <button
            className={'tim-strata__row tim-tap' + (r.gen === sel ? ' tim-tap--on' : '')}
            key={r.gen}
            onClick={() => setSel((cur) => (cur === r.gen ? null : r.gen))}
            aria-expanded={r.gen === sel}
          >
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
          </button>
        ))}
      </div>
      <div className="tim-legend">
        <span><i style={{ background: ACC }} />Living · {living}</span>
        <span><i style={{ background: MEMORIAL }} />Remembered · {remembered}</span>
      </div>
      {selRow && (
        <PeopleDrawer
          title={`${selRow.label} — ${selRow.total} ${selRow.total === 1 ? 'person' : 'people'}`}
          rows={selRow.ids.map((id) => ({ id }))}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSel(null)}
        />
      )}
    </Module>
  );
}

function BroodModule({ data, graph, onNavigate }) {
  const { record, trend } = data;
  const [sel, setSel] = useState(null); // trend bucket start | null
  const selBucket = sel != null && trend ? trend.find((t) => t.start === sel) : null;
  const title = record
    ? `${record.parentNames.join(' & ')} raised ${asWord(record.count)}`
    : 'How full the households were';
  const first = trend && trend[0];
  const last = trend && trend[trend.length - 1];
  // A household row: both parents named, first parent's avatar + profile.
  const householdRow = (h) => ({
    id: h.parentIds[0],
    label: h.parentIds.map((id) => firstNameOfDisplay(graph?.byId?.get(id))).filter(Boolean).join(' & '),
    detail: `${h.count} ${h.count === 1 ? 'child' : 'children'}`,
  });
  return (
    <Module
      icon={<FamilyIcon />}
      title={title}
      sub={record
        ? `The fullest household in the tree${record.span ? `, ${record.span}` : ''}.`
        : 'Average children per household, over time.'}
      caption={trend
        ? <>Households begun in the <b>{first.label}</b> averaged <b>{first.avg} children</b>. Those begun in the <b>{last.label}</b>: <b>{last.avg}</b>. Tap an era's bar for its households.</>
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
      {trend && <BroodChart trend={trend} selected={sel} onPick={(s) => setSel((cur) => (cur === s ? null : s))} />}
      {selBucket && (
        <PeopleDrawer
          title={`Households begun in the ${selBucket.label} — ${selBucket.n}`}
          rows={selBucket.households.map(householdRow)}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSel(null)}
        />
      )}
    </Module>
  );
}

function firstNameOfDisplay(p) {
  return (p?.display_name || '').trim().split(/\s+/)[0] || null;
}

function BroodChart({ trend, selected = null, onPick }) {
  const W = 340, H = 130, L = 16, R = 16, T = 20, B = 28;
  const slot = (W - L - R) / trend.length;
  const bw = Math.min(22, slot * 0.6);
  const maxAvg = Math.max(...trend.map((t) => t.avg));
  const y = (v) => T + (1 - v / (maxAvg + 1)) * (H - T - B);
  const everyOther = trend.length > 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Average children per household, from ${trend[0].avg} (${trend[0].label}) to ${trend[trend.length - 1].avg} (${trend[trend.length - 1].label}). Each era is tappable.`}>
      {trend.map((t, i) => {
        const cx = L + slot * i + slot / 2;
        const top = y(t.avg), bot = H - B;
        const end = i === 0 || i === trend.length - 1;
        const on = t.start === selected;
        return (
          <g
            key={t.start}
            className="tim-petal"
            onClick={() => onPick?.(t.start)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(t.start); } }}
            aria-label={`${t.label}: ${t.avg} children per household on average, ${t.n} households`}
          >
            <rect x={cx - slot / 2} y={T - 8} width={slot} height={H - T - B + 16} fill="transparent" />
            <path
              d={`M${cx - bw / 2},${bot} L${cx - bw / 2},${top + 4} Q${cx - bw / 2},${top} ${cx - bw / 2 + 4},${top} L${cx + bw / 2 - 4},${top} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + 4} L${cx + bw / 2},${bot} Z`}
              fill={on ? INK : end ? ACC : ACC_SOFT}
            />
            {(!everyOther || end || (i % 2 === 0 && i < trend.length - 2)) && (
              <text x={cx} y={H - 10} fontSize="10" fill={on ? INK : FAINT} fontWeight={on ? 700 : 400} textAnchor="middle">{t.label}</text>
            )}
            {(end || on) && <text x={cx} y={top - 7} fontSize="12" fontWeight="700" fill={INK} textAnchor="middle">{t.avg}</text>}
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

function ParenthoodModule({ data, graph, onNavigate }) {
  const { avg, n, min, max, byGender, histogram } = data;
  const [sel, setSel] = useState(null); // bucket "from" | null
  const selBucket = sel != null ? histogram.find((b) => b.from === sel) : null;
  return (
    <Module
      icon={<CradleIcon />}
      title={`${avg} — average age becoming a parent`}
      sub={`Across ${n} recorded births, ${min} to ${max}. Tap a bar for who's in it.`}
      caption={byGender
        ? <>
          {byGender.female && <>Mothers averaged <b>{byGender.female.avg}</b>. </>}
          {byGender.male && <>Fathers averaged <b>{byGender.male.avg}</b>.</>}
        </>
        : null}
    >
      <ParenthoodChart histogram={histogram} selected={sel} onPick={(f) => setSel((cur) => (cur === f ? null : f))} />
      {selBucket && (
        <PeopleDrawer
          title={`Age ${selBucket.from}–${selBucket.to} at the time — ${selBucket.count}`}
          rows={selBucket.people.map(({ parent, child, age }) => ({
            id: parent.id,
            detail: `age ${age}, with ${firstNameOfDisplay(child)}`,
          }))}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSel(null)}
        />
      )}
    </Module>
  );
}

function ParenthoodChart({ histogram, selected = null, onPick }) {
  const W = 340, H = 130, L = 16, R = 16, T = 20, B = 28;
  const slot = (W - L - R) / histogram.length;
  const bw = Math.min(30, slot * 0.65);
  const maxCount = Math.max(...histogram.map((b) => b.count));
  const y = (v) => T + (1 - v / (maxCount + 1)) * (H - T - B);
  const everyOther = histogram.length > 7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Age at parenthood, in five-year bands from ${histogram[0].from} to ${histogram[histogram.length - 1].to}. Each band is tappable.`}>
      {histogram.map((b, i) => {
        const cx = L + slot * i + slot / 2;
        const top = y(b.count), bot = H - B;
        const on = b.from === selected;
        return (
          <g
            key={b.from}
            className="tim-petal"
            onClick={() => onPick?.(b.from)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(b.from); } }}
            aria-label={`${b.from}–${b.to}: ${b.count} ${b.count === 1 ? 'person' : 'people'}`}
          >
            <rect x={cx - slot / 2} y={T - 8} width={slot} height={H - T - B + 16} fill="transparent" />
            <path
              d={`M${cx - bw / 2},${bot} L${cx - bw / 2},${top + 4} Q${cx - bw / 2},${top} ${cx - bw / 2 + 4},${top} L${cx + bw / 2 - 4},${top} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + 4} L${cx + bw / 2},${bot} Z`}
              fill={on ? INK : ACC_SOFT}
            />
            {(!everyOther || i % 2 === 0) && (
              <text x={cx} y={H - 10} fontSize="10" fill={on ? INK : FAINT} fontWeight={on ? 700 : 400} textAnchor="middle">{b.from}</text>
            )}
            {b.count > 0 && (on || b.count === maxCount) && (
              <text x={cx} y={top - 7} fontSize="12" fontWeight="700" fill={INK} textAnchor="middle">{b.count}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function CradleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 15c2.5 2 13.5 2 16 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 15a8 4 0 0 1 16 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 3v4M8 5l4 2 4-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BridgesModule({ data, onNavigate }) {
  const { personId, name, firstName, lifespan, sideA, sideB } = data;
  // "34 Fosters", but "26 Millses" — the Joneses rule for s-ending surnames.
  const label = (s) => (s.surname
    ? `${s.count} ${s.surname}${/(?:s|x|z|ch|sh)$/i.test(s.surname) ? 'es' : 's'}`
    : `${s.count} people`);
  return (
    <Module
      icon={<BridgeIcon />}
      title={`${firstName} holds two families together`}
      sub={`Two halves of the tree meet only through ${firstName}.`}
      caption={<>
        <button className="tim-linky" onClick={() => onNavigate?.(personId)}>{name}</button>
        {lifespan ? <b>, {lifespan}.</b> : <b>.</b>} Every path between {label(sideA)} and {label(sideB)} passes
        through {firstName}.
      </>}
    >
      <BridgeDiagram firstName={firstName} labelA={label(sideA)} labelB={label(sideB)} />
    </Module>
  );
}

// Two decorative clusters joined through the one highlighted person. The dot
// positions are fixed composition, not data — the counts in the labels are
// the data.
function BridgeDiagram({ firstName, labelA, labelB }) {
  const left = [[46, 44], [30, 78], [64, 96], [88, 56], [58, 26]];
  const right = [[292, 46], [308, 84], [274, 100], [252, 58], [282, 22]];
  const hub = [170, 66];
  const spokesL = [left[0], left[2], left[3]];
  const spokesR = [right[0], right[2], right[3]];
  const mesh = (ns) => ns.slice(0, -1).map((p, i) => (
    <line key={i} x1={p[0]} y1={p[1]} x2={ns[i + 1][0]} y2={ns[i + 1][1]} stroke={HAIR} strokeWidth="1.4" />
  ));
  return (
    <svg viewBox="0 0 340 150" width="100%" role="img"
      aria-label={`Two family clusters, ${labelA} and ${labelB}, joined only through ${firstName}`}>
      {mesh(left)}
      {mesh(right)}
      {spokesL.map(([x, y], i) => <line key={`l${i}`} x1={x} y1={y} x2={hub[0]} y2={hub[1]} stroke="#d9b8a8" strokeWidth="1.6" />)}
      {spokesR.map(([x, y], i) => <line key={`r${i}`} x1={x} y1={y} x2={hub[0]} y2={hub[1]} stroke="#d9b8a8" strokeWidth="1.6" />)}
      {left.concat(right).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="7" fill="#e4e0da" />)}
      <circle cx={hub[0]} cy={hub[1]} r="13" fill={ACC} stroke="#fff" strokeWidth="2.5" />
      <text x={hub[0]} y={hub[1] + 32} fontSize="12" fontWeight="700" fill={INK} textAnchor="middle">{firstName}</text>
      <text x="58" y="132" fontSize="11" fill={SOFT} textAnchor="middle">{labelA}</text>
      <text x="282" y="132" fontSize="11" fill={SOFT} textAnchor="middle">{labelB}</text>
    </svg>
  );
}

/* ── Names ─────────────────────────────────────────────────────────────── */

function NamesModule({ data, graph, onNavigate }) {
  const { top, all, thread } = data;
  const max = top[0].count;
  const plural = /(?:s|x|z|ch|sh)$/i.test(top[0].name) ? 'es' : 's';
  const [sel, setSel] = useState(null); // a name from the bars or the explorer
  const [q, setQ] = useState('');

  // The explorer: any given name in the tree, middle names included. Prefix
  // match first (typing "Jas" should surface Jason), substring as fallback.
  const query = q.trim().toLowerCase();
  const matches = query
    ? (() => {
        const pre = all.filter((e) => e.name.toLowerCase().startsWith(query));
        return pre.length ? pre : all.filter((e) => e.name.toLowerCase().includes(query));
      })().slice(0, 6)
    : [];
  const selEntry = sel ? all.find((e) => e.name === sel) : null;

  return (
    <Module
      icon={<TypeIcon />}
      title={`${cap(asWord(top[0].count))} ${top[0].name}${plural} and counting`}
      sub="First and middle names both. Tap a bar — or look any name up."
      caption={<><b>{thread.name} has appeared in {thread.present} of
        your {thread.generations.length} generations</b>{thread.first != null
        ? <> — first in {thread.first}{thread.last !== thread.first ? <>, most recently in {thread.last}</> : null}</>
        : null}.</>}
    >
      <div className="tim-names">
        {top.map((n) => (
          <button
            className={'tim-names__row tim-tap' + (n.name === sel ? ' tim-tap--on' : '')}
            key={n.name}
            onClick={() => { setSel((cur) => (cur === n.name ? null : n.name)); }}
            aria-expanded={n.name === sel}
          >
            <span className="tim-names__name">{n.name}</span>
            <div className="tim-names__track">
              <div className="tim-names__fill" style={{ width: `${(n.count / max) * 100}%` }} />
            </div>
            <span className="tim-names__count">{n.count}</span>
          </button>
        ))}
      </div>
      <div className="tim-thread" aria-label={`${thread.name} appears in ${thread.present} of ${thread.generations.length} generations`}>
        {thread.generations.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}
      </div>
      <div className="tim-explore">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Wonder about a name? Try “Jason”…"
          aria-label="Look up any name in the family"
        />
        {query && matches.length === 0 && (
          <p className="tim-explore__none">No {cap(q.trim())}s in the tree yet.</p>
        )}
        {matches.length > 0 && (
          <div className="tim-chiprow">
            {matches.map((e) => (
              <button
                key={e.name}
                className={'tim-chipbtn' + (e.name === sel ? ' tim-chipbtn--on' : '')}
                onClick={() => setSel((cur) => (cur === e.name ? null : e.name))}
              >
                {e.name} · {e.count}
              </button>
            ))}
          </div>
        )}
      </div>
      {selEntry && (
        <PeopleDrawer
          title={`${selEntry.count} ${selEntry.name}${/(?:s|x|z|ch|sh)$/i.test(selEntry.name) ? 'es' : 's'}`}
          rows={selEntry.people.map(({ id, middle }) => ({ id, tag: middle ? 'middle name' : null }))}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSel(null)}
        />
      )}
    </Module>
  );
}

/* ── Places ────────────────────────────────────────────────────────────── */

function HeartlandsModule({ data, graph, onNavigate }) {
  const { places, migration } = data;
  const max = places[0].count;
  const [sel, setSel] = useState(null); // place display name
  const selPlace = sel ? places.find((p) => p.display === sel) : null;
  return (
    <Module
      icon={<PinIcon />}
      title={`${places[0].display} is your heartland`}
      sub="Where the family was born, and how far it has walked. Tap a place to see who."
      caption={migration
        ? <>The family's birthplace has moved <b>{asWord(migration.length - 1)} time{migration.length === 2 ? '' : 's'}</b> across the generations.</>
        : null}
    >
      <div className="tim-names">
        {places.map((p) => (
          <button
            className={'tim-names__row tim-tap' + (p.display === sel ? ' tim-tap--on' : '')}
            key={p.display}
            onClick={() => setSel((cur) => (cur === p.display ? null : p.display))}
            aria-expanded={p.display === sel}
          >
            <span className="tim-names__name tim-names__name--place">{p.display}</span>
            <div className="tim-names__track">
              <div className="tim-names__fill" style={{ width: `${(p.count / max) * 100}%` }} />
            </div>
            <span className="tim-names__count">{p.count}</span>
          </button>
        ))}
      </div>
      {selPlace && (
        <PeopleDrawer
          title={`Born in ${selPlace.display} — ${selPlace.count}`}
          rows={selPlace.ids.map((id) => ({ id }))}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSel(null)}
        />
      )}
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

function TradesModule({ data, graph, onNavigate }) {
  const { bands, firstTop, lastTop, distinct, total } = data;
  const [sel, setSel] = useState(null); // { from, name } | null
  const selTag = sel ? bands.find((b) => b.from === sel.from)?.top.find((t) => t.name === sel.name) : null;
  const selBand = sel ? bands.find((b) => b.from === sel.from) : null;
  // Lowercase a normally-cased occupation for mid-sentence use, leaving
  // all-caps forms ("IT consultant") alone.
  const lc = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  return (
    <Module
      icon={<ToolsIcon />}
      title={`From ${lc(firstTop)} to ${lc(lastTop)}`}
      sub="What the family did for a living, era by era. Tap a trade to see who."
      caption={<><b>{distinct} different trades</b> across {total} working lives recorded so far.</>}
    >
      <div className="tim-eras">
        {bands.map((b) => (
          <div className="tim-era" key={b.from}>
            <div className="tim-era__when">{b.from} – {b.isNow ? 'today' : b.to}</div>
            <div className="tim-era__tags">
              {b.top.map((t) => (
                <button
                  key={t.name}
                  className={'tim-eratag' + (sel && sel.from === b.from && sel.name === t.name ? ' tim-eratag--on' : '')}
                  onClick={() => setSel((cur) => (cur && cur.from === b.from && cur.name === t.name ? null : { from: b.from, name: t.name }))}
                  aria-expanded={!!(sel && sel.from === b.from && sel.name === t.name)}
                >
                  {t.name}{t.count > 1 ? ` ×${t.count}` : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {selTag && selBand && (
        <PeopleDrawer
          title={`${selTag.name} — ${selTag.count}, ${selBand.from}–${selBand.isNow ? 'today' : selBand.to}`}
          rows={selTag.ids.map((id) => ({ id }))}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSel(null)}
        />
      )}
    </Module>
  );
}

/* ── Seasons ───────────────────────────────────────────────────────────── */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function BirthdaysModule({ data, graph, onNavigate, initialMonth = null }) {
  const { peakLabel, peakCount, twins, monthPeople, sharedDays, withMonth } = data;
  const twin = twins[0];
  const [selMonth, setSelMonth] = useState(initialMonth); // 0-11 | null
  const [showShared, setShowShared] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const monthRows = selMonth != null
    ? (monthPeople?.[selMonth] ?? []).map(({ id, day }) => ({ id, detail: day != null ? `the ${ordinal(day)}` : 'day unknown' }))
    : null;

  // Every birthday in the family, flattened out of the wheel's per-month
  // buckets and sorted by date — the "see all" list, and what the search
  // box below filters by name.
  const allRows = useMemo(() => monthPeople
    .flatMap((list, m) => list.map(({ id, day }) => ({ id, month: m, day, detail: day != null ? `${day} ${MONTH_NAMES[m]}` : MONTH_NAMES[m] })))
    .sort((a, b) => a.month - b.month || (a.day ?? 32) - (b.day ?? 32)), [monthPeople]);
  const query = q.trim().toLowerCase();
  const visibleRows = query
    ? allRows.filter((r) => graph?.byId?.get(r.id)?.display_name?.toLowerCase().includes(query))
    : allRows;

  return (
    <Module
      id="tim-birthdays"
      icon={<WheelIcon />}
      title={`${peakLabel} is birthday season`}
      sub="Every family birthday, arranged around the year. Tap a month to see whose."
      caption={<>
        <b>{peakCount} birthdays in {peakLabel}</b>
        {twin && <> — and birthday twins: {twinName(twin, 'a', onNavigate)} and {twinName(twin, 'b', onNavigate)}, both {twin.dateLabel}.</>}
        {!twin && '.'}
      </>}
    >
      <div className="tim-wheel">
        <BirthdayWheel
          data={data}
          selected={selMonth}
          onPick={(i) => { setShowShared(false); setShowAll(false); setSelMonth((cur) => (cur === i ? null : i)); }}
        />
      </div>
      <div className="tim-chiprow tim-chiprow--center">
        {sharedDays?.length > 0 && (
          <button
            className={'tim-chipbtn' + (showShared ? ' tim-chipbtn--on' : '')}
            onClick={() => { setSelMonth(null); setShowAll(false); setShowShared((s) => !s); }}
            aria-expanded={showShared}
          >
            {sharedDays.length} shared birthday{sharedDays.length === 1 ? '' : 's'}
          </button>
        )}
        <button
          className={'tim-chipbtn' + (showAll ? ' tim-chipbtn--on' : '')}
          onClick={() => { setSelMonth(null); setShowShared(false); setShowAll((s) => !s); }}
          aria-expanded={showAll}
        >
          {showAll ? 'Hide full list' : `See all ${withMonth} birthdays`}
        </button>
      </div>
      {monthRows && (
        <PeopleDrawer
          title={`${MONTH_NAMES[selMonth]} — ${monthRows.length} birthday${monthRows.length === 1 ? '' : 's'}`}
          rows={monthRows}
          graph={graph}
          onNavigate={onNavigate}
          onClose={() => setSelMonth(null)}
        />
      )}
      {showAll && (
        <>
          <div className="tim-explore">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name…"
              aria-label="Search all birthdays by name"
              autoFocus
            />
            {query && visibleRows.length === 0 && (
              <p className="tim-explore__none">No one named “{q.trim()}” has a birthday on record.</p>
            )}
          </div>
          {visibleRows.length > 0 && (
            <PeopleDrawer
              title={query ? `${visibleRows.length} match${visibleRows.length === 1 ? '' : 'es'}` : `All ${visibleRows.length} birthdays`}
              rows={visibleRows}
              graph={graph}
              onNavigate={onNavigate}
              onClose={() => { setShowAll(false); setQ(''); }}
            />
          )}
        </>
      )}
      {showShared && (
        <div className="tim-drawer">
          <div className="tim-drawer__head">
            <span>Shared birthdays</span>
            <button className="tim-drawer__close" onClick={() => setShowShared(false)} aria-label="Close list">×</button>
          </div>
          <div className="tim-drawer__list">
            {sharedDays.map((g) => (
              <div key={`${g.month}-${g.day}`} className="tim-shared">
                <span className="tim-shared__date">{g.dateLabel}</span>
                <span className="tim-shared__names">
                  {g.ids.map((id) => {
                    const person = graph?.byId?.get(id);
                    if (!person) return null;
                    return (
                      <button key={id} className="tim-linky" onClick={() => onNavigate?.(id)}>
                        {person.display_name}
                      </button>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Module>
  );
}

function twinName(twin, side, onNavigate) {
  const id = twin[`${side}Id`], name = twin[`${side}Name`];
  return (
    <button className="tim-linky" onClick={() => onNavigate?.(id)}>{name}</button>
  );
}

function BirthdayWheel({ data, selected = null, onPick }) {
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
  const showing = selected != null;
  const centerCount = showing ? months[selected] : peakCount;
  const centerLabel = showing ? `in ${MONTH_NAMES[selected]}` : `in ${peakLabel}`;
  return (
    <svg viewBox="0 0 300 240" width="86%" role="img"
      aria-label={`Birthdays per month arranged in a ring, ${peakLabel} the largest with ${peakCount}. Each month is tappable.`}>
      {petals.map((pt) => (
        // A petal with zero birthdays still draws its inner stub, so every
        // month stays a visible, tappable slice of the ring.
        <g
          key={pt.i}
          className="tim-petal"
          onClick={() => onPick?.(pt.i)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(pt.i); } }}
          aria-label={`${MONTH_NAMES[pt.i]}: ${pt.n} ${pt.n === 1 ? 'birthday' : 'birthdays'}`}
        >
          <path
            d={pt.d}
            fill={pt.i === peakMonth ? ACC : ACC_SOFT}
            stroke={pt.i === selected ? INK : 'none'}
            strokeWidth={pt.i === selected ? 1.8 : 0}
          />
          <text x={pt.lx} y={pt.ly + 3.5} fontSize="10.5" textAnchor="middle"
            fill={pt.i === (showing ? selected : peakMonth) ? INK : FAINT}
            fontWeight={pt.i === (showing ? selected : peakMonth) ? 700 : 400}>
            {LETTERS[pt.i]}
          </text>
        </g>
      ))}
      <text x={cx} y={cy - 2} fontSize="26" fontWeight="700" fill={INK} textAnchor="middle"
        style={{ fontFamily: "var(--display, Georgia, serif)" }}>{centerCount}</text>
      <text x={cx} y={cy + 15} fontSize="10.5" fill={SOFT} textAnchor="middle">{centerLabel}</text>
    </svg>
  );
}

function RecordsModule({ data, graph, onNavigate }) {
  const { records: shown, poolSize } = data;
  const [sel, setSel] = useState(null); // record key | null
  return (
    <Module
      icon={<TrophyIcon />}
      title="Records the family holds"
      sub="The superlatives hiding in the dates."
      caption={poolSize > shown.length
        ? <>{poolSize} records so far — a different three each day. Tap a record for its full leaderboard.</>
        : <>Tap a record for its full leaderboard.</>}
    >
      <div className="tim-ms">
        {shown.map((r) => (
          <div key={r.key}>
            <button
              className={'tim-ms__row' + (sel === r.key ? ' tim-ms__row--on' : '')}
              onClick={() => (r.board?.length
                ? setSel((cur) => (cur === r.key ? null : r.key))
                : r.personId && onNavigate?.(r.personId))}
              aria-expanded={r.board?.length ? sel === r.key : undefined}
            >
              <span className="tim-ms__ico"><RecordIcon name={r.icon} /></span>
              <span className="tim-ms__body">
                <span className="tim-ms__t">{r.title}</span>
                <span className="tim-ms__d">{r.detail}</span>
              </span>
            </button>
            {sel === r.key && r.board?.length > 0 && (
              <PeopleDrawer
                title={`The top ${r.board.length}`}
                rows={r.board}
                graph={graph}
                onNavigate={onNavigate}
                onClose={() => setSel(null)}
              />
            )}
          </div>
        ))}
      </div>
    </Module>
  );
}

function RecordIcon({ name }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  switch (name) {
    case 'rings': return (<svg {...p}><circle cx="9" cy="12" r="5" stroke="currentColor" strokeWidth="1.7" /><circle cx="15" cy="12" r="5" stroke="currentColor" strokeWidth="1.7" /></svg>);
    case 'star': return (<svg {...p}><path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5 6.9 19.2l1-5.6-4.1-4 5.7-.8L12 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>);
    case 'time': return (<svg {...p}><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" /><path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>);
    case 'seedling': return (<svg {...p}><path d="M12 21v-8M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 11c0-4-3-6-7-6 0 4 3 6 7 6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
    case 'gap': return (<svg {...p}><circle cx="7" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" /><circle cx="17" cy="12" r="4.6" stroke="currentColor" strokeWidth="1.7" /><path d="M11 12h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="0.5 2.5" /></svg>);
    case 'hourglass': return (<svg {...p}><path d="M6 3h12M6 21h12M7 3c0 4 3.5 5.5 5 6.5V12c-1.5 1-5 2.5-5 6.5M17 3c0 4-3.5 5.5-5 6.5V12c1.5 1 5 2.5 5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
    case 'heart': default: return (<svg {...p}><path d="M12 20s-7-4.5-9.2-9C1.3 8 3 4.5 6.3 4.5c2 0 3.2 1.3 3.7 2.2.5-.9 1.7-2.2 3.7-2.2C20 4.5 21.7 8 21.2 11 19 15.5 12 20 12 20z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>);
  }
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
function HandshakeIcon() {
  return (<svg {...ip}><path d="M7 12l3 3 7-8M3 12h2m14 0h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function BridgeIcon() {
  return (<svg {...ip}><path d="M3 17c3-6 6-6 9-6s6 0 9 6M3 17h18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M7 14.2V17m5-6v6m5-2.8V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>);
}
function ToolsIcon() {
  return (<svg {...ip}><path d="M14.5 6.5L18 3l3 3-3.5 3.5M11 10L3 18l3 3 8-8m-3-3l3 3m-3-3l3.5-3.5M14 13l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function TrophyIcon() {
  return (<svg {...ip}><path d="M8 4h8v6a4 4 0 01-8 0V4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M8 6H4.5c0 3 1.5 4.5 3.5 4.5M16 6h3.5c0 3-1.5 4.5-3.5 4.5M12 14v3m-3.5 3h7M10 20l.5-3h3l.5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}

function ShareIcon() {
  return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function SpinnerIcon() {
  return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="tim__spin"><path d="M21 12a9 9 0 11-3-6.7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>);
}
function ErrorIcon() {
  return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /><path d="M12 8v5M12 16.5v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>);
}
