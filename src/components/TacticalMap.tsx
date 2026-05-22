import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap, Rectangle, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_PROFILES, DEFAULT_MAP } from '../data/arma_reforger/map_profiles';

// Fix Leaflet icon issue by using CDN or standard URLs
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface Position {
    x: number;
    y: number;
}

interface TacticalMapProps {
    playerPos: Position;
    targetPos: Position;
    onPlayerMove: (pos: Position) => void;
    onTargetMove: (pos: Position) => void;
    mapId?: string;
    onMapChange?: (mapId: string) => void;
}

const MapController = ({ mapId }: { mapId: string }) => {
    const map = useMap();
    useEffect(() => {
        const size = MAP_PROFILES.find(p => p.id === mapId)?.worldWidth ?? MAP_PROFILES[0]?.worldWidth ?? 39900;
        map.setMaxBounds([[0, 0], [size, size]]);
    }, [map, mapId]);
    return null;
};

const TacticalMap: React.FC<TacticalMapProps> = ({
    playerPos,
    targetPos,
    onPlayerMove,
    onTargetMove,
    mapId = DEFAULT_MAP,
}) => {

    const mapProfile = MAP_PROFILES.find(p => p.id === mapId) ?? MAP_PROFILES[0];
    const MapSize = mapProfile.worldWidth;

    const GridLayer = () => {
        const map = useMap();
        useEffect(() => {
            const grid = L.layerGroup();
            for (let i = 0; i <= MapSize; i += 1000) {
                L.polyline([[0, i], [MapSize, i]], { color: '#2f343c', weight: 1, opacity: 0.5 }).addTo(grid);
                L.polyline([[i, 0], [i, MapSize]], { color: '#2f343c', weight: 1, opacity: 0.5 }).addTo(grid);
            }
            grid.addTo(map);
            return () => { grid.remove(); };
        }, [map, MapSize]);
        return null;
    };

    const MapEvents = () => {
        useMapEvents({
            click(e) {
                onTargetMove({ x: e.latlng.lng, y: e.latlng.lat });
            },
        });
        return null;
    };

    const handlePlayerDrag = (e: any) => {
        const marker = e.target;
        const position = marker.getLatLng();
        onPlayerMove({ x: position.lng, y: position.lat });
    };

    const handleTargetDrag = (e: any) => {
        const marker = e.target;
        const position = marker.getLatLng();
        onTargetMove({ x: position.lng, y: position.lat });
    };

    return (
        <div className="map-container">
            <MapContainer
                center={[playerPos.y, playerPos.x]}
                zoom={11}
                scrollWheelZoom={true}
                crs={L.CRS.Simple}
                style={{ height: '100%', width: '100%' }}
                minZoom={-2}
                maxZoom={6}
            >
                <MapController mapId={mapId} />
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
                    maxZoom={19}
                />
                <GridLayer />
                <MapEvents />

                <Rectangle bounds={[[0, 0], [MapSize, MapSize]]} pathOptions={{ fillColor: '#1a1d21', fillOpacity: 1, color: '#2f343c', weight: 2 }} />

                <Polyline
                    positions={[[playerPos.y, playerPos.x], [targetPos.y, targetPos.x]]}
                    color="var(--accent)"
                    dashArray="5, 10"
                    weight={2}
                />

                <Marker
                    position={[playerPos.y, playerPos.x]}
                    draggable={true}
                    eventHandlers={{ dragend: handlePlayerDrag }}
                >
                    <Popup>Орудие (Weapon)</Popup>
                </Marker>

                <Marker
                    position={[targetPos.y, targetPos.x]}
                    draggable={true}
                    eventHandlers={{ dragend: handleTargetDrag }}
                >
                    <Popup>Цель (Target)</Popup>
                </Marker>
            </MapContainer>
        </div>
    );
};

export default TacticalMap;

