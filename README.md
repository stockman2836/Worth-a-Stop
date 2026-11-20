# Worth a Stop

Worth a Stop is a travel planner for people exploring a city on their own. City search is available today. The planned map will help you find places that are open and events you can reach before you leave. For longer trips, you’ll be able to link days across cities and plan around train journeys, overnight stays, and existing bookings.

## Getting started

You can search for cities by name in the browser or from the command line. Both use the Open-Meteo geocoding API. Run the commands below from the repository root with Node.js 22 or later.

### Website

```sh
node bin/site.mjs
```

Open `http://127.0.0.1:3000` in your browser. The site opens in Russian if your browser language is Russian and in English otherwise. Use the RU/EN switch to change languages. It remembers your choice on this device and refreshes the current search. City and region names appear in the selected language when the provider has a translation. Live searches require a connection to Open-Meteo.

### Command line and tests

```sh
node bin/city.mjs "Budapest"
node --test
```

The first command prints a JSON array of matches. Each match includes the provider’s ID, the place name, and its coordinates. The region, country, country code, and time zone are `null` when the provider omits them. Use the ID and region to distinguish places with the same name.

An empty array means the search found no matching settlements. Try another spelling if you expect a match. For example, during testing, `Kyoto` returned results while `京都` returned an empty array. If the request fails, the command writes an error to standard error and exits with a nonzero status.

`node --test` checks how the app handles geocoder responses and runs offline.

Place names and coordinates come from GeoNames via Open-Meteo. [Geocoding API documentation](https://open-meteo.com/en/docs/geocoding-api) · [GeoNames](https://www.geonames.org/)

## Development

The bilingual desktop website comes first. A mobile adaptation is planned for a later stage.

We keep ideas and acceptance criteria in a local `ROADMAP.md` at the repository root. Git ignores this file. We build one end-to-end feature at a time. Once it works through the website or CLI, we document how to use it here and remove the completed item from the roadmap.

We maintain a single application and keep data access separate from presentation. We introduce shared abstractions when multiple parts of the app need them. Cities such as Budapest serve as test cases. The app fetches its data automatically from external sources.
