# iZariam v2

TypeScript rewrite of the 2012 CodeIgniter game that lives in the repo root.
React + Express + PostgreSQL, reusing the original artwork and CSS unchanged.

The legacy PHP is **not** deleted. It still runs, and it is what this port is
verified against: the golden fixtures in `fixtures/` are dumped from it, and
`tools/extract-gamedata.py` reads its source to produce the balance tables.

## Layout

```
IZARIAM/
├─ izariam/ install/ index.php   legacy PHP, untouched
├─ design/                       34 MB of sprites and CSS, shared by both
├─ docker-compose.yml            legacy stack -- PHP 5.6 + MariaDB, :8080
└─ v2/
   ├─ packages/gamedata          balance tables extracted from data_model.php
   ├─ packages/rules             the game, as pure functions. No I/O.
   ├─ packages/db                Drizzle schema, migrations, seed, legacy import
   ├─ packages/shared            zod contracts shared by API and client
   ├─ apps/api                   Express
   ├─ apps/web                   Vite + React -- the game
   ├─ apps/admin                 Vite + React -- the staff panel
   ├─ fixtures/                  30,516 golden values dumped from the legacy
   ├─ tools/                     extraction and fixture dumpers
   └─ docker-compose.yml         this stack -- Postgres + API + web + admin
```

`design/` deliberately stays at the root rather than being copied in. The whole
premise of the port is that the original CSS is reused verbatim -- duplicating
34 MB of sprites would just let the two copies drift.

## Running it

```bash
cd v2
docker compose up -d --build
```

Then open <http://localhost:5175>. Schema migration and world seeding run
automatically in a one-shot `migrate` service before the API starts.

The legacy stack is independent and can run at the same time:

```bash
cd ..            # repo root
docker compose up -d          # http://localhost:8080
```

| | legacy | v2 |
|---|---|---|
| web | :8080 | :5175 |
| admin panel | — | :5174 |
| api | — | :3001 |
| database | MariaDB :3307 | Postgres :5432 |

Everything binds to `127.0.0.1`. Neither stack should ever face a network --
the legacy has an unauthenticated RCE in its installer, and this one is a
half-finished port.

## Without Docker

Needs Node 20+ and a Postgres on :5432.

```bash
npm install
npm run db:migrate && npm run db:seed
npm run -w @izariam/api start     # :3001
npm run -w @izariam/web dev       # :5175
npm run -w @izariam/admin dev     # :5174
```

## Tests

```bash
npm test                          # all three, in order
npm run test:rules                # 75 golden tests against the legacy
npm run gamedata:verify           # extracted tables vs the PHP fixture
npm run test:api                  # unit + end-to-end
```

`apps/api/test/e2e/` drives the running stack over HTTP, and against the *web*
origin by default (`http://127.0.0.1:5175`), so the Vite proxy, the session
cookie and the CSRF gate are inside the test path exactly as they are for a
player. Point it elsewhere with `E2E_BASE_URL`. The suites skip themselves when
neither the API nor Postgres answers, so a bare checkout still runs the rest.
Accounts they create are prefixed `e2e` -- players by login, staff by email --
and deleted afterwards. `admin.e2e.test.ts` talks to the panel origin
(`E2E_ADMIN_BASE_URL`, default `http://127.0.0.1:5174`) for the same reason the
rest talk to the game's.

`coverage.test.ts` needs no stack at all. It reads the source and fails on the
seven things that break silently rather than loudly:

- an `/api/actions/*` endpoint no screen calls (`abortBuildings` is the one
  documented exception -- the legacy has no caller for it either);
- a `t()` key, literal or templated, that resolves in none of the four
  catalogs and would therefore render as the empty string;
- a `reject()` in the rules engine with no player-facing wording, which used to
  mean a refused action printed an empty red line;
- user-visible prose in a `.tsx` file that never passes through `t()`;
- a `/skin/...` path no file in `design/` answers, which draws a 0x0 image and
  nothing else -- how the shipyard shipped with every unit picture missing
  (ships are under `characters/fleet/`, not `characters/military/`);
