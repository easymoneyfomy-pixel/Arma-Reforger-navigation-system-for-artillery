import React, { useState, useEffect, useMemo } from 'react';
import { BallisticCalculator, CalculatorInput } from '../logic/ballistics';
import ballisticData from '../data/ballistic_data.json';

const calculator = new BallisticCalculator(ballisticData as any);

const ArtilleryCalculator: React.FC = () => {
    const [gun, setGun] = useState({ x: 0, y: 0, alt: 0 });
    const [target, setTarget] = useState({ x: 0, y: 0, alt: 0 });
    const [weaponId, setWeaponId] = useState('mortar');
    const [solution, setSolution] = useState<any>(null);

    const input = useMemo(() => {
        const dx = target.x - gun.x;
        const dy = target.y - gun.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        return {
            distance,
            heightDifference: target.alt - gun.alt,
            bearing,
            weaponId,
            shellType: 'he'
        };
    }, [gun, target, weaponId]);

    useEffect(() => {
        try {
            const sol = calculator.calculateFiringSolution(input);
            setSolution(sol);
        } catch (e) {
            setSolution({ error: (e as Error).message });
        }
    }, [input]);

    return (
        <div className="section">
            <div className="section-title">Данные стрельбы (Интегрировано)</div>
            <div className="coord-group">
                <input type="number" placeholder="Орудие X" onChange={e => setGun({ ...gun, x: parseFloat(e.target.value) || 0 })} />
                <input type="number" placeholder="Орудие Y" onChange={e => setGun({ ...gun, y: parseFloat(e.target.value) || 0 })} />
                <input type="number" placeholder="Орудие Alt" onChange={e => setGun({ ...gun, alt: parseFloat(e.target.value) || 0 })} />
                <input type="number" placeholder="Цель X" onChange={e => setTarget({ ...target, x: parseFloat(e.target.value) || 0 })} />
                <input type="number" placeholder="Цель Y" onChange={e => setTarget({ ...target, y: parseFloat(e.target.value) || 0 })} />
                <input type="number" placeholder="Цель Alt" onChange={e => setTarget({ ...target, alt: parseFloat(e.target.value) || 0 })} />
            </div>
            {solution && !solution.error && (
                <div className="result-panel">
                    <div className="result-row"><span className="result-key">Азимут</span><span className="result-val">{solution.azimuth?.toFixed(1)}°</span></div>
                    <div className="result-row"><span className="result-key">Дальность</span><span className="result-val">{Math.round(input.distance)} м</span></div>
                    <div className="result-row"><span className="result-key">Угол</span><span className="result-val">{solution.elevation}</span></div>
                </div>
            )}
        </div>
    );
};

export default ArtilleryCalculator;
