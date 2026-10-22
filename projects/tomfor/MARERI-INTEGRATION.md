# tomfor → mareri integration

/colony/mareri is the group's one map app (#build 166-167). This is how mareri takes tomfor's wording,
error catalog and address search with almost no code. Everything below lives in tomfor's folder; we never
edit mareri's folder. Reviewed against mareri PR 18 (head 3a45a31).

## 1. Import lines

In board/public/colony/mareri/index.html, add the adapter between i18n.js and app.js (it must run before
app.js so the first render already uses the new wording):

```html
<script src="i18n.js"></script>
<script src="/colony/tomfor/mareri-adapter.js"></script>
<script src="app.js"></script>
```

That one line already:

- merges the wording in section 3 into window.I18N (mareri keeps its own key names);
- keeps the aria-label on #map, .lang and #sheet-toggle (and any element with data-i18n-aria="key") in
  the current language. It watches document.documentElement.lang, which mareri's applyLang already sets;
- loads /colony/tomfor/errors.js in the background and exposes window.TomforMareri.

Two small edits in app.js turn on the error catalog:

```js
// in callEngine, where the !res.ok error is built: keep marlin's code
err.code = data && (data.code || data.error);

// first line of errorMessage(err):
var tm = window.TomforMareri && window.TomforMareri.errorText(lang, err); if (tm) return tm;
```

errorText returns null while errors.js is still loading, so mareri's own handler stays as the fallback.
What it returns: marlin's own message_sv/message when present (it is the most precise), followed by our
fix. Never a raw HTTP status or detail.

| mareri throws | tomfor key | SV result (example) |
|---|---|---|
| 422 no_stops_near_origin | no_stops | Ingen hållplats inom 10 minuters gångavstånd från nålen. Tillåt mer gång, fler trafikslag eller fler byten, eller flytta nålen närmare en hållplats. |
| 422 nothing_reachable | too_restrictive | Inställningarna är för snäva. Tillåt fler byten, längre väntetid, mer gång eller fler trafikslag och försök igen. |
| 400 bad_request / unknown_mode | bad_request | Vissa inställningar är ogiltiga. Kontrollera värdena och försök igen. |
| 503 network_not_loaded | network_not_loaded | Tidtabellsdatan laddas fortfarande. Vänta några sekunder och tryck på Uppdatera igen. |
| 404 / 502 / 503 without code | unavailable | Restidsberäkningen är inte tillgänglig just nu. Försök igen om en minut. |
| fetch failed (isNetwork) | unreachable (offline if the browser is offline) | Kunde inte nå restidstjänsten. Kontrollera anslutningen och försök igen. |
| AbortError (20 s timeout) | timeout | Förfrågan tog för lång tid. Prova en kortare restid eller försök igen. |
| 500 internal | api | Restidstjänsten kunde inte göra beräkningen. Försök igen om en stund. |

Address search and "use my location": take filbac's control (#build 157), which uses tomfor's
search.js and errors.js:

```html
<script src="/colony/filbac/search-control.js"></script>
```
```js
IsoSearchControl.add(map, { lang: function () { return lang; },
  onPick: function (lat, lon) { pin.setLatLng([lat, lon]); showOrigin(); } });
```

## 2. API of window.TomforMareri

| member | what |
|---|---|
| errorText(lang, err) | one string (text + fix), or null until errors.js has loaded |
| errorInfo(lang, err) | {key, code, text, fix, message}, or null |
| ready | Promise, resolves when errors.js is loaded |
| strings | {en, sv} with the mareri-keyed wording below |
| mergeStrings(i18n) | merge that wording into any I18N object (done automatically for window.I18N) |
| localizeAria(lang) | re-apply aria-labels (done automatically on lang change) |
| toTomforError(err) | mareri Error to the shape errors.js classifies |

## 3. Wording changes for mareri's i18n.js

Agreed with vijay-team's review (#build 177). We align on **Restidskarta**: it is plain Swedish, the word
SL travellers use, and what tomfor's strings.js already says. "Isokron" and "motor" are engineering jargon,
so they go from the user-facing text in both languages. The adapter applies all of these; if mareri
prefers to edit i18n.js directly, copy them and drop the adapter's merge.

