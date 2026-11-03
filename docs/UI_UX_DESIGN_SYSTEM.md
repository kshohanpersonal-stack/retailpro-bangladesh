# Ponno — UI/UX Design System (Premium Light)

## 1. Principles
Fast cashier workflows first; calm, information-dense but uncluttered screens; natural Bangladeshi business Bengali; one consistent light theme; every visible control does real work.

## 2. Color tokens
| Token | Value | Use |
|---|---|---|
| --bg | #F6F7F9 | app background |
| --surface | #FFFFFF | cards, tables, modals |
| --surface-2 | #F0F2F5 | subtle fills, hover |
| --border | #E3E6EA | dividers, inputs |
| --text | #1A2233 | primary text |
| --text-2 | #5B6472 | secondary text |
| --text-3 | #8A93A2 | placeholders, hints |
| --primary | #0E6B4F | brand green (buttons, active nav) |
| --primary-600 | #0A5A42 | hover |
| --primary-50 | #E7F3EE | active nav bg, chips |
| --accent | #B7791F | gold accents, warnings-lite |
| --success | #157347 | positive |
| --danger | #C0392B | destructive, due |
| --warning | #B7791F | low stock, expiry |
| --info | #1F6FEB | links, info |

## 3. Typography
- Bengali+Latin: **Hind Siliguri** (embedded TTF/OTF; Regular 400, Medium 500, SemiBold 600, Bold 700). Fallback: system-ui, 'Noto Sans Bengali', sans-serif.
- Scale: display 24/600, h1 20/600, h2 16/600, body 14/400, small 12.5/400, table 13.5/400, POS totals 22/700.
- Line-height 1.55 body (Bengali needs headroom for কার/ফলা), 1.3 headings.

## 4. Geometry
Radius: cards 12px, buttons/inputs 8px, chips 999px. Spacing unit 4px (4/8/12/16/24/32). Card padding 16–20px. Shadow: `0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.06)`; modal `0 12px 32px rgba(16,24,40,.18)`. Icons 18px (nav 20px). Table row 40px, compact 34px. Buttons: sm 30px, md 36px, lg 44px (POS). Inputs 36px (POS search 44px).

## 5. Layout
- Sidebar 232px (collapsible to 64px), white surface, grouped nav with section labels; active item = primary-50 bg + primary text + 3px left bar.
- Topbar 56px: page title, global search, business name, user menu, date.
- Content max-width none, padding 24px; dashboard grid 12-col, KPI cards span 3 (min 220px), reflow at <1280px.
- Min window 1024×680; resize/maximize/restore; tables horizontal-scroll with sticky header; modals max-height 85vh with internal scroll; DPI-aware (Chromium handles scaling; SVG icons stay crisp).

## 6. Components
Buttons (primary/secondary/ghost/danger, loading spinner, disabled), inputs (label, hint, error, prefix/suffix), selects, date inputs, search boxes (debounced), tables (sort indicators, pagination 25/50/100, row actions, empty state, loading skeleton), modals (sm 420/md 640/lg 900, confirm variant), toasts (top-right, success/error/info, 4s), badges/chips (status colors), KPI cards (label, value, delta, icon), tabs, drawers (POS payment), context menus, print-preview pane.

## 7. Navigation (Bengali labels)
ড্যাশবোর্ড · পিওএস · সেলস · প্রোডাক্ট · স্টক · ক্যাটাগরি ও ব্র্যান্ড · পারচেজ · কাস্টমার · সাপ্লায়ার · বাকি আদায় · সাপ্লায়ার পেমেন্ট · খরচ · হিসাব · রিপোর্ট · ইউজার · ব্যাকআপ · সেটিংস · About

## 8. POS specifics
Left: search + scan input (autofocus, Enter adds, repeated scans increment), product quick-grid; right: cart table (qty stepper, unit select, price/discount inline with permission), totals panel, customer picker, payment drawer (method split, paid/due auto-calc), big charge button (F9), shortcuts: F2 search, F4 customer, F8 discount, F9 pay, Esc close. Receipt preview modal after sale with print/PDF/new-sale.

## 9. States
Every list: loading skeleton, empty state (Bengali guidance + primary action), error state (retry). Forms: inline validation in Bengali, submit disabled while pending, double-submit guard. Destructive actions: confirm modal naming the record. Financial corrections: reason required.

## 10. Accessibility & robustness
Focus rings, keyboard navigability, aria labels, sufficient contrast (AA), long Bengali names ellipsize with tooltip, numbers right-aligned tabular, no clipped যুক্তাক্ষর (line-height + padding verified), all screens tested with realistic data.
