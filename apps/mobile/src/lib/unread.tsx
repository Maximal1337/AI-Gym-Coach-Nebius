import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Unread-reply badge (Linear doc "Durable Coach Replies"): while the app
 * is foregrounded, a coach reply shouldn't interrupt with a native alert
 * the user is already looking at the app to not need — but they still
 * need *some* signal if they're on a different tab than chat. This is
 * that signal: a small count on the chat tab's own icon, the same
 * "+1/+2" pattern any messaging app uses instead of a banner while open.
 */

interface UnreadContextValue {
  count: number;
  /** No-ops while the chat tab is the one currently focused — a push still
   * fires even when the direct live response already arrived (sendPushForTurn
   * doesn't know the client already got its answer), and a "+1" on the tab
   * you're already looking at would just read as a bug. */
  increment: () => void;
  clear: () => void;
  /** Called by the chat screen's own focus effect — a ref, not state, so increment() always reads the current value rather than one captured in a stale closure. */
  setChatFocused: (focused: boolean) => void;
}

const UnreadContext = createContext<UnreadContextValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const chatFocused = useRef(false);
  const value = useMemo(
    () => ({
      count,
      increment: () => {
        if (!chatFocused.current) setCount((c) => c + 1);
      },
      clear: () => setCount(0),
      setChatFocused: (focused: boolean) => {
        chatFocused.current = focused;
        if (focused) setCount(0);
      },
    }),
    [count],
  );
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadContextValue {
  const ctx = useContext(UnreadContext);
  if (!ctx) throw new Error('useUnread must be used within UnreadProvider');
  return ctx;
}