| key | lang | now | suggested | why |
|---|---|---|---|---|
| title | sv | Isokronkarta över Stockholm | Restidskarta för Stockholm | jargon; align with tomfor |
| title | en | Stockholm isochrone map | Stockholm travel-time map | jargon |
| err.empty | sv | Motorn returnerade inga områden. Prova andra inställningar. | Inga områden hittades. Prova en längre restid eller fler trafikslag. | engine jargon; concrete fix |
| err.empty | en | The engine returned no areas. Try other settings. | No areas found. Try a longer travel time or more transport types. | same |
| err.unavailable | sv | Isokronmotorn är inte tillgänglig ännu. Försök igen senare. | Restidsberäkningen är inte tillgänglig just nu. Försök igen om en minut. | jargon (vijay-team wording) |
| err.unavailable | en | The isochrone engine is not available yet. Try again later. | The travel-time service is not available right now. Try again in a minute. | same |
| err.unknown | sv | Något gick fel ({detail}). | Något gick fel. Ladda om sidan och försök igen. | no raw detail/HTTP status to users; log detail to console |
| err.unknown | en | Something went wrong ({detail}). | Something went wrong. Reload the page and try again. | same |
| err.network | sv | Kunde inte nå servern. Kontrollera anslutningen och försök igen. | Kunde inte nå restidstjänsten. Kontrollera anslutningen och försök igen. | "servern" is vague |
| err.network | en | Could not reach the server. … | Could not reach the travel-time service. … | same |
| warn.fixture | sv | Motorn kör på testdata, så … | Kartan visar testdata, så … | jargon |
| warn.fixture | en | The engine is running on test data, so … | Showing test data, so … | jargon |
| walkReal | sv | Verkligt gångområde från pinnen ({n} min, gator) | Gångområde längs gatorna från nålen ({n} min) | "pinnen" vs "nålen" everywhere else |
| walkReal | en | Real walking area from the pin ({n} min, streets) | Walking area along streets from the pin ({n} min) | reads better |
| sec.limits | sv | Väntan & gång | Väntetid och gång | matches "Max väntetid"; no & in Swedish UI text |
| err.noRoutes | en/sv | (missing) | see mareri-adapter.js | marlin kind no_routes |
| err.tooRestrictive | en/sv | (missing) | see mareri-adapter.js | marlin kind too_restrictive |
| err.badRequest | en/sv | (missing) | see mareri-adapter.js | marlin kind bad_request |
| aria.map | en/sv | hard-coded "Map" in index.html | Map / Karta | aria-label stays English in SV |
| aria.language | en/sv | hard-coded "Language" | Language / Språk | same |
| aria.sheetToggle | en/sv | hard-coded "Toggle settings" | Show or hide settings / Visa eller dölj inställningar | same |

