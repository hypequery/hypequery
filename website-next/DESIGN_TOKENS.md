# Design Tokens - Tailwind Utilities

This document shows how to use your design system tokens with Tailwind utility classes.

## Colors

### Backgrounds
```tsx
className="bg-bg"          // Main background
className="bg-bg-alt"      // Alternate background
className="bg-bg-card"     // Card background
className="bg-bg-code"     // Code block background
```

### Text
```tsx
className="text-text"         // Primary text
className="text-text-muted"   // Muted text
className="text-text-dim"     // Dimmed text
className="text-code-text"    // Code text color
```

### Borders
```tsx
className="border-border"        // Default border
className="border-border-strong" // Stronger border
```

### Accent
```tsx
className="bg-accent"       // Accent background
className="bg-accent-soft"  // Soft accent background
className="bg-accent-hi"    // Highlight accent
className="text-accent"     // Accent text
```

### Status
```tsx
className="text-status-green"      // Success/green text
className="bg-status-green-soft"   // Soft green background
className="text-status-red"        // Error/red text
```

## Typography

### Font Families
```tsx
className="font-sans"  // Plus Jakarta Sans
className="font-mono"  // JetBrains Mono
```

### Font Sizes
```tsx
className="text-display"   // 42px - 84px (responsive)
className="text-h2"        // 30px - 46px (responsive)
className="text-h3"        // 26px
className="text-h4"        // 18px
className="text-body-lg"   // 18px
className="text-body"      // 16px
className="text-body-sm"   // 14px
className="text-meta"      // 13px
className="text-eyebrow"   // 11px (uppercase labels)
className="text-micro"     // 10.5px
```

### Font Weights
```tsx
className="font-regular"    // 400
className="font-medium"     // 500
className="font-semibold"   // 600
className="font-bold"       // 700
className="font-extrabold"  // 800
```

### Line Heights
```tsx
className="leading-tight"   // 1.05 (for display text)
className="leading-snug"    // 1.22 (for headings)
className="leading-normal"  // 1.55 (for body text)
className="leading-loose"   // 1.65 (for paragraphs)
className="leading-code"    // 1.7 (for code blocks)
```

### Letter Spacing
```tsx
className="tracking-display"  // -0.04em (tight, for large text)
className="tracking-h2"       // -0.032em
className="tracking-h3"       // -0.022em
className="tracking-body"     // 0
className="tracking-eyebrow"  // 0.22em (wide, uppercase)
className="tracking-micro"    // 0.12em
```

## Spacing

```tsx
className="p-1"   // 4px
className="p-2"   // 8px
className="p-3"   // 12px
className="p-4"   // 16px
className="p-5"   // 22px
className="p-6"   // 32px
className="p-7"   // 48px
className="p-8"   // 64px
className="p-9"   // 96px
className="p-10"  // 140px
```

Works with: `m-`, `p-`, `gap-`, `space-x-`, `space-y-`, `w-`, `h-`, etc.

## Border Radius

```tsx
className="rounded"       // 4px
className="rounded-lg"    // 8px
className="rounded-pill"  // 100px (fully rounded)
```

## Container

```tsx
className="max-w-container"  // 1280px max width
```

## Shadows

```tsx
className="shadow"       // Subtle shadow
className="shadow-card"  // Card shadow (more pronounced)
```

## Transitions

### Duration
```tsx
className="duration-fast"  // 120ms
className="duration"       // 140ms (default)
className="duration-med"   // 200ms
className="duration-slow"  // 300ms
```

### Easing
```tsx
className="ease"      // cubic-bezier(0.4, 0, 0.2, 1)
className="ease-out"  // cubic-bezier(0.22, 1, 0.36, 1)
className="ease-pop"  // cubic-bezier(0.4, 1.4, 0.6, 1) - bouncy
```

## Example Component Patterns

### Card
```tsx
<div className="bg-bg-card rounded-lg shadow-card p-6 border border-border">
  <h3 className="text-h3 font-semibold text-text leading-snug tracking-h3">
    Card Title
  </h3>
  <p className="text-body text-text-muted leading-normal mt-3">
    Card description text
  </p>
</div>
```

### Button (Primary)
```tsx
<button className="
  bg-accent text-white
  px-5 py-3 rounded
  font-medium text-body
  transition-all duration
  hover:bg-accent-hi
  shadow
">
  Click me
</button>
```

### Eyebrow Label
```tsx
<span className="
  text-eyebrow uppercase
  tracking-eyebrow font-semibold
  text-text-dim
">
  New Feature
</span>
```

### Display Heading
```tsx
<h1 className="
  text-display font-extrabold
  leading-tight tracking-display
  text-text
">
  Build analytics faster
</h1>
```

## Dark Mode

The theme automatically switches based on `data-theme` attribute:
- `data-theme="light"` - Light theme colors
- `data-theme="dark"` - Dark theme colors

All utilities automatically use the correct color for the current theme.
