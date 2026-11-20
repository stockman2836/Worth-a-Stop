import { searchCities } from '../src/cities.mjs';

const query = process.argv.slice(2).join(' ');

if (query === '--help') {
  console.log('Поиск города: node bin/city.mjs "название города"');
} else {
  try {
    const cities = await searchCities(query);
    console.log(JSON.stringify(cities, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
