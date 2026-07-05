import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import { relationLabel } from '../data/graph.js';

/*
 * The search flyover's payoff — one card that builds itself progressively
 * across the whole flight, rather than a transit caption that gets replaced
 * by a different landed card. Both avatars and the connector are on screen
 * from the first frame; the badge counts (possibly-collapsed, see below)
 * relationship steps rather than raw camera stops, ticking up live as each
 * one completes (`upTo`, from App.jsx's onSegment), and the breadcrumb strip
 * beneath it fills in the same way, fully visible while the chain is still
 * building. Landing just finishes what's already there: the avatars scale
 * up (a CSS transition on their size, not a swap of components), the
 * relation sentence fades in, and the breadcrumb stays open, exactly as it
 * was mid-flight — seeing how two people connect shouldn't take an extra
 * tap. The badge still becomes a real toggle button (tap to collapse the
 * chain, tap again to bring it back), pulsing once, briefly, to hint it's
 * interactive. Each hop in the chain is itself tappable: it briefly
 * highlights that person's bubble out on the tree (BubbleTree's
 * pulseBubble) so you can see where a step actually lives without losing
 * this card. Auto-dismisses 15s after landing if the chain is left
 * collapsed; expanding it back cancels that for good, and it stays up
 * until "Done" is tapped.
 */
export default function FlightCaption({ graph, order, upTo, landed, onDone, onPeek }) {
  // Chain starts expanded on landing — as if the badge had already been
  // tapped — rather than making that a required extra step to see how two
  // people actually connect.
  const [chainOpen, setChainOpen] = useState(true);
  const [badgeTapped, setBadgeTapped] = useState(false);

  useEffect(() => {
    if (!landed || chainOpen) return;
    const t = setTimeout(() => onDone?.(), 15000);
    return () => clearTimeout(t);
  }, [landed, chainOpen, onDone]);

  if (!order || order.length < 2) return null;
  const originId = order[0];
  const origin = graph.byId.get(originId);
  const target = graph.byId.get(order[order.length - 1]);
  const targetName = (target?.display_name || '').trim();
  const first = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';

  // Turn-by-turn: each hop's relation to the person immediately before it in
  // the chain, not to the viewer — always resolvable, since adjacent path
  // nodes are always directly connected by exactly one real edge (parent/
  // child/partner/sibling). Relation-to-viewer (what this used to show)
  // degrades to a generic "Relative" for anyone reached via an in-law or
  // sideways branch, which is why long chains used to read as a string of
  // "Relative"s in a row.
  //
  // One collapse on top of that: siblings have no direct edge of their own
  // (see graph.js) — the camera still has to visit their shared parent to
  // get from one to the other, since that parent is the only real drawn
  // line connecting them (the flight's line-lighting can only light real
  // edges). But narrating that stop as its own word reads as "Father's
  // Father's Son" for what is actually just "Father's Brother" — so two
  // hops that go up to a shared parent and immediately back down to their
  // other child collapse into one sibling crumb. The camera still visits
  // every real stop (hops/shownHops below stay in terms of the full path);
  // only the words simplify.
  const hops = order.length - 1;
  const crumbs = [];
  for (let i = 1; i < order.length; ) {
    const mid = order[i];
    if (i + 1 < order.length) {
      const a = order[i - 1];
      const b = order[i + 1];
      const midIsSharedParent =
        graph.parents(a).some((p) => p.id === mid) && graph.parents(b).some((p) => p.id === mid);
      if (midIsSharedParent) {
        crumbs.push({ label: relationLabel(graph, a, b), toIndex: i + 1 });
        i += 2;
        continue;
      }
    }
    crumbs.push({ label: relationLabel(graph, order[i - 1], mid), toIndex: i });
    i += 1;
  }
  // revealedUpTo: how far the camera has actually travelled (an order-index,
  // real hops — unaffected by wording collapse), used to decide which crumbs
  // have been passed. shownCrumbs: the badge's own number — how many of the
  // (possibly collapsed) crumbs above are fully revealed. These intentionally
  // differ during a sibling-detour: the badge holds rather than ticking up
  // for the "extra" real hop through the shared parent, then jumps once the
  // camera reaches the sibling — never overshooting past the final count
  // (crumbs.length) the way counting raw camera hops would, so the badge and
  // the chain text underneath it always agree once landed.
  const revealedUpTo = landed ? hops : Math.min(upTo, hops);
  const shownCrumbs = landed ? crumbs.length : crumbs.filter((c) => c.toIndex <= revealedUpTo).length;

  const relation = landed ? relationLabel(graph, originId, order[order.length - 1]) : null;
  const avatarSize = landed ? 30 : 20;
  // Visible & building while in transit; once landed, collapsed behind the
  // badge by default (chainOpen starts false) until tapped back open.
  const chainVisible = !landed || chainOpen;

  const toggleChain = () => {
    setChainOpen((v) => !v);
    setBadgeTapped(true);
  };

  return (
    <div className={`flight-card${landed ? ' flight-card--landed' : ''}`} role="status" aria-live="polite">
      <div className="flight-card__chain">
        <span className="flight-card__node">
          <Avatar person={origin} size={avatarSize} />
          <span className="flight-card__node-name">{first(origin)}</span>
        </span>
        <button
          type="button"
          className={`flight-card__connector${landed && !badgeTapped ? ' flight-card__connector--pulse' : ''}`}
          onClick={landed ? toggleChain : undefined}
          aria-label={landed ? 'Show the full relationship chain' : undefined}
          aria-expanded={landed ? chainOpen : undefined}
          tabIndex={landed ? 0 : -1}
        >
          <span className="flight-card__count">{shownCrumbs}</span>
        </button>
        <span className="flight-card__node">
          <Avatar person={target} size={avatarSize} />
          <span className={`flight-card__node-name${landed || revealedUpTo >= hops ? '' : ' flight-card__node-name--pending'}`}>
            {landed ? first(target) : (revealedUpTo >= hops ? targetName : '')}
          </span>
        </span>
      </div>

      {landed && (
        <p className="flight-card__rel">
          {targetName} is {first(origin)}&apos;s <strong>{relation.toLowerCase()}</strong>
        </p>
      )}

      <div className={`flight-card__breadcrumb${chainVisible ? ' flight-card__breadcrumb--open' : ''}`}>
        <div className="flight-card__breadcrumb-inner">
          {/* A possessive chain reads as one flowing phrase — "Father's
              Brother's Daughter's Daughter" — rather than discrete
              arrow-separated labels, matching how the headline relation
              sentence above it is phrased. Every word but the last takes the
              's; the last is the terminal noun describing the target's role. */}
          {crumbs.map((c, i) => (
            <button
              key={i}
              type="button"
              className={`flight-card__crumb${c.toIndex <= revealedUpTo ? ' flight-card__crumb--visible' : ''}`}
              onClick={landed ? () => onPeek?.(order[c.toIndex]) : undefined}
              tabIndex={landed && chainOpen ? 0 : -1}
            >
              {c.label}{i < crumbs.length - 1 ? "'s" : ''}
            </button>
          ))}
        </div>
      </div>

      {landed && <button className="flight-card__done" onClick={() => onDone?.()}>Done</button>}
    </div>
  );
}
