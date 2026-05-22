/**
 * Arma Reforger Map Profiles - parsed from map_profiles.json
 * 
 * This file converts the raw JSON data into the format expected by the app.
 * 
 * To add new maps:
 * 1. Add the map data to src/data/arma_reforger/map_profiles.json
 * 2. The parser below will automatically pick it up
 */

import { mapProfilesJson } from './map_profiles.json';

export interface MapProfile {
  id: string;
  displayName: string;
  worldWidth: number;   // metres (X axis)
  worldHeight: number;  // metres (Y axis)
}

// Parse the JSON data into the expected format
export const MAP_PROFILES: MapProfile[] = Object.values(mapProfilesJson.profiles).map(profile => ({
  id: profile.world_id,
  displayName: profile.world_id.charAt(0).toUpperCase() + profile.world_id.slice(1), // Capitalize first letter
  worldWidth: profile.world_x2_m - profile.world_x1_m,
  worldHeight: profile.world_y2_m - profile.world_y1_m
}));

// Fallback to default maps if none found
if (MAP_PROFILES.length === 0) {
  // This should never happen with the current JSON, but just in case
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
}

export const MAP_SIZES: Record<string, number> = MAP_PROFILES.reduce(
  (acc, p) => {
    acc[p.id] = p.worldWidth;
    return acc;
  },
  {} as Record<string, number>
);

export const DEFAULT_MAP = MAP_PROFILES.length > 0 ? MAP_PROFILES[0].id : 'everon';