import React, { useState, useEffect, useMemo } from 'react';
import { BallisticCalculator, BallisticData, FiringSolution, CalculatorInput } from './logic/ballistics';
import data from './data/ballistic_data.json';

const calculator = new BallisticCalculator(data as BallisticData);

const App: React.FC = () => {
  const [weaponId, setWeaponId] = useState(data.weaponSystems[0].id);
  const [shellType, setShellType] = useState('');
  const [chargeLevel, setChargeLevel] = useState<number | undefined>(undefined);
  
  const [playerGrid, setPlayerGrid] = useState('');
  const [playerZ, setPlayerZ] = useState(0);
  const [targetGrid, setTargetGrid] = useState('');
  const [targetZ, setTargetZ] = useState(0);

  const [solution, setSolution] = useState<FiringSolution | null>(null);

  const currentWeapon = useMemo(() => 
    data.weaponSystems.find(w => w.id === weaponId), 
  [weaponId]);

  useEffect(() => {
    if (currentWeapon) {
      if (currentWeapon.systemType === 'mortar') {
        setShellType(currentWeapon.shellTypes![0].type);
        setChargeLevel(undefined); // Auto-charge
      } else {
        setShellType(currentWeapon.projectileTypes![0].type);
        setChargeLevel(undefined);
      }
    }
  }, [weaponId, currentWeapon]);

  const parseGrid = (grid: string) => {
    const cleaned = grid.replace(/[\s/,]/g, '');
    if (cleaned.length === 6) {
      return {
        x: parseInt(cleaned.substring(0, 3), 10) * 100 + 50,
        y: parseInt(cleaned.substring(3, 6), 10) * 100 + 50
      };
    } else if (cleaned.length === 8) {
      return {
        x: parseInt(cleaned.substring(0, 4), 10) * 10,
        y: parseInt(cleaned.substring(4, 8), 10) * 10
      };
    }
    return null;
  };

  useEffect(() => {
    const pPos = parseGrid(playerGrid);
    const tPos = parseGrid(targetGrid);

    if (pPos && tPos && currentWeapon) {
      const dist = Math.sqrt(Math.pow(tPos.x - pPos.x, 2) + Math.pow(tPos.y - pPos.y, 2));
      const bearing = (Math.atan2(tPos.x - pPos.x, tPos.y - pPos.y) * 180 / Math.PI + 360) % 360;
      
      const input: CalculatorInput = {
        distance: dist,
        heightDifference: targetZ - playerZ,
        bearing: bearing,
        weaponId: weaponId,
        shellType: shellType,
        chargeLevel: chargeLevel
      };

      try {
        const sol = calculator.calculateFiringSolution(input);
        setSolution(sol);
      } catch (e) {
        console.error(e);
        setSolution(null);
      }
    } else {
      setSolution(null);
    }
  }, [playerGrid, playerZ, targetGrid, targetZ, weaponId, shellType, chargeLevel, currentWeapon]);

  return (
    <div className="app-container">
      <header className="top-strip">
        <div className="title">ARMA REFORGER | НАВОДЧИК WEB</div>
        <div style={{color: 'var(--text-faint)', fontSize: '0.8rem'}}>v2.4.0-web</div>
      </header>

      <div className="card">
        <div className="section-title">Орудие и боеприпас</div>
        <div className="grid-inputs">
          <div className="input-group">
            <label>Система</label>
            <select value={weaponId} onChange={(e) => setWeaponId(e.target.value)}>
              {data.weaponSystems.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label>Тип снаряда</label>
            <select value={shellType} onChange={(e) => setShellType(e.target.value)}>
              {currentWeapon?.systemType === 'mortar' 
                ? currentWeapon.shellTypes?.map(s => <option key={s.type} value={s.type}>{s.name}</option>)
                : currentWeapon?.projectileTypes?.map(p => <option key={p.type} value={p.type}>{p.name}</option>)
              }
            </select>
          </div>
        </div>
      </div>

      <div className="grid-inputs">
        <div className="card">
          <div className="section-title">Позиция орудия</div>
          <div className="input-group" style={{marginBottom: '10px'}}>
            <label>Квадрат (058/071)</label>
            <input value={playerGrid} onChange={(e) => setPlayerGrid(e.target.value)} placeholder="058/071" />
          </div>
          <div className="input-group">
            <label>Высота (м)</label>
            <input type="number" value={playerZ} onChange={(e) => setPlayerZ(Number(e.target.value))} />
          </div>
        </div>

        <div className="card">
          <div className="section-title">Позиция цели</div>
          <div className="input-group" style={{marginBottom: '10px'}}>
            <label>Квадрат (062/075)</label>
            <input value={targetGrid} onChange={(e) => setTargetGrid(e.target.value)} placeholder="062/075" />
          </div>
          <div className="input-group">
            <label>Высота (м)</label>
            <input type="number" value={targetZ} onChange={(e) => setTargetZ(Number(e.target.value))} />
          </div>
        </div>
      </div>

      {solution && solution.inRange ? (
        <div className="card" style={{borderLeft: '4px solid var(--accent-green)'}}>
          <div className="section-title">Решение для стрельбы</div>
          <div className="results-grid">
            <div className="result-item">
              <div className="result-label">Дистанция</div>
              <div className="result-value">{Math.round(solution.minRange === solution.maxRange ? solution.minRange : (solution.elevationCorrection ? 0 : 0))} {Math.round(Math.sqrt(Math.pow(parseGrid(targetGrid)!.x - parseGrid(playerGrid)!.x, 2) + Math.pow(parseGrid(targetGrid)!.y - parseGrid(playerGrid)!.y, 2)))}м</div>
            </div>
            <div className="result-item">
              <div className="result-label">Азимут</div>
              <div className="result-value">{solution.azimuthMils} <span style={{fontSize: '1rem', color: 'var(--text-faint)'}}>({solution.azimuth}°)</span></div>
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
                <div className="result-value" style={{color: 'var(--accent)'}}>{solution.charge}</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{borderLeft: '4px solid var(--accent-hot)', opacity: targetGrid && playerGrid ? 1 : 0.5}}>
          <div className="section-title">Состояние</div>
          <div style={{color: 'var(--accent-hot)', fontWeight: 'bold'}}>
            {playerGrid && targetGrid ? (solution?.error || "Вне зоны досягаемости") : "Ожидание координат..."}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