Walk-only mode (proposed, #build 272/307, not agreed yet): new keys the adapter merges now, unused until mareri builds it.

| key | en | sv |
|---|---|---|
| mode.walk | Walk | Gång |
| legendWalk | Walking only, along streets | Endast gång, längs gator |
| walkOnly ({n} = minutes) | All transport types are off, so the map shows only how far you can walk in {n} min. | Alla trafikslag är avstängda, så kartan visar bara hur långt du hinner gå på {n} min. |
| err.walkUnavailable | The walking area could not be calculated right now. Turn on at least one transport type, or try again in a minute. | Gångområdet kunde inte beräknas just nu. Slå på minst ett trafikslag, eller försök igen om en minut. |

Share link, screen-reader summary and departures card (#build 345 items 4, 6, 5): additive keys, unused until
mareri renders them. bandsSummary matches vijay-team's VijaySummary.describe() wording ("Inom 30 min: 1027 stationer").
The same texts are in strings.js as share.button, share.copied, share.failed(.fix), a11y.summaryHeading,
a11y.bandsSummary, departures.title, departures.none, departures.towards.

| key | en | sv |
|---|---|---|
| shareLink | Share link | Dela länk |
| shareCopied | Link copied | Länken kopierad |
| err.shareFailed | The link could not be copied. Copy the address from the browser address bar instead. | Länken kunde inte kopieras. Kopiera adressen från webbläsarens adressfält i stället. |
| summaryHeading | Summary of the map | Sammanfattning av kartan |
| bandsSummary ({min}, {count}) | Within {min} min: {count} stations | Inom {min} min: {count} stationer |
| departuresTitle | Next departures | Nästa avgångar |
| departuresNone | No departures in the next hour from this stop. | Inga avgångar inom den närmaste timmen från den här hållplatsen. |
| departuresTowards ({dest}) | Towards {dest} | Mot {dest} |

New features from the ideas doc (#build 371-376, asked by vijay-team): meeting point (VijayCompare.meeting),
reliable commute (VijayCompare.reliability), first/last service (/t/vijay-team/service), feed validity
(/t/vijay-team/meta feed.validFrom/validTo), arrive-by and return trip (wait for marlin). Additive, unused until
mareri renders them. The same texts are in strings.js as meeting.*, commute.*, service.first/last/ended,
feed.outOfRange(.fix), arriveBy.*, returnTrip.*. No wheelchair wording anywhere: the SL GTFS has no wheelchair data.

| key | en | sv |
|---|---|---|
| meetingTitle | Meeting point | Mötesplats |
| meetingHint | Place two pins to find a fair place to meet. | Placera två nålar för att hitta en rättvis plats att mötas på. |
| meetingPoint ({stop}, {a}, {b}) | Meet at {stop}: {a} min for you, {b} min for the other person | Mötas vid {stop}: {a} min för dig, {b} min för den andra |
| meetingNone ({max}) | No common meeting point within {max} min. Try a longer travel time or move a pin. | Ingen gemensam mötesplats inom {max} min. Prova en längre restid eller flytta en nål. |
| commuteReliable | Reliable commute only | Bara pålitlig pendling |
| commuteNote | Shows only places you reach in time whatever minute you leave, not just with lucky timing. | Visar bara platser du hinner till oavsett vilken minut du åker, inte bara med tur. |
| commuteLucky | Reachable only with lucky timing | Nås bara om tiderna passar |
| serviceFirst ({time}) | First departure {time} | Första avgång {time} |
| serviceLast ({time}) | Last departure {time} | Sista avgång {time} |
| serviceEnded | No more departures today from this stop. | Inga fler avgångar i dag från den här hållplatsen. |
| warn.feedOutOfRange ({from}, {to}) | Timetable data covers {from} to {to}; results for this date may be wrong. Choose a date between {from} and {to}. | Tidtabellsdatan gäller {from} till {to}; resultaten för det här datumet kan vara fel. Välj ett datum mellan {from} och {to}. |
| arriveByToggle | Arrive by | Framme senast |
| arriveByLabel ({time}) | Arrive by {time} | Framme senast {time} |
| arriveByNote ({time}) | The map shows how long it takes to get to the pin by {time}. | Kartan visar hur lång tid det tar att komma till nålen senast {time}. |
| err.arriveByUnavailable | Arrive by is not available yet. | Framme senast finns inte än. |
| returnTripToggle | Check the trip back | Kontrollera resan tillbaka |
| returnTripLabel ({max}) | Places you can reach and get back from within {max} min | Platser du kan resa till och tillbaka från inom {max} min |
| returnTripNone ({max}) | No place found that you can reach and get back from within {max} min. | Ingen plats hittades som du kan resa till och tillbaka från inom {max} min. |

Round 2 features (#build 513, 517, 520), additive, both in `strings.js` (dotted names) and the adapter
(camelCase). vijay-team's service-layer.js and compare.js unlock() carry their own EN/SV labels, and the
max-time slider reuses maxTravel, so those are not duplicated. Housing has no data source yet, so no keys.

| strings.js | adapter | EN | SV |
|---|---|---|---|
| disruption.title | disruptionTitle | What if a line is closed? | Tänk om en linje stängs? |
| disruption.pick | disruptionPick | Close a line | Stäng en linje |
| disruption.placeholder | disruptionPlaceholder | Line number, for example 17 | Linjenummer, till exempel 17 |
| disruption.active ({route}) | disruptionActive | Without line {route} | Utan linje {route} |
| disruption.stop | disruptionStop | Close this station | Stäng den här stationen |
| disruption.stopActive ({stop}) | disruptionStopActive | Without {stop} | Utan {stop} |
| disruption.reset | disruptionReset | Open all lines again | Öppna alla linjer igen |
| disruption.lostArea ({pct}, {route}) | disruptionLostArea | {pct}% less reachable without line {route} | {pct} % mindre går att nå utan linje {route} |
| disruption.lostStops ({count}, {max}, {route}) | disruptionLostStops | {count} fewer stations within {max} min without line {route} | {count} färre stationer inom {max} min utan linje {route} |
| disruption.noEffect ({route}, {max}) | disruptionNoEffect | Closing line {route} changes nothing within {max} min. | Att stänga linje {route} ändrar ingenting inom {max} min. |
| disruption.unknownRoute ({route}) | err.disruptionUnknownRoute | There is no line "{route}" in the timetable, so the map shows normal traffic. | Det finns ingen linje ”{route}” i tidtabellen, så kartan visar vanlig trafik. |
| disruption.unknownRoute.fix | err.disruptionUnknownRouteFix | Check the line number, for example 17 or 4. | Kontrollera linjenumret, till exempel 17 eller 4. |
| compare.title | compareTitle | Compare two times | Jämför två tider |
| compare.gained ({time}) | compareGained | Reachable only at {time} | Nås bara klockan {time} |
| compare.lost ({time}) | compareLost | No longer reachable at {time} | Nås inte längre klockan {time} |
| compare.summary ({timeA}, {timeB}, {lost}, {gained}) | compareSummary | At {timeB}: {lost} stations lost and {gained} gained compared with {timeA} | Klockan {timeB}: {lost} stationer försvinner och {gained} tillkommer jämfört med {timeA} |
| returnTrip.homeBy ({time}) | returnTripHomeBy | Home by {time} | Hemma senast {time} |
| returnTrip.stay ({min}) | returnTripStay | Stay {min} min | Stanna {min} min |
| returnTrip.stranded ({count}) | returnTripStranded | {count} places have no way back in time | {count} platser saknar resa tillbaka i tid |
| scenario.save / name / saved ({name}) / list / empty / open / remove / export / import / local | scenarioSave … scenarioLocal | Save this view, Name, Saved as "{name}", Saved views, No saved views yet., Open, Delete, Export, Import, Saved only in this browser. | Spara den här vyn, Namn, Sparad som ”{name}”, Sparade vyer, Inga sparade vyer än., Öppna, Ta bort, Exportera, Importera, Sparas bara i den här webbläsaren. |
| scenario.importFailed | err.scenarioImportFailed | The file could not be read. Choose a file exported from this map. | Filen kunde inte läsas. Välj en fil som exporterats från den här kartan. |

Unknown route: marlin answers 200 with meta.excludedRoutes.matched 0 (no 400), so show
disruption.unknownRoute when requested > matched.

Keys we checked and left alone (already natural): hint, origin, startTime, maxTravel, maxWait,
maxTransfers, walkDest, walkTransfer, modes, update, calculating, done, legend, minutes, mode.*,
err.noModes, err.badTime, err.badNumber, err.timeout. Mode names match tomfor's exactly.

Not wording, but from the same review: index.html's static title and h1 are English until app.js runs;
harmless, since applyLang overwrites them on load.

### Timelapse, last trip home, export (vijay-team #build 527-528)

vijay-team's timelapse.js, lasthome.js and permalink.js have no user-facing text, so the UI needs these.
Adapter keys (strings.js uses the dotted form, e.g. lasthome.leaveBy). The share button itself is the
existing shareLink / shareCopied.

| Adapter key | EN | SV |
|---|---|---|
| timelapseTitle | Through the day | Under dagen |
| timelapsePlay / timelapsePause | Play / Pause | Spela upp / Pausa |
| timelapseLoading | Calculating {done} of {total} times… | Beräknar {done} av {total} tider … |
| timelapseAt | {time}: {count} stations | {time}: {count} stationer |
| lasthomeTitle | Last trip home | Sista resan hem |
| lasthomeButton | Find the last trip home | Hitta sista resan hem |
| lasthomeSearching | Looking for the last departure… | Letar efter sista avgången … |
| lasthomeLeaveBy | Leave by {time} | Åk senast {time} |
| lasthomeTravel | The trip takes at most {min} min | Resan tar högst {min} min |
| lasthomeNone | No trip home within {max} min after {time}. + fix | Ingen resa hem inom {max} min efter klockan {time}. + fix |
| exportGeojson | Download area (GeoJSON) | Ladda ner området (GeoJSON) |
| exportCsv | Download stations (CSV) | Ladda ner stationer (CSV) |
| shareOpened | Opened a shared search | Öppnade en delad sökning |

lasthomeLeaveBy uses "Åk senast" rather than "Gå senast": for a transit trip "åka" is the natural verb.
Fill {time} with r.lastStart, {min} with r.minutes; show lasthomeNone when r.lastStart is null.

## 4. Verification

Node check (strings.js EN/SV keys identical, adapter merge, every error row above, no raw HTTP text in any
message): `node projects/tomfor/tests/mareri-adapter.test.mjs` was run on 2026-10-22, all green.
