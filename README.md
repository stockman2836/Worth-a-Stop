# Worth a Stop

Worth a Stop is a travel planner for people exploring a city on their own. Choose a city and a date to see nearby events, local times, venues and links to the published listings. The planned map will help you find places that are open and events you can reach before you leave. For longer trips, you’ll be able to link days across cities and plan around train journeys, overnight stays, and existing bookings.

## Getting started

You can search for cities by name in the browser or from the command line. Both use the Open-Meteo geocoding API. The command line can also import an organizer’s published event calendar. Run the commands below from the repository root with Node.js 22 or later. Install the dependencies before starting the website, importing events or running the tests.

```sh
npm ci
```

### Website

```sh
node bin/site.mjs
```

Open `http://127.0.0.1:3000` in your browser. The site opens in Russian if your browser language is Russian and in English otherwise. Use the RU/EN switch to change languages. It remembers your choice on this device and refreshes the current search. City and region names appear in the selected language when the provider has a translation. Live searches require a connection to Open-Meteo.

Pick a destination under **Cities with event listings**, or start typing a city name. The destination buttons come from cities with current or upcoming OpenAgenda listings. Suggestions update after a short pause as you type. Select a city to open its daily agenda. The country and region help distinguish places with the same name.

If a search returns no cities, the website checks for nearby spellings in city names and, when needed, asks Wikipedia for a spelling suggestion. It checks the corrected name with the geocoder before showing it. For example, try `Lnodon` or `Будапшт`. Arrow Down moves keyboard focus from the search field to the first result.

Open **Nearby places** in a city card to explore up to twelve named markets, parks, gardens, viewpoints, museums and galleries within 2 km of the city centre. Distances are straight-line estimates to mapped points or area centres. Each name links to its OpenStreetMap object. Opening hours appear as published when available. The shortlist includes the nearest example of each available category before filling the remaining positions by distance. [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

Each place also appears on an interactive map. Select its name in the list to zoom to its marker and open the published hours and source link. Selecting a marker highlights its list entry. The map uses Leaflet and OpenStreetMap tiles.

Choose a check date and local time under Nearby places to see Open, Closed or Opening hours unknown in the list and map popups. The date is shared with the daily agenda, and switching languages keeps the selected time. The opening_hours parser handles weekly schedules, split intervals, seasonal dates and overnight hours. Rules involving public or school holidays or astronomical times are labelled unknown until the required local context is available. Missing, invalid or explicitly uncertain schedules also remain unknown. A missing city time zone or a nonexistent local time during a daylight-saving transition produces an unknown state.

Drag the time slider or enter a local time to update the map and agenda. Events are labelled Ongoing, Starts within an hour, Later, Ended or Event time unknown. Available now filters the map and both lists to open places and ongoing events. It hides unknown schedules and sold-out events. Events with an unpublished end time remain unknown once they start. Switching languages keeps the selected time and filter. Ambiguous local times during a daylight-saving clock change are also treated as unknown.

Events with published venue coordinates appear as diamond markers on the same map. Select **Show on map** in the daily agenda to open the venue, local session time and publisher link. Changing the trip date replaces the event markers. Events without coordinates remain in the agenda with an explicit location notice. Online events stay in the list. The event map works even when the nearby-place source is unavailable.

The server caches place results for one hour and shares the same lookup across interface languages. If the primary Overpass endpoint fails, it tries a second public endpoint. The browser saves the last successful shortlist for each city centre. If a later request fails, it shows that shortlist with its original check time and a retry button. Without saved results it shows a loading error. Opening hours retain OpenStreetMap notation.

Under **Events by day**, choose Today, Tomorrow or a trip date. The site reads the individual sessions published in OpenAgenda. A multi-day event appears on each day it overlaps, and a recurring performance appears on its scheduled dates. Times use the destination’s time zone, shown alongside the results. When the city has no known time zone, the agenda uses UTC. Switching languages keeps the selected date.

The daily search starts within 5 km of the city centre and expands to 25 km if it finds no sessions. Cancelled and indefinitely postponed listings are omitted. Sold-out events are labelled. When two publishers list the same title at the same venue and start time, the latest publication takes precedence. A source failure offers a retry, and an incomplete schedule is labelled. Event and venue names follow the publisher’s language. [OpenAgenda public dataset](https://public.opendatasoft.com/explore/dataset/evenements-publics-openagenda/)

Open **Venue calendars and travel guide** to find the city's official calendar. The local server looks up the GeoNames ID in Wikidata and checks the municipal website and any explicitly identified official tourism portal in the English Wikipedia article. A link appears when the portal publishes recognizable event navigation. These links open the publisher's calendar. Events by day also reads published dates from these calendars. It reads structured Event records, including individual performances, and supported local date tables. When the index contains no structured events, it checks up to twelve linked detail pages. Results are cached for ten minutes. City listings are labelled and link to the publisher. Coverage depends on the markup and the events visible on the calendar index.

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
