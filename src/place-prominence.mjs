const order = { highlight: 0, notable: 1, local: 2 };

export function prominenceSignals(tags) {
  return {
    documented: Boolean(tags.wikipedia || tags.wikidata),
    wikipedia: Boolean(tags.wikipedia),
    languages: new Set(Object.keys(tags).filter(key => /^name:[a-z]{2,3}(?:-[a-z\d]+)*$/i.test(key) && tags[key])
      .map(key => key.split(':')[1].split('-')[0].toLowerCase())).size,
    heritage: Boolean(tags.heritage),
    international: tags.importance === 'international',
  };
}

export function classifyProminence(places) {
  const strongest = places.reduce((score, place) => place.signals.documented ? Math.max(score, place.rank) : score, 0);
  // A source-evidence threshold, not a quota. Smaller towns use their own signal range.
  const threshold = Math.min(27, Math.max(14, strongest * .75));
  return places.map(place => {
    const { signals, rank, identity, ...value } = place;
    const cultural = ['museum', 'gallery'].includes(place.category) && signals.languages >= 5;
    const outdoors = ['park', 'garden', 'viewpoint'].includes(place.category) && signals.wikipedia && signals.languages >= 3;
    const highlight = signals.documented && (rank >= threshold || signals.international || cultural || outdoors);
    const prominence = highlight ? 'highlight' : signals.documented || signals.heritage ? 'notable' : 'local';
    const reasons = [signals.documented && 'documented', signals.languages >= 3 && 'multilingual',
      signals.heritage && 'heritage', signals.international && 'international'].filter(Boolean);
    return { ...value, prominence, ...(highlight && { prominenceReasons: reasons }) };
  }).sort((a, b) => order[a.prominence] - order[b.prominence]);
}
