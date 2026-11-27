# Worth a Stop

Worth a Stop is a travel planner for people exploring a city on their own. Choose a city and a date to see nearby events, local times, venues and links to the published listings. Explore the map alongside your daily itinerary, add stops and check whether the calculated visits fit your available time. For longer trips, you’ll be able to link days across cities and plan around train journeys, overnight stays, and existing bookings.

## Getting started

You can search for cities by name in the browser or from the command line. Both use the Open-Meteo geocoding API. The command line can also import an organizer’s published event calendar. Run the commands below from the repository root with Node.js 22 or later. Install the dependencies before starting the website, importing events or running the tests.

```sh
npm ci
```

### Website

```sh
node bin/site.mjs
```

Open `http://127.0.0.1:3000` in your browser. The site opens in Russian if your browser language is Russian and in English otherwise. Use the RU/EN switch to change languages. It remembers your choice on this device. An open city keeps its selected date, saved itinerary, preview time, availability filter and active discovery tab across language changes, without needing another city lookup. City and region names follow the geocoder's available translations when you search. Live searches require a connection to Open-Meteo.

Use the theme button in the header to switch between light and dark appearance. The initial theme follows your system setting; an explicit choice is saved on this device and applied before the page is painted. Changing themes keeps the current map and plan in place. The dark palette covers map tiles, controls, popups, cards and form fields. Theme controls are translated into Russian and English, and the switch still works in the current tab if browser storage is unavailable.

The landing page includes a decorative animated walking route. Cards have brief entrance and hover effects, and adding a stop gives visual feedback alongside the itinerary's status message. Reduced-motion preferences disable decorative motion and limit programmatic map movement. The interface uses local assets and CSS, with no animation library or external font dependency.

Pick a destination under **Cities with event listings**, or start typing a city name. The destination buttons come from cities with current or upcoming OpenAgenda listings. Suggestions update after a short pause as you type. The country and region help distinguish places with the same name. Select a city to open a workspace with a large map, the daily itinerary alongside it and **Places** / **Events** tabs below the map. **Change city** returns to search. An empty itinerary offers **Explore places** to take you directly to the suggestions.

Set **Date**, **Start at** and the optional **Finish by** in the shared trip bar. Date changes update the agenda, map and saved plan together. The finish limit is saved separately for each city and date. It checks the calculated departure from the final stop and shows remaining minutes or an overrun. An incomplete calculation stays unverified. The limit must be later than the start on the same day, and ambiguous or nonexistent local times require another selection. A return destination is planned.

To build an automatic suggestion, enter both times, select **Relaxed**, **Balanced** or **Active**, then choose **Plan my day**. It uses the live place and event sources for the selected city and date, includes your selected map starting point and checks actual walking legs. With no starting point selected, the walk starts at the first proposed stop. The pace is remembered for the city and preserved across language changes. Visit durations are category-based estimates; published event start and end times are retained.

The preview lists stop times, source links, estimated visits, walking and waiting minutes, opening-hour checks and variety reasons. Known closed visits, visits crossing a closure, late event arrivals and stops finishing beyond the time window are excluded. Places with unknown opening hours may appear with an explicit check-required label. Events need coordinates and a complete session inside the window; online, cancelled, postponed and sold-out sessions are excluded. Saved place results and incomplete source coverage are identified.

**Preview on map** draws a separate dashed route with orange numbered stops. The saved itinerary remains unchanged until **Apply plan** or **Replace current itinerary**. Applying replaces the whole stop sequence while retaining the selected trip times and starting point. Changes to the date, times, pace, start point or manual stops invalidate the proposal. The apply action also compares the current itinerary with the reviewed snapshot before writing. Cancel discards the proposal, and unapplied previews are not persisted across navigation or language changes. Storage failures keep an applied plan in the current tab and label it unsaved.

