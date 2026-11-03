---
name: ticket-scout
description: Find and compare resale and primary tickets for a sporting event or concert across free public ticket sites (TickPick, SeatGeek, Gametime, Vivid Seats, StubHub, Ticketmaster, the team's official site), report the cheapest all-in prices and best values, and optionally track prices over time. Use when the user asks about ticket prices, cheap or discounted seats, "get-in" prices, or wants a game or show watched for a price drop. Look-up only; never buys.
allowed-tools: Bash(agent-browser:*), WebSearch, WebFetch, Read, Write, Edit
---

# Ticket Scout

Free ticket price look-up. Uses only public web pages through `agent-browser`,
`WebSearch` and `WebFetch`. No API keys, no paid scrapers, no accounts.

**Hard rules**

- Look up only. Never log in, never add to cart past the price view, never
  enter payment, contact or personal details, and never complete a purchase.
  Hand the user the listing link and let them buy it themselves.
- Never invent a price. Every price you report comes from a page you actually
  loaded, with the site and the time you saw it. If a site blocks you, say so.
- Always compare **all-in** prices (ticket plus fees, per ticket). Sites that
  show prices before fees will look cheaper than they are.

## 1. Pin down the event

Before searching, make sure you know:

| Field | Example |
|-------|---------|
| Event | Florida State vs. Florida (football) |
| Date / venue | Fri Nov 27, Doak Campbell Stadium, Tallahassee |
| Quantity | 2 tickets, seated together |
| Budget or target | under $75 each all-in |
| Seat preferences | any seat / lower level only / no end zone / shade side |

If the user named a team but no game, look up the remaining schedule (the
team's official athletics site first, e.g. `seminoles.com` for FSU) and ask
which game, or price all upcoming home games if they want an overview.
Default quantity is 2 if they do not say.

## 2. Sources, in order

Check at least four of these per run. Start with the no-fee or fee-inclusive
sites because their numbers need no correction.

| Site | Notes |
|------|-------|
| **TickPick** (`tickpick.com`) | No buyer fees; listed price is the real price. Often the cheapest. |
| **Gametime** (`gametime.co`) | Shows all-in prices; strong on last-minute deals. |
| **SeatGeek** (`seatgeek.com`) | Turn on the "show prices with estimated fees" toggle. Has a Deal Score. |
| **Vivid Seats** (`vividseats.com`) | Toggle "show prices with estimated fees". |
| **StubHub** (`stubhub.com`) | Set quantity and use the "include fees" toggle. Heavy bot protection. |
| **Ticketmaster** (`ticketmaster.com`) | Official primary plus verified resale for many schools (FSU uses it). Check "Show prices with estimated fees". |
| **Official site** (e.g. `seminoles.com/tickets`) | Face value and any remaining primary inventory or promos. |
| **Aggregators** (`ticketiq.com`, Google search snippets) | Quick "starting at" numbers when a site blocks the browser. |

Also worth a quick `WebSearch` for the event plus "tickets" and "promo code",
and fan communities (for FSU: r/fsu, Tomahawk Nation forums, Warchant) where
fans sell at face value. Report those as leads only, and remind the user to
pay with a protected method (no Zelle/Venmo friends-and-family to strangers).

## 3. How to read each site

```bash
agent-browser open "https://www.tickpick.com/search?q=florida+state+football"
agent-browser wait --load networkidle
agent-browser snapshot -i          # find the right event and quantity controls
agent-browser click @eN            # open the event
agent-browser snapshot -c          # read listings: section, row, qty, price
```

- Set the ticket quantity first; prices and available listings change with it.
- Sort by price low to high where the site allows.
- Scroll once or twice (`agent-browser scroll down 1500`) to load more listings.
- Capture for each good listing: section, row, quantity available, all-in price
  per ticket, and the listing or event URL.
- Use `WebFetch` on an event URL when the browser is slow; some sites render
  enough server-side to read a "from $X" price.

**If a site blocks you** (captcha, "Access denied", "Pardon the interruption",
blank page): do not try to solve or bypass the captcha. Note "blocked" for that
site, fall back to a `WebSearch` for `"<event>" tickets site:<domain>` or the
aggregator snippet, label that number as "search snippet, not verified", and
move on. Close the browser between sites if pages start failing
(`agent-browser close`).

## 4. Judging "reasonable" vs. "heavily discounted"

Work out a baseline, then rank listings against it:

- **Face value**: from the official site or Ticketmaster primary.
- **Median resale**: the middle of the all-in prices you collected.
- A **deal** is at or below face value, or 30%+ under the median for a
  comparable section. A **steal** is 50%+ under the median.

Useful context to pass on:

- College football resale usually falls in the last 24 to 48 hours before
  kickoff, and often again in the hours just before the game, especially for
  low-stakes matchups, bad weather forecasts, or a team on a losing streak.
  Rivalry and homecoming games (for FSU: Florida, Miami, Clemson) tend to hold
  their price or rise.
- Upper deck and end zone seats are where the cheapest get-in prices live.
- Single seats are often much cheaper than pairs; mention this if the user
  might split up.
- Buying the day of the game is cheaper on average but riskier for
  sell-outs. Say so; do not decide for the user.

## 5. Report format

Keep it scannable for chat. Example:

```
FSU vs. NC State, Sat Nov 21, Doak Campbell (2 tickets)
Checked 3:40 PM ET

Cheapest all-in per ticket
1. TickPick: $38, Sec 34 Row 52 (upper end zone) <link>
2. Gametime: $41, Sec 4 Row 60 <link>
3. SeatGeek: $44, Sec 33 Row 48, Deal Score "Great" <link>

Best value (lower level)
- Vivid Seats: $79, Sec 18 Row 22 (sideline) <link>

Baseline: face value ~$60, median resale $72
Blocked: StubHub (captcha), price from search snippet ~$45, not verified
Take: prices are soft for this game; waiting until Friday night is a
reasonable bet if you are flexible.
```

Always include the time checked, links, and which sites were blocked or skipped.

## 6. Price tracking (optional)

If the user wants a game watched, keep a log in the workspace at
`ticket-watch/<event-slug>.md` with one line per check:

```
2026-11-18T20:40:00Z | TickPick | $38 | Sec 34 Row 52 | qty 2
```

Then offer a scheduled task (for example twice a day, then hourly on game day)
that re-runs this skill, appends to the log, and messages the user only when
the cheapest all-in price drops below their target or falls 15%+ from the
last report. Stop the task after kickoff.
