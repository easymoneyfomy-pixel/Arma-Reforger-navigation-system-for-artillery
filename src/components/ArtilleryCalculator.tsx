import React, { useMemo } from 'react';
import { BallisticCalculator, FiringSolution, CalculatorInput } from '../logic/ballistics';

interface ArtilleryCalculatorProps {
    playerPos: { x: number, y: number, alt: number };
    targetPos: { x: number, y: number, alt: number };
    weaponId: string;
    shellType: string;
    calculator?: BallisticCalculator;
}

const ArtilleryCalculator: React.FC<ArtilleryCalculatorProps> = ({ 
    playerPos, targetPos, weaponId, shellType, 
    calculator: extCalculator 
}) => {
    const solution = useMemo(() => {
        const dx = targetPos.x - playerPos.x;
        const dy = targetPos.y - playerPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

        const input: CalculatorInput = {
            distance,
            heightDifference: targetPos.alt - playerPos.alt,
            bearing,
            weaponId,
            shellType
        };

        try {
            return (extCalculator || new BallisticCalculator()).calculateFiringSolution(input);
        } catch {
            return null;
        }
    }, [playerPos, targetPos, weaponId, shellType, extCalculator]);

    if (!solution || solution.error) return null;

    return (
        <div className="section">
            <div className="section-title">Доп. данные</div>
            <div className="result-panel">
                <div className="result-row"><span className="result-key">Угол УВН</span><span className="result-val">{solution.elevation}</span></div>
                <div className="result-row"><span className="result-key">Время полета</span><span className="result-val">{solution.timeOfFlight}с</span></div>
            </div>
        </div>
    );
};

export default ArtilleryCalculator;
