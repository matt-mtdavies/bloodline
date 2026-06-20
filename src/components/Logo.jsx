/*
 * The Bloodline mark: two bound circles (a union) with a third budding below
 * (a child) — a family in three bubbles, echoing the tree itself. White
 * knockout rings keep the overlaps crisp on any ground. The bubbles pop in on
 * load with a gentle stagger.
 */
export default function Logo({ size = 30, animate = true }) {
  const cls = 'logo' + (animate ? ' logo--in' : '');
  return (
    <svg
      className={cls}
      width={size}
      height={(size * 40) / 42}
      viewBox="0 0 42 40"
      fill="none"
      aria-hidden="true"
    >
      <circle className="logo__a" cx="15" cy="17" r="10" fill="#c2603a" stroke="#fff" strokeWidth="2.4" />
      <circle className="logo__b" cx="27" cy="17" r="10" fill="#3f5e4e" stroke="#fff" strokeWidth="2.4" />
      <circle className="logo__c" cx="21" cy="29" r="6.6" fill="#b08642" stroke="#fff" strokeWidth="2.4" />
    </svg>
  );
}
