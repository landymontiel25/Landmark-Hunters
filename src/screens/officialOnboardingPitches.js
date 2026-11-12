// Test tab "Official Onboarding" (owner, 2026-11-12): the line under each
// place's name on a swipe card. Each says what the place is, compares it to a
// landmark most travelers know, and gives one reason to go. Facts come from
// the place's own data (src/data/landmarks.*.js) plus checks on the claims
// the data doesn't hold: Versailles hosts presidents and candidates
// (nbcnews.com cafecito-presidential-sightings-landmark-miami-restaurant-
// turns-50), Balbianello was a Star Wars: Attack of the Clones and Casino
// Royale set (italia.it casino-royale-tour-historic-villas), the Iron Crown
// sits in Monza's cathedral (museoduomomonza.it/en/iron-crown), Clooney owns
// Villa Oleandra in Laglio (explorelakecomo.com/go/villa-oleandra). Keyed by
// landmark id. A place with no line here falls back to its first fact.
export const PITCHES = {
  // Miami
  'ocean-drive': "Miami's most famous street, in the league of Fifth Avenue or Park Avenue. Pastel Art Deco hotels glow neon at night, steps from the sand.",
  'miami-beach-art-deco-historic-district': "The world's largest collection of Art Deco buildings, about 800 of them. Picture the Chrysler Building's style across a whole walkable neighborhood.",
  'south-beach': "Miami's answer to Rio's Copacabana: a long city beach with Art Deco hotels behind it and the best people-watching in front.",
  'wynwood-walls': "An outdoor museum of giant street art, Miami's answer to London's Shoreditch. Whole warehouse walls painted by artists from around the world.",
  'calle-ocho': 'The main street of Little Havana, like a Little Italy that locals still call home. Order a cafecito at a street window.',
  'lincoln-road': 'A pedestrian-only promenade nicknamed the Fifth Avenue of the South. Think Santa Monica’s Third Street Promenade, with palm trees.',
  'bayside-marketplace': "Waterfront shopping and dining on Biscayne Bay, like Boston's Faneuil Hall. Grab a drink with boats and the downtown skyline in view.",
  'the-villa-casa-casuarina': "Gianni Versace's former mansion, built in 1930 and modeled on a 16th-century palace. Miami's Beverly Hills star home, right on Ocean Drive.",
  'maximo-gomez-park-domino-park': "Old Cuban men play dominoes here all day, like the chess tables of New York's Washington Square. A real slice of Little Havana life.",
  'bill-baggs-park': "A lighthouse beach at the tip of Key Biscayne, like Cape Cod's, with the Miami skyline across the water. About 400 acres of sand and trees.",
  'cape-florida-lighthouse': "Miami-Dade's oldest standing structure, built in 1825. Go up for ocean views and a look back at the city skyline.",
  'vizcaya-museum-and-gardens': "An Italian Renaissance villa on Biscayne Bay, Miami's Newport mansion. Gardens run to the water and 400 years of European art fill the rooms.",
  'miami-design-district': "A luxury shopping and design district, Miami's Rodeo Drive with public art mixed in. Flagship boutiques, plus the Institute of Contemporary Art.",
  'espanola-way': 'A 1925 pedestrian lane built as a Spanish village, like a Barcelona side street dropped into South Beach. Cafés, boutiques and pastel walls.',
  'south-pointe-park-and-pier': "Miami Beach's Battery Park: ocean on one side, the ship channel on the other. Watch cruise ships glide out to sea.",
  'miami-beach-boardwalk': "Miles of oceanfront path along the dunes, like Santa Monica's beach path. Walk, jog or bike with the Atlantic beside you.",
  'versailles-restaurant': "Since 1971 the town square of Miami's Cuban community, where presidents and candidates stop for a cafecito. Try the Cuban sandwich and pastelitos.",
  'joes-stone-crab': "A Miami Beach institution since 1913, Miami's Katz's Deli. Stone crab claws with mustard sauce are the order.",
  'crandon-park': 'A big beach park on Key Biscayne, like Jones Beach near New York. Built on a former coconut plantation, with room for the whole group.',

  // Philadelphia
  'liberty-bell-center': "Philadelphia's Statue of Liberty: the cracked 1752 bell that became a symbol of freedom. Free to see up close.",
  'independence-hall': "America's Houses of Parliament: where both the Declaration of Independence and the Constitution were signed. A UNESCO World Heritage Site.",
  'reading-terminal-market': "A food hall running since 1893 with nearly 80 vendors, Philly's Pike Place Market. Come hungry and wander the Pennsylvania Dutch stands.",
  'rocky-steps-and-rocky-statue': "The steps Rocky ran up in 1976, Philly's Abbey Road crosswalk. Run up, raise your arms and pose with the bronze statue.",
  'philadelphia-museum-of-art': "One of the largest art collections in the US, Philly's Met, behind a Greek Revival facade. The famous steps are right outside.",
  'eastern-state-penitentiary': "Philly's Alcatraz: the 1829 prison where Al Capone served time. Now a preserved site you can walk through.",
  'love-park': "Home of Robert Indiana's LOVE sculpture since 1976, Philly's Charging Bull for photos. City Hall rises right behind it.",
  'the-franklin-institute': "Founded in 1824, Philly's answer to Chicago's Museum of Science and Industry. Walk through a giant human heart.",
  'philadelphia-zoo': "America's first zoo (1874), older than the Bronx Zoo. Zoo360 trails let animals roam above your head.",
  'elfreths-alley': "Often called the oldest continuously lived-in street in the US, since 1702. Philly's answer to Boston's Acorn Street, with 32 colonial rowhouses.",
  'lincoln-financial-field': "Home of the Eagles and a 2026 FIFA World Cup venue. One of the NFL's loudest crowds, in the spirit of Seattle's Lumen Field.",
  'philadelphia-city-hall': "The tallest habitable building in the world when it opened in 1901, Philly's Empire State Building before there was one. William Penn stands on top.",
  'william-h-gray-iii-30th-street-station': "A 1933 Art Deco hall, Philly's Grand Central. Worth a look even if you're not catching a train.",
  'citizens-bank-park': "The Phillies' ballpark, known for its food like San Francisco's Oracle Park. Walk Ashburn Alley before first pitch.",
  'barnes-foundation': "One of the world's biggest private collections of Renoir and Cézanne, like New York's Frick, hung the way Barnes wanted.",
  'valley-forge-national-historical-park': "Where Washington's army survived the winter of 1777 to 1778, the Revolution's Gettysburg. Over 3,500 acres of trails, free to enter.",
  'boathouse-row': "Historic rowing clubhouses outlined in lights since the 1970s, Philly's postcard view at night. A National Historic Landmark.",

  // Milan and Monza
  'duomo-di-milano': "Italy's largest church, begun in 1386 and finished in the 20th century. Milan's Notre-Dame, in pink-veined marble.",
  'galleria-vittorio-emanuele-ii': "A glass-domed arcade from the 1860s, like London's Burlington Arcade but grander. Milan calls it the city's living room.",
  'the-last-supper': "Leonardo's mural from 1495 to 1498, Milan's Mona Lisa. It hangs on a convent wall and opens in small timed groups, so book ahead.",
  'duomo-rooftops': "Walk among the Duomo's marble spires and statues, about 250 steps or an elevator up. On clear days you can see the Alps.",
  'teatro-alla-scala': "Open since 1778, Milan's Metropolitan Opera and one of the world's most famous opera houses. Catch a show or tour the museum.",
  'castello-sforzesco': "A 15th-century fortress of the Sforza dukes, Milan's Tower of London. Walk through its courtyards into Parco Sempione.",
  'navigli-district': "Canals from the Middle Ages with locks designed by Leonardo. Milan's Amsterdam, lined with aperitivo bars at sunset.",
  'parco-sempione': "Milan's Central Park, laid out in 1888 behind the Sforza Castle. A green break between sights.",
  'san-siro-stadium': "Home of both AC Milan and Inter, seating about 75,000. Italy's Camp Nou for football.",
  'pinacoteca-di-brera': "Milan's Uffizi: one of Italy's greatest art galleries, open since 1809. A calm detour in the Brera district.",
  'quadrilatero-della-moda': "Milan's fashion quadrilateral, the city's Fifth Avenue. Window-shop the flagship stores of Italian designers.",
  'bosco-verticale': "Two apartment towers with about 900 trees on their balconies, like Singapore's Gardens by the Bay in skyscraper form.",
  'piazza-gae-aulenti': "A raised round plaza from 2012 beneath Italy's tallest building, Milan's La Défense. The modern side of Milan.",
  'milano-centrale': "A monumental 1931 station, Italy's Grand Central. Worth a look for the grand halls alone.",
  'autodromo-nazionale-monza': "The Temple of Speed, open since 1922 and home of the Italian Grand Prix. Milan's Silverstone, a short ride away.",
  'royal-villa-of-monza': 'A neoclassical royal palace from the 1770s inside a huge park, a Versailles in miniature. An easy day trip from Milan.',
  'duomo-di-monza': 'Founded around 595 and home of the Iron Crown. Green-and-white striped marble, like a small Florence Duomo.',
  'camparino-in-galleria': "Opened by the Campari family in 1915 at the Galleria's entrance, one of the birthplaces of Milan's aperitivo. Milan's Harry's Bar.",
  'luini-panzerotti': "A tiny bakery behind the Duomo serving panzerotti since 1949, Milan's Joe's Pizza. Expect a line and a hot, cheesy pocket.",

  // Lake Como
  'villa-del-balbianello': 'A 1787 villa on a wooded promontory with terraced gardens, used as a set in Star Wars and Casino Royale. Like stepping into a Bond film.',
  'villa-carlotta': "A villa with gardens across about 8 hectares of terraces above the lake, Lake Como's Kew Gardens.",
  'duomo-di-como': "Built over three centuries from 1396. Como's smaller, quieter Milan Duomo, with Gothic and Renaissance detail.",
  'como-historic-center': 'An old town that still follows its Roman street grid, around the Duomo and the striped Broletto. Like a smaller Verona for an afternoon stroll.',
  'villa-olmo': "A neoclassical lakefront villa from the 18th century with a free public park. Como's Villa Borghese.",
  'cernobbio-waterfront': 'A lakefront piazza with cafés and gelaterias beside grand villas, like Nice’s Promenade des Anglais on a lake.',
  'villa-deste-cernobbio': "A villa commissioned in 1568 and known for its grand hotel, the lake's Ritz. Stroll the gardens and the waterfront.",
  'isola-comacina-viewpoint': "Lake Como's only island, where a town and nine churches stood until 1169. A short boat ride from Sala Comacina.",
  'lenno-waterfront': 'A small beach town in the sheltered Gulf of Venus. Its pier is the boat stop for Villa del Balbianello.',
  'tremezzo-waterfront': "Looks straight across to Bellagio, one of the lake's best viewpoints. Like the Brooklyn Heights promenade, the view is the point.",
  'piazza-cavour-como': "Como's lakefront square and the departure point for ferries and boat tours. The lake's Grand Central.",
  'brienno': "A medieval village built right on the rock at the waterline. Cinque Terre's Manarola, but on a lake.",
  'villa-bernasconi': "A 1905 villa built for a silk manufacturer, Italian Art Nouveau in the family of Barcelona's Casa Batlló.",
  'villa-oleandra-viewpoint': 'One of the lake’s most photographed shorelines, in the village where George Clooney owns Villa Oleandra. The villas are private, so admire them from the road or a boat.',
  'sacro-monte-di-ossuccio': 'A UNESCO-listed path of 14 chapels built from 1635 to 1710, with statues and frescoes. A mini Camino de Santiago above the lake.',
};

// The line for a place: its pitch, else its first fact.
export const pitchFor = (landmark) => PITCHES[landmark?.id] || landmark?.facts?.[0] || '';
