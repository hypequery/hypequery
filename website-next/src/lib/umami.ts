type UmamiPayload = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    umami?: {
      track: (eventName: string, payload?: UmamiPayload) => void;
    };
  }
}

export function trackUmamiEvent(eventName: string, payload?: UmamiPayload) {
  if (typeof window === 'undefined' || typeof window.umami?.track !== 'function') {
    return;
  }

  window.umami.track(eventName, payload);
}
