/*
 * Atlas — the opt-in preference.
 *
 * Per-viewer and localStorage-backed, deliberately NOT tree data: turning a
 * new tree view on for yourself must never change what anyone else in the
 * family sees, and it must never touch the shared record. Same convention as
 * canopyPref.js and kinTerms.js — a tiny useSyncExternalStore store, no
 * server round trip.
 *
 * Default is OFF. With it off, App.jsx never renders AtlasTree at all, so
 * not one byte of the existing organic/chart/canopy/list render path
 * executes differently — the isolation guarantee is structural, not a
 * promise.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'bl_atlas_enabled';
const listeners = new Set();

let enabled = read();

function read() {
  try {
    return window.localStorage?.getItem(KEY) === '1';
  } catch {
    return false; // private mode / storage disabled — the default holds
  }
}

function emit() {
  for (const fn of listeners) fn();
}

export function isAtlasEnabled() {
  return enabled;
}

export function setAtlasEnabled(on) {
  const next = !!on;
  if (next === enabled) return;
  enabled = next;
  try {
    if (next) window.localStorage?.setItem(KEY, '1');
    else window.localStorage?.removeItem(KEY);
  } catch {
    /* The preference is a convenience, not state worth failing a save over. */
  }
  emit();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAtlasEnabled() {
  return useSyncExternalStore(subscribe, () => enabled, () => false);
}