- any mention of the admin panel inside `apps/web/src` -- an admin route, an
  admin cookie name or `@izariam/shared/admin` -- which is how panel code would
  end up in the bundle a player downloads;
- an `/api/admin/*` endpoint the panel never calls.

The i18n and prose checks stay scoped to `apps/web/src` on purpose: the panel is
Turkish-only with no `t()` layer, so they would fail on every one of its labels.

The two prose checks are why the game is fully Turkish: 81 of 89 rejection reasons had
no text at all, and 120 strings across 24 files were hardcoded English. The
version page's changelog is the deliberate exception -- it is a record of what
changed in each release, not UI copy.

`packages/rules` is checked against `fixtures/`, which was produced by running
the real PHP. If those go red, the port changed the economy.

## Regenerating the fixtures

Only needed if the legacy source changes. The legacy stack must be up.

```bash
cd .. && docker compose up -d && cd v2
curl -s http://localhost:8080/dump/lookups -o fixtures/lookups.json
bash tools/dump-tick-fixture.sh
python3 tools/extract-gamedata.py
python3 tools/verify-gamedata.py
```

One HTTP request per tick scenario is deliberate: `Load_Player` never clears
its town array, so batching them into one PHP process lets state leak between
scenarios and corrupts the corruption figures.

## Yönetim paneli (staff panel)

<http://localhost:5174>, Turkish-only, seeded with one account:

```
admin@izariam.local / 1q2w3e4r*-
```

Override it with `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` on the `migrate`
service; the seed is insert-if-absent, so re-running it never resets a password
changed from the panel, and it refuses to plant the default one when
`NODE_ENV=production`. The password is in this repository — change it from the
panel on any machine that is not a laptop.