The first planner uses a bounded greedy search rather than promising an optimal or exhaustive route. It considers up to twelve places and twelve eligible event sessions, favours verified hours, nearby stops, imminent sessions and category variety, and makes at most 24 distinct walking checks. Relaxed, Balanced and Active cap the plan at four, six and eight stops and individual walking legs at 25, 35 and 45 estimated minutes. Event waiting is limited to one hour. The whole lookup has a 90-second timeout and can be cancelled. Mandatory stops, personal interests, planned meal breaks and a return destination remain future work.

If a search returns no cities, the website checks for nearby spellings in city names and, when needed, asks Wikipedia for a spelling suggestion. It checks the corrected name with the geocoder before showing it. For example, try `Lnodon` or `Будапшт`. Arrow Down moves keyboard focus from the search field to the first result.

Use the **Places** tab to explore up to 24 named attractions, historic sites, religious landmarks, markets, parks, gardens, viewpoints, museums and galleries across the selected city. The search uses its mapped administrative boundary rather than a fixed radius. Places in remote districts can qualify without Wikipedia, Wikidata or heritage annotations. The shortlist remains limited to 24 ranked suggestions; it is not a complete inventory. Distances are straight-line estimates from the geocoder's city point to mapped points or area centres. Each name links to its OpenStreetMap object. Opening hours appear as published when available. [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

