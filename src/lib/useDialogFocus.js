/*
 * Focus management for the app's dialogs and sheets.
 *
 * Real finding from an Impeccable critique of the profile surface: opening a
 * person profile left `document.activeElement` on <body>, and eight
 * consecutive Tab presses landed on the zoom controls and the bottom dock —
 * every one of them OUTSIDE the dialog. Meanwhile `.profile` declares
 * `role="dialog" aria-modal="true"`, which tells assistive tech the rest of
 * the page does not exist. So the only elements a keyboard user could reach
 * were precisely the ones AT had been told to ignore: 76 controls in the
 * sheet, none of them reachable, and Escape the only available action.
 *
 * This is the same shape of fix already proven on ChartTree's children
 * popover (see `childrenPopRef`/`lastFocusBeforePopRef` there), generalized
 * so every sheet shares one implementation instead of eight copies drifting
 * apart.
 *
 * Three jobs, in order:
 *   1. Remember what had focus before the dialog opened.
 *   2. Move focus INTO the dialog on open, and keep Tab/Shift-Tab inside it.
 *   3. Put focus back where it came from on close.
 *
 * Deliberately NOT doing `inert` on the rest of the page: `aria-modal="true"`
 * already makes modern screen readers ignore outside content, the trap below
 * already makes it unreachable by keyboard, and marking ancestors inert in a
 * tree where the sheet renders as a sibling of the canvas is a much larger
 * change with real regression surface. Revisit only with a reported gap.
 */
import { useEffect, useRef } from 'react';

// Standard focusable set, minus anything explicitly removed from the tab
// order. `:not([disabled])` matters for the pill-pick options and disabled
// primary buttons several of these sheets render.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableWithin(root) {
  if (!root) return [];
  // offsetParent filters out anything display:none'd by a collapsed
  // disclosure — a hidden control must not swallow a Tab stop. (position:
  // fixed elements have a null offsetParent too, hence the rect fallback.)
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el.getBoundingClientRect().width > 0,
  );
}

/**
 * @param {{current: HTMLElement|null}} containerRef  the dialog's own element
 * @param {boolean} active                            is the dialog open
 * @param {object} [opts]
 * @param {string} [opts.initialFocus]  selector for the element to focus on
 *   open; falls back to the first focusable, then the container itself
 * @param {unknown} [opts.contentKey]   changes when the dialog swaps content
 *   in place without closing (PersonSheet stays mounted and swaps `person`
 *   when you tap a relationship chip). If focus was orphaned onto <body> by
 *   that swap, it is pulled back into the container.
 */
export function useDialogFocus(containerRef, active, { initialFocus, contentKey } = {}) {
  // Store-on-open / restore-on-close. Keyed on `active` alone so a content
  // swap inside an open dialog never re-steals focus from whatever the user
  // is currently typing in.
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement;
    // Wait a frame: several of these sheets animate in, and a couple render
    // their first focusable only after an effect of their own has run.
    const raf = requestAnimationFrame(() => {
      const root = containerRef.current;
      if (!root) return;
      if (root.contains(document.activeElement)) return; // already inside
      const target =
        (initialFocus && root.querySelector(initialFocus)) || focusableWithin(root)[0] || root;
      if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      target.focus?.();
    });
    return () => {
      cancelAnimationFrame(raf);
      // Only restore if the element is still in the document — a re-root, a
      // merge, or a delete can remove whatever opened this dialog.
      if (previous && document.contains(previous) && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [active, containerRef, initialFocus]);

  // Content swapped underneath an open dialog: if that removed the focused
  // element, focus falls to <body> and the keyboard user is stranded outside
  // again — the exact bug this hook exists to fix, just re-entered sideways.
  //
  // Deliberately skips the FIRST run for each open. Without that guard this
  // effect fires synchronously on mount, grabs focus onto the container, and
  // the open effect above then sees focus already inside and returns early —
  // so `initialFocus` never applies and a sheet whose whole job is typing
  // (MemorySheet, AddRelativeSheet) opens without the caret in its field.
  // Measured: the profile landed on `.profile`, not `.profile__close`.
  const lastContentKey = useRef(undefined);
  useEffect(() => {
    if (!active) { lastContentKey.current = undefined; return; }
    const first = lastContentKey.current === undefined;
    lastContentKey.current = contentKey;
    if (first) return; // the open effect owns initial focus
    const root = containerRef.current;
    if (!root) return;
    if (root.contains(document.activeElement)) return;
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    root.focus?.();
  }, [contentKey, active, containerRef]);

  // The trap itself.
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const items = focusableWithin(root);
      if (!items.length) {
        // Nothing focusable inside (a bare confirm, say) — keep focus on the
        // container rather than letting Tab escape to the page behind.
        e.preventDefault();
        root.focus?.();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      // Focus currently outside the dialog (it drifted, or never entered):
      // pull it to the correct end rather than letting Tab continue outside.
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture phase: several sheets stop propagation on their own keydown
    // handlers, which would otherwise swallow the trap.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, containerRef]);
}
