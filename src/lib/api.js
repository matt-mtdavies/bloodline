const KEY = 'bl:session';

export const getSession = () => localStorage.getItem(KEY);
export const setSession = (v) => v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY);
export const clearSession = () => localStorage.removeItem(KEY);

// Drop-in replacement for fetch() that adds the session header when present.
export function apiFetch(url, opts = {}) {
  const session = getSession();
  const headers = { ...(opts.headers || {}) };
  if (session) headers['X-Bl-Session'] = session;
  return fetch(url, { ...opts, headers });
}
