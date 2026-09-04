/**
 * The page the browser lands on once Cloud hands the authorization code back.
 *
 * Served from the loopback listener, under a `default-src 'none'` policy that
 * only relaxes `style-src` — so everything is inline and there are no images or
 * webfonts to fetch. Colours mirror the Cloud palette and follow the operating
 * system's light/dark preference.
 */
export function callbackHtml(success: boolean) {
  const title = success ? 'CLI authorized' : 'Authorization failed';
  const status = success ? 'Connected' : 'Failed';
  const heading = success ? 'hypequery CLI is authorized' : 'Authorization failed';
  const message = success
    ? 'You can close this window and return to your terminal.'
    : 'Return to your terminal and run the login command again.';
  const state = success ? 'ok' : 'bad';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · hypequery</title>
<style>
:root{
color-scheme:light dark;
--bg:#faf9f7;--panel:#ffffff;--border:rgba(0,0,0,.08);
--text:#1a1a1a;--muted:#5a5d63;--dim:#8b8d92;
--ok:#22a06b;--ok-soft:rgba(34,160,107,.12);
--bad:#dc2626;--bad-soft:rgba(220,38,38,.10);
}
@media (prefers-color-scheme:dark){:root{
--bg:#0c0e14;--panel:#161922;--border:rgba(255,255,255,.07);
--text:#f5f3ee;--muted:#a0a3ad;--dim:#8b8f99;
--ok:#34d399;--ok-soft:rgba(52,211,153,.12);
--bad:#f87171;--bad-soft:rgba(248,113,113,.12);
}}
*{box-sizing:border-box}
html,body{height:100%}
body{
margin:0;padding:24px;background:var(--bg);color:var(--text);
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
display:flex;align-items:center;justify-content:center;
-webkit-font-smoothing:antialiased;
}
.wordmark{
position:fixed;top:26px;left:30px;
font-size:14px;font-weight:700;letter-spacing:-.035em;
}
main{width:100%;max-width:400px;background:var(--panel);border:1px solid var(--border);padding:28px}
.status{
display:inline-block;padding:5px 9px;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
font-size:11px;text-transform:uppercase;letter-spacing:.1em;
color:var(--${state});background:var(--${state}-soft);
}
h1{margin:20px 0 0;font-size:23px;font-weight:500;letter-spacing:-.025em;line-height:1.25}
p{margin:10px 0 0;font-size:13.5px;line-height:1.65;color:var(--muted)}
.foot{
margin-top:24px;padding-top:17px;border-top:1px solid var(--border);
font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
font-size:11.5px;letter-spacing:.04em;color:var(--dim);
}
@media (max-width:420px){.wordmark{position:static;margin-bottom:18px}body{flex-direction:column;align-items:stretch;justify-content:flex-start;padding-top:30px}}
</style>
</head>
<body>
<div class="wordmark">hypequery</div>
<main>
<span class="status">${status}</span>
<h1>${heading}</h1>
<p>${message}</p>
<div class="foot">${success ? 'Safe to close this tab' : 'hypequery login'}</div>
</main>
</body>
</html>`;
}
