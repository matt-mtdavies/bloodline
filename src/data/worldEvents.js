/*
 * A curated, hand-picked spine of world history to run alongside the family
 * timeline — context, not content. Deliberately small and conservative:
 * every entry here is a well-established, unambiguous historical fact (no
 * live API, no AI generation) because a family-legacy product is exactly
 * the wrong place to risk a hallucinated date. `region` is one of the codes
 * below or 'global'; TimelineView biases toward whichever region the tree's
 * own people are actually from (see lib/worldEvents.js#detectRegion) and
 * always includes 'global' entries regardless of region.
 *
 * category: 'conflict' | 'invention' | 'culture' | 'politics' | 'science' | 'exploration'
 */
export const WORLD_EVENTS = [
  // ── 1830s ──────────────────────────────────────────────────────────────
  { year: 1830, title: 'The first inter-city passenger railway opens', detail: 'Liverpool and Manchester Railway', category: 'invention', region: 'global' },
  { year: 1833, title: 'Slavery abolished throughout the British Empire', category: 'politics', region: 'UK' },
  { year: 1836, title: 'The Battle of the Alamo', category: 'conflict', region: 'US' },
  { year: 1837, title: 'Victoria becomes Queen', category: 'politics', region: 'UK' },
  { year: 1839, title: 'Photography is announced to the world', detail: 'The daguerreotype process', category: 'invention', region: 'global' },

  // ── 1840s ──────────────────────────────────────────────────────────────
  { year: 1840, title: 'The Penny Black, the world’s first adhesive postage stamp', category: 'invention', region: 'UK' },
  { year: 1844, title: 'The first long-distance telegraph message is sent', category: 'invention', region: 'global' },
  { year: 1845, title: 'The Great Famine begins in Ireland', category: 'politics', region: 'IE' },
  { year: 1848, title: 'A wave of revolutions sweeps across Europe', category: 'politics', region: 'global' },
  { year: 1849, title: 'The California Gold Rush draws thousands west', category: 'culture', region: 'US' },

  // ── 1850s ──────────────────────────────────────────────────────────────
  { year: 1851, title: 'Gold is discovered in Victoria, sparking the Australian gold rush', category: 'culture', region: 'AU' },
  { year: 1851, title: 'The Great Exhibition opens at Crystal Palace', detail: 'London', category: 'culture', region: 'UK' },
  { year: 1853, title: 'The Crimean War begins', category: 'conflict', region: 'global' },
  { year: 1854, title: 'Gold miners clash with authorities at the Eureka Stockade', category: 'conflict', region: 'AU' },
  { year: 1859, title: 'Charles Darwin publishes On the Origin of Species', category: 'science', region: 'global' },

  // ── 1860s ──────────────────────────────────────────────────────────────
  { year: 1861, title: 'The American Civil War begins', category: 'conflict', region: 'US' },
  { year: 1863, title: 'The London Underground opens, the world’s first underground railway', category: 'invention', region: 'UK' },
  { year: 1865, title: 'The American Civil War ends; slavery is abolished in the US', category: 'politics', region: 'US' },
  { year: 1867, title: 'Canada becomes a confederated dominion', detail: 'Ontario, Quebec, Nova Scotia and New Brunswick unite', category: 'politics', region: 'CA' },
  { year: 1869, title: 'The Suez Canal opens', category: 'invention', region: 'global' },
  { year: 1869, title: 'The first transcontinental railroad is completed', category: 'invention', region: 'US' },

  // ── 1870s ──────────────────────────────────────────────────────────────
  { year: 1871, title: 'The German Empire is founded', category: 'politics', region: 'global' },
  { year: 1876, title: 'Alexander Graham Bell patents the telephone', detail: 'Invented while living in Ontario, Canada', category: 'invention', region: 'global' },
  { year: 1879, title: 'Thomas Edison demonstrates a practical electric light bulb', category: 'invention', region: 'global' },

  // ── 1880s ──────────────────────────────────────────────────────────────
  { year: 1883, title: 'Krakatoa erupts, heard thousands of miles away', category: 'science', region: 'global' },
  { year: 1885, title: 'The Canadian Pacific Railway is completed, linking the country coast to coast', category: 'invention', region: 'CA' },
  { year: 1886, title: 'Karl Benz patents the first practical automobile', category: 'invention', region: 'global' },
  { year: 1889, title: 'The Eiffel Tower is completed for the Paris World’s Fair', category: 'culture', region: 'global' },

  // ── 1890s ──────────────────────────────────────────────────────────────
  { year: 1893, title: 'New Zealand becomes the first country to grant women the vote', category: 'politics', region: 'NZ' },
  { year: 1895, title: 'The Lumière brothers screen the first motion picture', category: 'culture', region: 'global' },
  { year: 1896, title: 'The first modern Olympic Games are held, in Athens', category: 'culture', region: 'global' },
  { year: 1896, title: 'Gold is discovered in the Klondike, sparking a rush to Canada’s Yukon', category: 'culture', region: 'CA' },
  { year: 1899, title: 'The Second Boer War begins', category: 'conflict', region: 'global' },

  // ── 1900s ──────────────────────────────────────────────────────────────
  { year: 1901, title: 'Australia becomes a federated nation', category: 'politics', region: 'AU' },
  { year: 1903, title: 'The Wright brothers achieve the first powered flight', category: 'invention', region: 'global' },
  { year: 1908, title: 'Ford introduces the Model T', category: 'invention', region: 'global' },
  { year: 1909, title: 'Ernest Shackleton’s expedition comes within 100 miles of the South Pole', category: 'exploration', region: 'global' },

  // ── 1910s ──────────────────────────────────────────────────────────────
  { year: 1912, title: 'The Titanic sinks on its maiden voyage', category: 'culture', region: 'global' },
  { year: 1914, title: 'World War I begins', category: 'conflict', region: 'global' },
  { year: 1915, title: 'The Gallipoli campaign', category: 'conflict', region: 'AU' },
  { year: 1917, title: 'Canadian troops capture Vimy Ridge', category: 'conflict', region: 'CA' },
  { year: 1918, title: 'World War I ends', category: 'conflict', region: 'global' },
  { year: 1918, title: 'The Spanish flu pandemic sweeps the world', category: 'science', region: 'global' },

  // ── 1920s ──────────────────────────────────────────────────────────────
  { year: 1920, title: 'Women win the right to vote across the United States', category: 'politics', region: 'US' },
  { year: 1922, title: 'The Irish Free State is established', category: 'politics', region: 'IE' },
  { year: 1927, title: 'The Jazz Singer premieres, the first "talkie" film', category: 'culture', region: 'global' },
  { year: 1928, title: 'Alexander Fleming discovers penicillin', category: 'science', region: 'global' },
  { year: 1929, title: 'The "Persons Case" rules Canadian women are legally persons, eligible for the Senate', category: 'politics', region: 'CA' },
  { year: 1929, title: 'The Wall Street Crash triggers the Great Depression', category: 'politics', region: 'global' },

  // ── 1930s ──────────────────────────────────────────────────────────────
  { year: 1932, title: 'The Sydney Harbour Bridge opens', category: 'culture', region: 'AU' },
  { year: 1936, title: 'The BBC launches the world’s first regular television service', category: 'invention', region: 'UK' },
  { year: 1939, title: 'World War II begins', category: 'conflict', region: 'global' },

  // ── 1940s ──────────────────────────────────────────────────────────────
  { year: 1942, title: 'Japan bombs Darwin, the first attack on Australian soil', category: 'conflict', region: 'AU' },
  { year: 1945, title: 'World War II ends', category: 'conflict', region: 'global' },
  { year: 1947, title: 'India and Pakistan gain independence', category: 'politics', region: 'global' },
  { year: 1948, title: 'The National Health Service is founded', category: 'politics', region: 'UK' },
  { year: 1949, title: 'NATO is founded', category: 'politics', region: 'global' },
  { year: 1949, title: 'Newfoundland joins Canada as its tenth province', category: 'politics', region: 'CA' },

  // ── 1950s ──────────────────────────────────────────────────────────────
  { year: 1953, title: 'Elizabeth II is crowned Queen', category: 'politics', region: 'UK' },
  { year: 1953, title: 'Hillary and Norgay reach the summit of Everest', category: 'exploration', region: 'global' },
  { year: 1956, title: 'Television broadcasting begins, the same year Melbourne hosts the Olympics', category: 'invention', region: 'AU' },
  { year: 1957, title: 'The Soviet Union launches Sputnik, the first artificial satellite', category: 'science', region: 'global' },

  // ── 1960s ──────────────────────────────────────────────────────────────
  { year: 1963, title: 'President John F. Kennedy is assassinated', category: 'politics', region: 'US' },
  { year: 1965, title: 'Canada adopts the red maple leaf flag', category: 'politics', region: 'CA' },
  { year: 1966, title: 'Australia switches to decimal currency', category: 'culture', region: 'AU' },
  { year: 1967, title: 'Expo 67 and Canada’s centennial draw the world to Montreal', category: 'culture', region: 'CA' },
  { year: 1969, title: 'Apollo 11 lands the first humans on the Moon', category: 'exploration', region: 'global' },

  // ── 1970s ──────────────────────────────────────────────────────────────
  { year: 1971, title: 'Decimal currency is introduced', category: 'culture', region: 'UK' },
  { year: 1973, title: 'The Sydney Opera House opens', category: 'culture', region: 'AU' },
  { year: 1973, title: 'The UK joins the European Economic Community', category: 'politics', region: 'UK' },
  { year: 1974, title: 'Cyclone Tracy devastates Darwin on Christmas Day', category: 'science', region: 'AU' },
  { year: 1975, title: 'The Vietnam War ends', category: 'conflict', region: 'global' },

  // ── 1980s ──────────────────────────────────────────────────────────────
  { year: 1981, title: 'The first IBM Personal Computer is released', category: 'invention', region: 'global' },
  { year: 1982, title: 'Canada patriates its Constitution, adding the Charter of Rights and Freedoms', category: 'politics', region: 'CA' },
  { year: 1983, title: 'The first handheld mobile phone goes on sale', category: 'invention', region: 'global' },
  { year: 1986, title: 'The Chernobyl nuclear disaster', category: 'science', region: 'global' },
  { year: 1989, title: 'The Berlin Wall falls', category: 'politics', region: 'global' },

  // ── 1990s ──────────────────────────────────────────────────────────────
  { year: 1990, title: 'Nelson Mandela is released after 27 years', category: 'politics', region: 'global' },
  { year: 1991, title: 'The World Wide Web becomes publicly available', category: 'invention', region: 'global' },
  { year: 1994, title: 'South Africa holds its first fully democratic election', category: 'politics', region: 'global' },
  { year: 1997, title: 'Hong Kong is returned to China', category: 'politics', region: 'global' },

  // ── 2000s ──────────────────────────────────────────────────────────────
  { year: 2000, title: 'Sydney hosts the Olympic Games', category: 'culture', region: 'AU' },
  { year: 2001, title: 'The September 11 attacks', category: 'conflict', region: 'US' },
  { year: 2004, title: 'Facebook is founded', category: 'culture', region: 'global' },
  { year: 2007, title: 'The first iPhone is released', category: 'invention', region: 'global' },

  // ── 2010s ──────────────────────────────────────────────────────────────
  { year: 2010, title: 'Vancouver hosts the Winter Olympic Games', category: 'culture', region: 'CA' },
  { year: 2011, title: 'The Fukushima nuclear disaster follows a major earthquake and tsunami', category: 'science', region: 'global' },
  { year: 2012, title: 'London hosts the Olympic Games', category: 'culture', region: 'UK' },
  { year: 2016, title: 'The UK votes to leave the European Union', detail: 'Brexit referendum', category: 'politics', region: 'UK' },
  { year: 2019, title: 'The first-ever image of a black hole is released', category: 'science', region: 'global' },

  // ── 2020s ──────────────────────────────────────────────────────────────
  { year: 2020, title: 'COVID-19 is declared a global pandemic', category: 'science', region: 'global' },
  { year: 2022, title: 'Queen Elizabeth II dies after 70 years on the throne', category: 'politics', region: 'UK' },
];

export const CATEGORY_LABELS = {
  conflict: 'Conflict',
  invention: 'Invention',
  culture: 'Culture',
  politics: 'Politics',
  science: 'Science',
  exploration: 'Exploration',
};
