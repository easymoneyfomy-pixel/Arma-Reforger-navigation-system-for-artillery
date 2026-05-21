import React from 'react';
import { MAP_PROFILES, DEFAULT_MAP } from '../data/map_profiles';

interface MapSelectorProps {
    mapId: string;
    onMapChange: (mapId: string) => void;
}

const MapSelector: React.FC<MapSelectorProps> = ({ mapId, onMapChange }) => {
    return (
        <div className="card">
            <div className="section-title">Карта</div>
            <div className="map-tabs">
                {MAP_PROFILES.map(profile => (
                    <button
                        key={profile.id}
                        className={`map-tab ${mapId === profile.id ? 'active' : ''}`}
                        onClick={() => onMapChange(profile.id)}
                        title={`${profile.displayName} — ${profile.worldWidth} × ${profile.worldHeight} м`}
                    >
                        {profile.displayName}
                        <span className="map-dims">
                            {profile.worldWidth.toLocaleString()}×{profile.worldHeight.toLocaleString()} м
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default MapSelector;

