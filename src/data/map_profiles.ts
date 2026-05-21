/**
 * Map Profiles — world dimensions (metres) for Arma Reforger official maps.
 *
 * Values sourced from the game's .ent world data:
 *   Everon   – 40 000 × 40 000 m  (map_profiles.json key everon)
 *   Arland   – 24 500 × 24 500 m
 *   Malden   – 25 500 × 25 500 m
 *
 * The TacticalMap CRS uses 1 map unit == 1 metre.
 */

export interface MapProfile {
  id: string;
  displayName: string;
  worldWidth: number;   // metres (X axis)
  worldHeight: number;  // metres (Y axis)
}

export const MAP_PROFILES: MapProfile[] = [
  {
    id: 'everon',
    displayName: 'Everon',
    worldWidth: 39900,
    worldHeight: 39900,
  },
  {
    id: 'arland',
    displayName: 'Arland',
    worldWidth: 24500,
    worldHeight: 24500,
  },
  {
    id: 'malden',
    displayName: 'Malden',
    worldWidth: 25500,
    worldHeight: 25500,
  },
];

export const MAP_SIZES: Record<string, number> = MAP_PROFILES.reduce(
  (acc, p) => {
    acc[p.id] = p.worldWidth;
    return acc;
  },
  {} as Record<string, number>,
);

export const DEFAULT_MAP = 'everon';