Four screens down the left: **Özet** (live counts), **Oyuncular** (create,
edit, ban — and grant resources, via each row's "Kaynak ver" button),
**Yöneticiler** (panel-user CRUD) and **Denetim kaydı** (the audit log). The
grant form itself lives at `#/resources?player=ID` with no menu entry of its
own: it is only ever reached from a player row, and a bare `#/resources`
redirects back to the list.

Oyuncular opens on the full list rather than an empty search box — the
moderator who has just read `#928` off the audit log has no name to type, which
is also why the search matches an id as well as a login or an address. It is
matched in SQL
(`$1 ~ '^[0-9]{1,9}$'`) rather than by coercing in JS, and bounded to nine
digits because `'999999999999'::int` does not return nothing, it raises
`integer out of range` and turns a search box into a 500.

There is **no delete for players**: a `users` row cascades through towns, army,
missions, messages and scores, so the strongest action is a permanent ban, which
is reversible. Player passwords cannot be set from the panel either — "Parola
bağlantısı" issues the same one-shot reset ticket the game uses, so an
administrator never learns a player's password.

**Granting resources goes through the tick, never through an UPDATE.** Per-town
wood/wine/marble/crystal/sulfur and account-wide gold/ambrosia/research
points/cargo ships, each field either `+ ekle` or `= tanımla`, applied to
whichever towns are ticked. The write is `advance()` → mutate the in-memory
`PlayerState` → `persist()` — the same path a game action takes — because the
columns behind those numbers are owned by the tick: a plain UPDATE would be
re-credited from `towns.last_update`, truncated by the storage clamp on the next
pass, clobbered by a concurrent `GET /api/state`, and would leave `user_scores`
stale. A value over the warehouse ceiling is clamped and the panel says in how
many towns; the ceiling is `derive()`'s capacity **without** the premium
multiplier, because that is the one the tick enforces. The grant also puts
`last_visit_at` back, or handing somebody resources would make them look like
they had just logged in.

Three properties are worth knowing, because each one is a bug in its absence:

- **Staff are a separate identity.** `admin_users` + `admin_sessions` +
  `izariam_admin_session`/`izariam_admin_csrf`, none of them shared with
  players. Browsers scope cookies by host and *not* by port, so the game on
  :5175 and the panel on :5174 share one jar — reusing a name or a table would
  mean one login clobbering the other, or an admin session id resolving to the
  player who happens to have the same number.
- **Banning revokes live sessions.** `requireSession` never joins `users`, so
  `blocked_until` is only consulted at login; without the session sweep a banned
  player would keep playing for the remaining seven days of their cookie. A
  permanent ban is a far-future instant, never `infinity` — node-postgres hands
  that back as the JS number `Infinity`, which `verifyLogin` would read as an
  *elapsed* ban and clear.
- **The panel is unreachable from the game origin.** `apps/web`'s dev proxy
  refuses `/api/admin`, and the API refuses any admin mutation whose `Origin` is
  not the panel's (`ADMIN_ORIGIN`, default `http://127.0.0.1:5174`).

Every mutation writes an `admin_audit_log` row in the same transaction, and the
Denetim kaydı screen reads them back — filterable by action, actor, target and
date, with each action's `meta` rendered as a Turkish sentence. A row whose
acting admin has since been deleted keeps its place with "silinmiş yönetici":
`admin_user_id` is `on delete set null` precisely so the history outlives the
account.

## Importing legacy data

Reads the running MariaDB and writes Postgres, expanding the 207 positional
columns (`city0..city16`, `pos0_type..pos14_level`, `res1_1..res4_14`, the 23
unit counters) into rows.

```bash
npm run -w @izariam/db migrate-legacy -- --prefix alpha --dry-run
```

Drop `--dry-run` to commit. Passwords cannot be converted -- md5 is one-way --
so each is parked in `users.legacy_password_md5` and upgraded to argon2id on
the owner's next successful login.

## State of the port

Working: registration, login, logout and password reset; the tick (resources,
population, happiness, corruption, build and unit queues, research, island
nodes); all 64 page keys, each bound to a real screen; the isometric world map;
and the full rules engine including missions, espionage, trade routes. All 40
mutation endpoints are routed under `/api/actions/*` and every one of them but
`abortBuildings` has a caller in the client -- and that one has no caller in
the legacy either (`grep abortBuildings izariam/` finds only the controller
method), so nothing is missing. `apps/api/test/e2e/coverage.test.ts` keeps both
halves of that claim honest.

Beyond the game: a staff panel on :5174 with its own identity table, session
table and cookies (see above). The legacy had none -- `view/admin.php` is a
zero-byte file behind a controller method with no access check, and the
`access_level` column it was meant to use is written by nothing and read by
nothing to this day.

Two reads sit outside `/api/state` because they are unbounded: `GET
/api/messages/:box` for player mail and `GET /api/town-messages` for the town
advisor's news. The advisor's list is marked read by `POST
/api/town-messages/read`, which the legacy did as a side effect of rendering
the template (`tradeAdvisor.php:86-90`) -- a GET with that side effect would be
worse than the original, so it is its own request.

Deliberate differences from the legacy, beyond the eight balance defects
reproduced on purpose:

- **The temple and the monument work.** The legacy builds a temple (type 26),
  stores `towns.templer`, draws a "Priests" bar that is always zero — and has
  no page for it, so clicking the finished building opened the *build here*
  menu. It has no cost for it either: `building_cost()` has no `case 26`, so a
  temple is free, instant and unupgradable. Its eight island wonders are text:
  names, per-level effects, durations and cooldowns that one static screen
  prints and nothing reads, and `game/wonder` is a link with no controller.

  Here the temple has live Ikariam's cost and priest tables
  (`packages/gamedata/temple.json`, 50 levels: 121 wood / 118 marble and 12
  priests at level 1, 1.01M / 6.52M and 2,127 at level 50). That table is the
  one place the golden fixture is knowingly left behind — `costs.golden.test.ts`
  skips building 26 and `config.ts` says why. Priests are assignable, each is
  worth two happiness, and five islanders believe for every one of them — the
  legacy's own rule, from its own help text. Island faith sums over *every* town
  on the island, and 20/40/60/80/100% unlock the five miracle levels.

  The monument is the other half, and it is new: `islands.wonder_level` 1..5,
  raised by anyone on the island donating the three luxuries the island does not
  produce itself (1,200 of each for level 2, then 3,600, 10,800, 32,400). The
  effect the priests get is `min(monument level, faith level)`, so both halves
  have to be fed. `apps/web/src/screens/Wonder.tsx` is the page the 2012
  stylesheet was written for and never got: the god, the belief bar, the
  donation form, and a roster of every town on the island with its priests, the
  islanders they converted and its share of the island's faith.

  Donations do **not** go through `savePlayerState`. It writes island rows blind
  from a copy read before any lock, and the island is shared by up to seventeen
  players, so `POST /api/actions/donateWonder` takes `select … for update` on
  the row and writes those six columns itself. `wonder.e2e.test.ts` fires two
  donations at one monument through `Promise.all` and insists it gains one level.

  Calling a miracle lands on the whole empire, and a second temple on another
  island with the same god takes a tenth off that god's cooldown, to a floor of
  half. Three of the eight actually do something here — Demeter's citizens an
  hour in the tick, Hermes' quay and Poseidon's sail in `missionTiming` —
  Athene's larger safe store is visible on the warehouse screen, and the four
  combat ones (Hephaistos, Hades, Ares, the Colossus) can be called and stored
  but have nothing to apply to until this port has a fight. The magnitudes,
  durations and cooldowns are live Ikariam's, not the legacy's older and weaker
  strings; `tools/extract-gamedata.py` rewrites the 40 `wonderN_levelM` texts
  from them so a re-extraction cannot put the 2012 figures back.
  `packages/rules/src/temple.ts` owns all of it, and the golden fixtures still
  pass: every one of them has zero priests, so the arithmetic they pin never
  moves.
- **Ambrosia can buy build time**, which the legacy never offered — it spends
  ambrosia on exactly three things (a premium boost, moving a city, a second
  trade route). This is live Ikariam's feature and its curve: *shorten* removes
  half of what is left, *complete instantly* removes all of it, priced at 4
  ambrosia per half hour of removed time plus a flat 4, capped at 148, and free
  under five minutes ([wiki](https://ikariam.fandom.com/wiki/Shorten_Building_Time)).
  Nothing finishes the building itself: the action only rewinds
  `build_queue.started_at`, because the port has no stored finish time —
  `runBuildQueue` decides with `buildStart + cost.time <= now` — so the next
  tick completes it and the score bump, the town message and the queue's
  deferred payment all happen exactly as they do for a build nobody paid to
  rush. `packages/rules/src/hurry.ts` owns the curve, and both the client's
  quote and the server's charge call it.
- **Password reset** is a one-shot token that expires in an hour and drops
  every session on use. The legacy generated a new password, wrote it to the
  account and mailed the plaintext, with no token and no confirmation step, so
  knowing an address was enough to lock its owner out (`main.php:206-251`).
  There is no mail transport here: outside production the token comes back on
  the response and is logged.
- **Account activation is not ported.** Registration logs straight in, which is
  what the legacy did in practice -- `game_email` ships FALSE
  (`izariam/config/izariam.php:57`), and its `/main/validate/{uni}/{key}` link
  logged the visitor in from the key alone with no password. `users.register_key`
  is written by the MySQL importer and read by nothing.
- **`advance()` locks the player's row.** `loadPlayerState` reads the whole
  graph without a lock and `savePlayerState` writes it back with blind full-row
  UPDATEs, so two overlapping requests for one player were a lost update waiting
  to happen -- and the admin panel's resource grant made it reachable on
  purpose. One `select … for update` at the head of `advance()` serialises every
  read-modify-write per player.
- **Sessions are server-side and opaque.** The legacy put `id`, `universe` and
  `login` in the cookie itself, signed with `md5(payload . encryption_key)`
  against an encryption key that shipped hardcoded in the repo.
- Bans are enforced at login (`users.blocked_until`), as `player_model.php:270`
  did. Multi-account detection is not ported; the legacy had it switched off.

Combat does not exist here because it does not exist in the legacy either:
`wall_data_by_level()` is defined and never called, the unit defence and health
columns are never read, and there is no handler behind the plunder screen.

See `packages/rules/src/config.ts` for the eight legacy defects this port
reproduces on purpose, each behind a named flag, and the four places it
knowingly diverges.
