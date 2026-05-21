import React from 'react';
import { FiringSolution } from '../logic/ballistics';

interface ResultDisplayProps {
  solution: FiringSolution | null;
  distance: number;
  isActive: boolean;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ solution, distance, isActive }) => {
  const copyToClipboard = () => {
    if (!solution) return;
    const text = `--- ARMA REFORGER SOLUTION ---\nDistance: ${distance}m\nAzimuth: ${solution.azimuthMils} (${solution.azimuth}°)\nElevation: ${solution.elevation}\nTOF: ${solution.timeOfFlight}s\nCharge: ${solution.charge ?? 'N/A'}\n------------------------------`;
    navigator.clipboard.writeText(text);
    alert('Solution copied to clipboard!');
  };

  if (solution && solution.inRange) {
    return (
      <div className="card" style={{ borderLeft: '4px solid var(--accent-green)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <div className="section-title" style={{ margin: 0 }}>Решение для стрельбы</div>
          <button 
            onClick={copyToClipboard}
            style={{ 
              background: 'var(--accent)', 
              color: 'var(--bg-main)', 
              border: 'none', 
              padding: '5px 10px', 
              borderRadius: '3px', 
              fontSize: '0.7rem',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            КОПИРОВАТЬ
          </button>
        </div>
        <div className="results-grid">
          <div className="result-item">
            <div className="result-label">Дистанция</div>
            <div className="result-value">{distance}м</div>
          </div>
          <div className="result-item">
            <div className="result-label">Азимут</div>
            <div className="result-value">
              {solution.azimuthMils} 
              <span style={{ fontSize: '1rem', color: 'var(--text-faint)', marginLeft: '5px' }}>
                ({solution.azimuth}°)
              </span>
            </div>
          </div>
          <div className="result-item">
            <div className="result-label">Прицел</div>
            <div className="result-value elevation">{solution.elevation}</div>
          </div>
          <div className="result-item">
            <div className="result-label">Время (TOF)</div>
            <div className="result-value">{solution.timeOfFlight}с</div>
          </div>
          {solution.charge !== undefined && (
            <div className="result-item">
              <div className="result-label">Заряд</div>
              <div className="result-value" style={{ color: 'var(--accent)' }}>
                {solution.charge}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div 
      className="card" 
      style={{ 
        borderLeft: '4px solid var(--accent-hot)', 
        opacity: isActive ? 1 : 0.5 
      }}
    >
      <div className="section-title">Состояние</div>
      <div style={{ color: 'var(--accent-hot)', fontWeight: 'bold' }}>
        {isActive ? (solution?.error || "Вне зоны досягаемости") : "Ожидание координат..."}
      </div>
    </div>
  );
};

export default ResultDisplay;
