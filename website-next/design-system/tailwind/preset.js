/**
 * hypequery — Tailwind preset
 * Drop into your tailwind.config.js as a preset and the design
 * tokens become available as Tailwind utilities — bg-bg-card,
 * text-text-muted, font-mono, rounded-r-lg, shadow-card, etc.
 *
 * Works with Tailwind v3.  For Tailwind v4, see globals.css
 * (uses @theme blocks instead of a JS config).
 *
 * Usage:
 *   // tailwind.config.js
 *   module.exports = {
 *     presets: [require('./design-system/tailwind/preset.js')],
 *     content: ['./src/**\/*.{ts,tsx,jsx,html}'],
 *   };
 *
 * Also pull in design-system/tailwind/globals.css from your entry
 * stylesheet to get the theme variables, paper-noise overlay, and
 * highlight.js code-panel styling.
 */

module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // these reference CSS vars declared in globals.css, so they
        // flip automatically when [data-theme] changes
        bg:           'var(--bg)',
        'bg-alt':     'var(--bg-alt)',
        'bg-card':    'var(--bg-card)',
        'bg-code':    'var(--bg-code)',
        'code-text':  'var(--code-text)',

        border:        'var(--border)',
        'border-strong': 'var(--border-strong)',

        text:          'var(--text)',
        'text-muted':  'var(--text-muted)',
        'text-dim':    'var(--text-dim)',

        accent:        'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'accent-hi':   'var(--accent-hi)',

        success:       'var(--status-green, #22a06b)',
        'success-soft':'var(--status-green-soft, rgba(34,160,107,0.12))',

        // cloud-only — useful if you're building cloud-app screens
        cloud: {
          bg:    'var(--bg, #07090f)',
          bg1:   'var(--bg1, #0d1117)',
          bg2:   'var(--bg2, #111827)',
          bg3:   'var(--bg3, #1a2236)',
          bg4:   'var(--bg4, #1f2937)',
          indigo:    '#6366f1',
          'indigo-hi':  '#818cf8',
          'indigo-dim': 'rgba(99,102,241,0.12)',
          'indigo-mid': 'rgba(99,102,241,0.22)',
          cyan:   '#22d3ee',
          green:  '#34d399',
          yellow: '#fbbf24',
          red:    '#f87171',
        },
      },

      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      fontSize: {
        // marketing ramp — clamped values stay clamped
        display: ['clamp(42px, 6.2vw, 84px)', { lineHeight: '1.02', letterSpacing: '-0.04em', fontWeight: '800' }],
        h1:      ['clamp(32px, 4.4vw, 58px)', { lineHeight: '1.05', letterSpacing: '-0.034em', fontWeight: '800' }],
        h2:      ['clamp(30px, 3.4vw, 46px)', { lineHeight: '1.08', letterSpacing: '-0.032em', fontWeight: '800' }],
        h3:      ['26px', { lineHeight: '1.18', letterSpacing: '-0.022em', fontWeight: '700' }],
        h4:      ['18px', { lineHeight: '1.3',  letterSpacing: '-0.018em', fontWeight: '700' }],
        // body
        'body-lg': ['18px', { lineHeight: '1.65' }],
        body:      ['16px', { lineHeight: '1.65' }],
        'body-sm': ['14px', { lineHeight: '1.55' }],
        // meta + mono utilities
        meta:    ['13px',   { lineHeight: '1.5' }],
        eyebrow: ['11px',   { lineHeight: '1',   letterSpacing: '0.22em', fontWeight: '600' }],
        micro:   ['10.5px', { lineHeight: '1',   letterSpacing: '0.12em', fontWeight: '500' }],
      },

      letterSpacing: {
        display: '-0.04em',
        title:   '-0.032em',
        tight:   '-0.022em',
        snug:    '-0.012em',
        eyebrow: '0.22em',
        caps:    '0.12em',
      },

      borderRadius: {
        DEFAULT: '4px',   // overrides Tailwind's 0.25rem default
        sm:  '3px',       // cloud default
        md:  '4px',
        lg:  '8px',
        pill:'100px',
      },

      maxWidth: {
        container: '1280px',
        prose:     '560px',
        headline:  '680px',
      },

      spacing: {
        // landing-page rhythm — match the original css
        section: '96px',
        hero:    '140px',
        '4.5':   '18px',
        '5.5':   '22px',
      },

      boxShadow: {
        DEFAULT: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)',
        card:    '0 1px 3px rgba(0,0,0,0.05), 0 12px 40px rgba(0,0,0,0.06)',
        glow:    '0 0 6px var(--status-green, #22a06b)',
        'card-dark': '0 1px 3px rgba(0,0,0,0.40), 0 16px 48px rgba(0,0,0,0.40)',
      },

      transitionDuration: {
        DEFAULT: '140ms',
        fast:    '120ms',
        med:     '200ms',
        slow:    '300ms',
      },

      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
        out:     'cubic-bezier(0.22, 1, 0.36, 1)',
        pop:     'cubic-bezier(0.4, 1.4, 0.6, 1)',
      },

      backdropBlur: {
        nav: '14px',
      },

      animation: {
        'marquee':   'marquee 50s linear infinite',
        'blink-dot': 'blink-dot 1.2s infinite',
        'run-pulse': 'run-pulse 1s infinite',
      },

      keyframes: {
        marquee:    { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        'blink-dot':{ '0%,100%': { opacity: '0.2' }, '50%': { opacity: '1' } },
        'run-pulse':{ '0%,100%': { opacity: '1' },   '50%': { opacity: '0.7' } },
      },
    },
  },

  plugins: [
    // text-wrap helpers — common on hypequery headlines
    function ({ addUtilities }) {
      addUtilities({
        '.text-balance': { 'text-wrap': 'balance' },
        '.text-pretty':  { 'text-wrap': 'pretty' },
      });
    },
  ],
};
