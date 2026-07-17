import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PRINT_FOLIO, PHONE_FOLIO } from '../../lib/typeset.js';
import { useTypeset } from './KeepsakeBook.jsx';
import BookPage from './BookPage.jsx';

/*
 * The scroll reader, rebuilt on the SAME typeset pages as the book — a
 * vertical pager: one fixed magazine page per screen, mandatory scroll-snap
 * so a swipe always lands exactly one page on, never in between. The old
 * scroll reader flowed variable-height spreads with proximity snapping,
 * which could rest half-way between pages (and had to, because the chapters
 * spread was taller than the screen — the typesetter removed that problem).
 * Each page rises and settles softly as it arrives; reduced motion reads
 * statically. Print still uses the hidden .ks-printflow copy, untouched.
 */

const PHONE_MQ = '(max-width: 699px)';

export default function KeepsakePager({ spreads, subjectName, edition, onEditSection, onProgress }) {
  const [phone, setPhone] = useState(
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_MQ).matches : false),
  );
  const canvas = phone ? PHONE_FOLIO : PRINT_FOLIO;
  const { pages, measurer } = useTypeset(spreads, canvas, onEditSection);
  const rootRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_MQ);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Fit one page inside one screen (minus the floating chrome), never above
  // 1:1 — same rule as the book's stage.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      setScale(Math.min((el.clientWidth - 32) / canvas.w, (el.clientHeight - 116) / canvas.h, 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvas]);

  // One observer drives both the arrive animation and the progress hairline.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !pages) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('ks-pager__slot--in');
          onProgress?.((Number(e.target.dataset.idx) + 1) / pages.length);
        }
      },
      { root, threshold: 0.55 },
    );
    root.querySelectorAll('.ks-pager__slot').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [pages]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pages) return <div ref={rootRef} className="ks-pager">{measurer}</div>;

  return (
    <div ref={rootRef} className="ks-pager">
      {pages.map((p, i) => (
        <section className="ks-pager__slot" data-idx={i} key={p.pageKey}>
          <div className="ks-pager__fit" style={{ width: canvas.w * scale, height: canvas.h * scale }}>
            <div className="ks-pager__zoom" style={{ width: canvas.w, height: canvas.h, transform: `scale(${scale})` }}>
              <BookPage
                page={p}
                pageNo={i + 1}
                canvas={canvas}
                subjectName={subjectName}
                edition={edition}
                onEditSection={onEditSection}
              />
            </div>
          </div>
        </section>
      ))}
      {measurer}
    </div>
  );
}
