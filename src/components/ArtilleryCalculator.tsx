import React, { useState, useEffect } from 'react';
import { BallisticCalculator, CalculatorInput } from '../logic/ballistics';
import ballisticData from '../data/ballistic_data.json';

const calculator = new BallisticCalculator(ballisticData as any);

const ArtilleryCalculator: React.FC = () => {
    const [input, setInput] = useState<CalculatorInput>({
        distance: 1000,
        heightDifference: 0,
        bearing: 0,
        weaponId: 'mortar',
        shellType: 'he'
    });
    const [solution, setSolution] = useState<any>(null);

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
            <div className="section-title">Артудар</div>
            {/* Implementation details based on the HTML provided */}
            <div className="coord-group">
                <input 
                    type="number" 
                    value={input.distance} 
                    onChange={e => setInput({ ...input, distance: parseFloat(e.target.value) })}
                    placeholder="Дистанция (м)"
                />
                <input 
                    type="number" 
                    value={input.heightDifference} 
                    onChange={e => setInput({ ...input, heightDifference: parseFloat(e.target.value) })}
                    placeholder="Перепад высот (м)"
                />
            </div>
            {solution && !solution.error && (
                <div className="result-panel">
                    <div className="result-row">
                        <span className="result-key">Азимут (мил)</span>
                        <span className="result-val">{solution.azimuthMils}</span>
                    </div>
                    <div className="result-row">
                        <span className="result-key">Угол</span>
                        <span className="result-val">{solution.elevation}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ArtilleryCalculator;