City boundary discovery reads the administrative areas containing the selected geocoder point through Overpass, then matches the GeoNames identifier or published names and translations. When the interface-language name is missing from OSM, it resolves the same GeoNames ID to an English name through Open-Meteo and checks those boundaries again. It rejects conflicting identifiers, country boundaries and ambiguous matches. It does not use a list of configured cities or assume one administrative level works worldwide. The interface links to the actual boundary used. Municipal boundaries can include rural districts and exclude neighbouring municipalities or independent enclaves, such as Vatican City when exploring Rome. Overpass area membership is used for mapped objects; their displayed area centre is only a marker location. If no matching boundary is available, the interface reports that citywide search is unavailable rather than silently reverting to a radius or claiming that no attractions exist. [Overpass area queries](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL#By_area_(area))

The shortlist ranks places using multilingual names, Wikipedia and Wikidata references, heritage protection and explicit international or landmark annotations. These are prominence estimates from source metadata, rather than an official popularity rating. Distance breaks ties. There are no category quotas or automatic cathedral bonuses that displace better documented landmarks. Duplicate names at nearby coordinates and objects sharing a Wikidata identity are combined. Market nodes require additional market tags or a Wikidata reference, and shops tagged as markets are excluded. Replacement searches remain local: up to twelve places within 2 km of the stop.

Each place also appears on an interactive map. Use the mouse wheel to zoom. Select its name in the list to zoom to its marker and open the published hours and source link. Selecting a marker highlights its list entry. The map uses Leaflet and OpenStreetMap tiles.

Use **Map time and filters** below the map to preview Open, Closed or Opening hours unknown in the list and map popups. Changing the walking start also updates this preview time; the preview slider itself does not change the walking start. The date comes from the shared trip bar. The opening_hours parser handles weekly schedules, split intervals, seasonal dates and overnight hours. Rules involving public or school holidays or astronomical times are labelled unknown until the required local context is available. Missing, invalid or explicitly uncertain schedules also remain unknown. A missing city time zone or a nonexistent local time during a daylight-saving transition produces an unknown state.

Drag the time slider or enter a local time to update the map and agenda. Events are labelled Ongoing, Starts within an hour, Later, Ended or Event time unknown. Available now filters the map and both lists to open places and ongoing events. It hides unknown schedules and sold-out events. Events with an unpublished end time remain unknown once they start. Switching languages keeps the selected time and filter. Ambiguous local times during a daylight-saving clock change are also treated as unknown.

Events with published venue coordinates appear as diamond markers on the same map. Select **Show on map** in the daily agenda to open the venue, local session time and publisher link. Changing the trip date replaces the event markers. Events without coordinates remain in the agenda with an explicit location notice. Online events stay in the list. The event map works even when the nearby-place source is unavailable.

Use **Add to plan** on a place or event to build a Daily itinerary for the selected city and date. Move stops up or down, remove them, and enter visit durations in minutes for places. Durations start blank. Event sessions retain their published start and end times. Repeated clicks keep a single copy of the same stop, while separate sessions can be saved individually.

Plans and the last selected plan date are saved on this device and restored when you reopen the city. Each city and date has its own plan. The selected date is shared with the map and agenda. If storage fails, the interface identifies unsaved changes and retains them in the current tab. Saved events are snapshots of the published schedule at the time they were added. Later schedule checks are planned.

Set **Start at** to calculate arrival and departure times. Start time is saved separately for each city and date, using existing saved starts from earlier versions. Place visits use the duration you entered, and each walking leg is rounded up to whole minutes to match its displayed estimate. Early arrival at an event includes waiting until the published start, followed by departure at its published end. Late arrival shows the delay. If the event has already ended, the following departure remains unknown.

Open **Starting point settings** and use **Choose start on map** to begin at a station, hotel or another point. Click the map, or use arrow keys to pan and Enter to select the map centre. Escape and the cancel button exit selection. The chosen point appears as S and is saved separately for each city and date. The walking route and arrival times include its incoming leg to the first stop. A failed incoming route leaves the first arrival unknown. **Start at the first stop** restores the default starting position.

A missing visit duration, unavailable walking leg or unpublished event end leaves downstream arrival times unknown. Each affected stop explains the missing information. Times use the destination time zone, include the date when the plan crosses midnight, and respect daylight-saving changes. Ambiguous or nonexistent local start times require another selection. Changing start time or visit durations reuses the calculated routes.

Place visits are checked against the opening-hours snapshot saved with the stop. The plan distinguishes a visit that fits entirely, a closed place on arrival, a closure before departure, a break within the visit and an unverified schedule. When a place closes during a visit, it shows the closing time and the time available before closing. Departure exactly at closing time is allowed. Changing the start time, order or visit duration updates these checks.

Older stops without saved hours remain unverified. Adding the same place again refreshes its saved hours while preserving its order and visit duration. Public-holiday rules, uncertain schedules and ambiguous clock-change intervals require checking with the source.

Open **Find a replacement** on a place stop after setting the walking start and visit duration. It searches suggestions within 2 km of that stop and checks up to three nearest candidates whose hours cover the current visit window. It then recalculates adjacent walking legs, verifies the resulting visit against opening hours and checks arrival at the next fixed event. A failed route or an unverified event window excludes the candidate.

Each alternative shows its verified visit time, published hours, source link and a map preview. **Replace stop** keeps the visit duration and position in the plan, then recalculates routes and arrival times. Changing the plan, start time or calculated route invalidates previous choices. Saved place suggestions are labelled when the live source is unavailable. Alternative checks use the hours supplied by the place source and the cached walking routes.

Use **Compare order with the next place** for two adjacent place stops. The preview recalculates the affected walking legs and compares the current and swapped orders. It shows walking minutes, finish time, conflicts, unknown information and arrival and departure times for every stop. Replacement searches and order comparisons include the selected starting point. With the default starting position, the walk begins at the first stop in the chosen order.

**Apply this order** is enabled when the changed visits fit their published hours and affected event arrivals can be verified without lateness. Choosing it saves the pair in the new order with the original visit durations. Event positions and published times are preserved. Changing the plan, selected start or route invalidates the preview. Schedule checks use the opening-hours snapshots saved in the plan.

**Walking legs and distances** shows the calculations for each adjacent leg in the saved order using the public FOSSGIS OSRM foot router. It shows distances, estimated walking times and a total when every leg is available. The route button above the map draws the paths and numbered stops. Reordering or removing stops recalculates the route, while visit-duration edits reuse it.

Missing coordinates leave a gap in the route. Older saved stops can regain coordinates by adding the same stop again from current suggestions, preserving its position and duration. Provider failures offer a retry. Calculated legs are shown individually when the whole itinerary cannot be routed. The router uses paths within 100 metres of the published coordinates, and successful results are cached for one hour. [Routing service and attribution](https://routing.openstreetmap.de/about.html)

The server caches place results for one hour and confirmed boundaries for 24 hours. Pending lookups are shared across requests and interface languages by city identity and coordinates. If place loading fails, retrying reuses the confirmed boundary. Cache lifetimes start after successful completion; failed lookups are not saved as empty results. City queries first use the boundary's bounding box to narrow the spatial index, then check exact polygon membership once for the combined candidates. Deduplication stops once the ranked shortlist is full.

Boundary discovery and place queries share provider health information. [Dresel regional replicas](https://ovp.dresel.systems/) are selected automatically using the published geometry in the [Geofabrik extract index](https://download.geofabrik.de/technical.html). A replica is eligible for place loading only when its extract conservatively covers the entire city bounding box, including checks for holes and coverage edges. Queries retain the exact city boundary. If coverage cannot be verified, the application uses the global providers: VK Maps, overpass-api.de and [Private.coffee Overpass](https://overpass.private.coffee/). The coverage index is shared and cached for 24 hours; index failures do not block global fallback. Regional extracts are updated daily rather than continuously.

Successful providers are tried first on subsequent queries. Failed providers are skipped for 60 seconds, including between boundary and place loading. Boundary queries allow six server seconds, city place queries twenty and local place queries eight, with three extra seconds for transfer and a 35-second total transport budget per query. Provider requests include application identification and respect cancellation. A complete server lookup has a 60-second deadline. When sources remain unavailable, the API returns HTTP 503 with a retry hint instead of treating the city as empty. A replica missing the requested generated city area is skipped in favour of another provider.

The browser saves the last successful city shortlist together with its boundary and check time, keyed by city identity and coordinates. Local replacement searches have separate cache entries and remain limited to 2 km. If a later request fails, the interface shows saved results with their original boundary and check time and offers a retry. Without saved results it shows an error, distinguishing an unconfirmed boundary from unavailable providers. Opening hours retain OpenStreetMap notation.

In the **Events** tab, choose Today, Tomorrow or set a trip date in the shared bar. The site reads the individual sessions published in OpenAgenda. A multi-day event appears on each day it overlaps, and a recurring performance appears on its scheduled dates. Times use the destination’s time zone, shown alongside the results. When the city has no known time zone, the agenda uses UTC. Switching languages keeps the selected date.

The daily search starts within 5 km of the city centre and expands to 25 km if it finds no sessions. Cancelled and indefinitely postponed listings are omitted. Sold-out events are labelled. When two publishers list the same title at the same venue and start time, the latest publication takes precedence. A source failure offers a retry, and an incomplete schedule is labelled. Event and venue names follow the publisher’s language. [OpenAgenda public dataset](https://public.opendatasoft.com/explore/dataset/evenements-publics-openagenda/)

Open **Venue calendars and travel guide** to find city calendars. Discovery uses the GeoNames ID in Wikidata, municipal websites, their published visitor links and explicit official tourism references in up to three Wikipedia language editions. It recognizes multiple calendar links and municipal subdomains. It also follows published cultural-directory, theatre, museum and cultural-centre links to find venue programmes. Each starting website is limited to eight pages and two link levels, and shared pages are requested once per discovery. When the directory lacks a municipal website or is unavailable, a fallback resolves the GeoNames ID with Open-Meteo and looks for a matching town article within 5 km in English Wikipedia. It reads that article's Wikidata website claims and rejects conflicting GeoNames associations. There is no list of specially configured cities.

**Events by day** reads JSON-LD Event records, Schema.org event microdata in HTML, dated calendar cards with headings and source links, explicit year-first date/time/venue rows, supported local date tables and supported Nuxt embedded event data. Calendar-card dates use the page's declared language and require an explicit year. News publication dates are not treated as event metadata. Embedded data is parsed without executing publisher scripts. Single-day clock times are retained. Multi-day listings keep their published date range without inventing daily sessions.

The selected trip date is sent to the server. It prioritizes published day/month links and supported GET date filters, including native date/month inputs, offered month/year selections and numeric date widgets with a declared page language. When the requested month is not linked directly, it can follow a published month link that moves closer to it, including across a year boundary. It preserves published field names and filter values, respects offered ranges and resolves relative links against a same-origin HTML base. It does not invent month URLs or submit POST forms. Details with published dates far outside the requested day are skipped with a one-day margin for source time zones and midnight crossings. Unverified detail dates remain eligible for inspection.

Each calendar lookup reads up to 24 pages, three at a time, including at most four listing pages connected by date filters or published navigation. It continues to linked details even when the index already contains events. Dated cards may link to another section on the same site. **City calendars checked** shows source links, page attempts, dated-listing counts, unavailable pages and crawl limits. When date navigation was used, it links to the resulting filtered page. These counts describe the publications read before filtering to the selected day. Missing sources and unreadable dates remain distinct from a confirmed empty programme. Discovery and event results are cached for ten minutes; event cache entries are separate for each city and trip date, and retrying explicitly refreshes the city lookup. Coverage still depends on published navigation and supported formats; image-only posters, PDFs and calendars requiring unsupported browser requests are not automatically extracted.

**Venue calendars and travel guide** shows up to 25 OpenAgenda venue calendars. Its search covers current and upcoming programmes, independently of the day you selected. Open a programme or copy its venue-specific iCalendar link for the importer below.

The same panel independently looks up a nearby Wikivoyage guide. When the guide has an events or festivals section, it links to that section and lists the websites cited there, even when OpenAgenda has no calendars. These links are useful for checking dates with organisers. In the Russian interface, the site also checks the English edition when local festival links are missing. [Wikivoyage](https://www.wikivoyage.org/)

The browser saves the calendar references for each city for reuse. Opening a city again after 24 hours rechecks the directory. **Check again** requests an immediate refresh. If the directory is unavailable, the site labels any saved result with its original check time.

### Command line and tests

```sh
node bin/city.mjs "Budapest"
node --test
```

The first command prints a JSON array of matches. Each match includes the provider’s ID, the place name, and its coordinates. The region, country, country code, and time zone are `null` when the provider omits them. Use the ID and region to distinguish places with the same name.

An empty array means the search found no matching settlements. Try another spelling if you expect a match. For example, during testing, `Kyoto` returned results while `京都` returned an empty array. If the request fails, the command writes an error to standard error and exits with a nonzero status.

`node --test` checks city search, daily schedules, calendar and guide discovery, caching and event imports offline.

Place names and coordinates come from GeoNames via Open-Meteo. [Geocoding API documentation](https://open-meteo.com/en/docs/geocoding-api) · [GeoNames](https://www.geonames.org/)

### Import an event calendar

Pass the organizer’s direct iCalendar download URL. The importer writes JSON to standard output. These examples use two organizers’ own publications.

```sh
node bin/events.mjs "https://www.stmarysbc.com/events/christmas-fair-2026/ical/"
node bin/events.mjs "https://carlypaoli.com/events/italian-church-concert/?ical=1"
```

The import records the calendar URL and the UTC time it was checked. Each event includes its source UID, title, venue, published start and end, status, and organizer link when available. If an event has no link, its URL points to the calendar. An empty calendar produces an empty event list. Download and parsing errors go to standard error with a nonzero exit status.

Dates and clock times follow the publication. A date-only event has `time: null`, and its end date is exclusive. UTC times retain their UTC label. For local times, the importer uses the event’s time zone, then the calendar’s declared default if present. A floating time with neither has `timezone: null`. An explicit duration is kept when supplied. Each published event definition appears once per entry in the feed. Recurring series and their exceptions are identified for later expansion into a daily agenda.

## Development

The bilingual desktop website comes first. A mobile adaptation is planned for a later stage.

We keep ideas and acceptance criteria in a local `ROADMAP.md` at the repository root. Git ignores this file. We build one end-to-end feature at a time. Once it works through the website or CLI, we document how to use it here and remove the completed item from the roadmap.

We maintain a single application and keep data access separate from presentation. We introduce shared abstractions when multiple parts of the app need them. Cities such as Budapest serve as test cases. The app fetches its data automatically from external sources.
