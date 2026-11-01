"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, AuthError } from "./client";

// Loads one API method with the on-device cache (client.js). Shows the
// cached copy immediately while a fresh one loads, so screens open fast on
// a slow network (spec 3.2), and flags fromCache for the offline bar.
export function useData(method, params, { onAuthError, skip = false } = {}) {
  const key = method + JSON.stringify(params || {});
  const [state, setState] = useState({ data: null, loading: !skip, error: null, fromCache: false, cachedAt: null });
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const authRef = useRef(onAuthError);
  authRef.current = onAuthError;

  const load = useCallback(
    async (extra = {}) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const r = await api(method, { ...(paramsRef.current || {}), ...extra });
        setState({ data: r.data, loading: false, error: null, fromCache: r.fromCache, cachedAt: r.cachedAt || null });
        return r.data;
      } catch (err) {
        if (err instanceof AuthError) authRef.current?.(err);
        setState((s) => ({ ...s, loading: false, error: err.message }));
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  useEffect(() => {
    if (skip) return;
    load();
  }, [load, skip]);

  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === "function" ? fn(s.data) : fn })) };
}
