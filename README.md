# Worth a Stop

Worth a Stop is a travel planner for people exploring a city on their own. You can search for a city and discover nearby event calendars. The planned map will help you find places that are open and events you can reach before you leave. For longer trips, you’ll be able to link days across cities and plan around train journeys, overnight stays, and existing bookings.

## Getting started

You can search for cities by name in the browser or from the command line. Both use the Open-Meteo geocoding API. The command line can also import an organizer’s published event calendar. Run the commands below from the repository root with Node.js 22 or later. Install the calendar parser before importing events or running the tests.

```sh
npm ci
```

### Website

```sh
node bin/site.mjs
```

Open `http://127.0.0.1:3000` in your browser. The site opens in Russian if your browser language is Russian and in English otherwise. Use the RU/EN switch to change languages. It remembers your choice on this device and refreshes the current search. City and region names appear in the selected language when the provider has a translation. Live searches require a connection to Open-Meteo.

Pick a destination under **Cities with event listings**, or start typing a city name. The destination buttons come from cities with current or upcoming OpenAgenda listings. Suggestions update after a short pause as you type. Select a city to open its calendars. The country and region help distinguish places with the same name.

If a search returns no cities, the website checks for nearby spellings in city names and, when needed, asks Wikipedia for a spelling suggestion. It checks the corrected name with the geocoder before showing it. For example, try `Lnodon` or `Будапшт`. Arrow Down moves keyboard focus from the search field to the first result.

**Nearby calendars** shows up to 25 OpenAgenda venue calendars. The search starts within 5 km of the city centre and expands to 25 km if the first search is empty. The result shows which radius was used. Open a programme or copy its venue-specific iCalendar link for the importer below. Names follow the publisher’s language. Coverage depends on contributions to the [public OpenAgenda directory](https://public.opendatasoft.com/explore/dataset/evenements-publics-openagenda/).

The same panel independently looks up a nearby Wikivoyage guide. When the guide has an events or festivals section, it links to that section and lists the websites cited there, even when OpenAgenda has no calendars. These links are useful for checking dates with organisers. In the Russian interface, the site also checks the English edition when local festival links are missing. [Wikivoyage](https://www.wikivoyage.org/)

The browser saves the calendar references for each city for reuse. Opening a city again after 24 hours rechecks the directory. **Check again** requests an immediate refresh. If the directory is unavailable, the site labels any saved result with its original check time.

### Command line and tests

```sh
node bin/city.mjs "Budapest"
node --test
```

The first command prints a JSON array of matches. Each match includes the provider’s ID, the place name, and its coordinates. The region, country, country code, and time zone are `null` when the provider omits them. Use the ID and region to distinguish places with the same name.

An empty array means the search found no matching settlements. Try another spelling if you expect a match. For example, during testing, `Kyoto` returned results while `京都` returned an empty array. If the request fails, the command writes an error to standard error and exits with a nonzero status.

`node --test` checks city search, calendar discovery, caching, and event imports offline.

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
