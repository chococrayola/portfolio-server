/* popdata.js — real Puerto Rico demographics.
 *
 * 2020 U.S. Census population for each of the 78 municipios. Used to size each
 * city's CAPACITY and its starting population, so San Juan is a metropolis and
 * Culebra is a hamlet — the island feels real. (Source: U.S. Census Bureau /
 * citypopulation.de, 2020 Census.)
 */

export const MUNI_POP = {
  'Adjuntas': 18018, 'Aguada': 38136, 'Aguadilla': 55100, 'Aguas Buenas': 24223,
  'Aibonito': 24637, 'Añasco': 25596, 'Arecibo': 87744, 'Arroyo': 15842,
  'Barceloneta': 22659, 'Barranquitas': 28980, 'Bayamón': 185184, 'Cabo Rojo': 47156,
  'Caguas': 127246, 'Camuy': 32836, 'Canóvanas': 42356, 'Carolina': 154814,
  'Cataño': 23160, 'Cayey': 41653, 'Ceiba': 11301, 'Ciales': 16988,
  'Cidra': 39973, 'Coamo': 34665, 'Comerío': 18885, 'Corozal': 34542,
  'Culebra': 1792, 'Dorado': 35876, 'Fajardo': 32123, 'Florida': 11692,
  'Guánica': 13788, 'Guayama': 36614, 'Guayanilla': 17779, 'Guaynabo': 89785,
  'Gurabo': 40605, 'Hatillo': 38493, 'Hormigueros': 15653, 'Humacao': 50895,
  'Isabela': 42944, 'Jayuya': 14780, 'Juana Díaz': 46541, 'Juncos': 37009,
  'Lajas': 23335, 'Lares': 28108, 'Las Marías': 8867, 'Las Piedras': 35178,
  'Loíza': 23690, 'Luquillo': 17779, 'Manatí': 39497, 'Maricao': 4754,
  'Maunabo': 10586, 'Mayagüez': 73080, 'Moca': 37460, 'Morovis': 28726,
  'Naguabo': 23391, 'Naranjito': 29238, 'Orocovis': 21433, 'Patillas': 15986,
  'Peñuelas': 20390, 'Ponce': 137491, 'Quebradillas': 23629, 'Rincón': 15190,
  'Río Grande': 47061, 'Sabana Grande': 22731, 'Salinas': 25786, 'San Germán': 31880,
  'San Juan': 342263, 'San Lorenzo': 37691, 'San Sebastián': 39345, 'Santa Isabel': 20280,
  'Toa Alta': 66883, 'Toa Baja': 75294, 'Trujillo Alto': 67742, 'Utuado': 28292,
  'Vega Alta': 35390, 'Vega Baja': 54415, 'Vieques': 8250, 'Villalba': 22094,
  'Yabucoa': 30428, 'Yauco': 34178,
};

// One in-game "citizen" represents roughly this many real people. Tuned so the
// whole island holds ~2,000 agents (San Juan ≈ 215, Culebra ≈ 4).
export const PEOPLE_PER_CITIZEN = 1600;
