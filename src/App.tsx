import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BallisticCalculator, BallisticData, FiringSolution, CalculatorInput } from './logic/ballistics';
import { usePersistentState } from './logic/usePersistentState';
import data from './data/official_ballistic_data.json';

// Components
import WeaponSelector from './components/WeaponSelector';
import CoordinateInput from './components/CoordinateInput';
import ResultDisplay from './components/ResultDisplay';
import TacticalMap from './components/TacticalMap';
import ArtilleryCalculator from './components/ArtilleryCalculator';

const calculator = new BallisticCalculator(data as unknown as BallisticData);

const gridToPos = (grid: string) => {
  const cleaned = grid.replace(/[\s/,]/g, '');
  if (cleaned.length === 6) {
    return {
      x: parseInt(cleaned.substring(0, 3), 10) * 100 + 50,
      y: parseInt(cleaned.substring(3, 6), 10) * 100 + 50
    };
  } else if (cleaned.length === 8) {
    return {
      x: parseInt(cleaned.substring(0, 4), 10) * 10 + 5,
      y: parseInt(cleaned.substring(4, 8), 10) * 10 + 5
    };
  }
  return null;
};

const posToGrid = (x: number, y: number, precision: 6 | 8 = 6) => {
  if (precision === 6) {
    const gx = Math.floor(x / 100).toString().padStart(3, '0');
    const gy = Math.floor(y / 100).toString().padStart(3, '0');
    return `${gx}${gy}`;
  } else {
    const gx = Math.floor(x / 10).toString().padStart(4, '0');
    const gy = Math.floor(y / 10).toString().padStart(4, '0');
    return `${gx}${gy}`;
  }
};

const App: React.FC = () => {
  // Persistent State
  const [weaponId, setWeaponId] = usePersistentState('weaponId', data.weaponSystems[0].id);
  const [shellType, setShellType] = usePersistentState('shellType', '');
  
  const [playerGrid, setPlayerGrid] = usePersistentState('playerGrid', '000000');
  const [playerZ, setPlayerZ] = usePersistentState('playerZ', 0);
  const [playerPos, setPlayerPos] = usePersistentState('playerPos', { x: 0, y: 0 });

  const [targetGrid, setTargetGrid] = usePersistentState('targetGrid', '010010');
  const [targetZ, setTargetZ] = usePersistentState('targetZ', 0);
  const [targetPos, setTargetPos] = usePersistentState('targetPos', { x: 1000, y: 1000 });

  // Transient State
  const [solution, setSolution] = useState<FiringSolution | null>(null);
  const [distance, setDistance] = useState(0);

  const currentWeapon = useMemo(() => 
    data.weaponSystems.find(w => w.id === weaponId), 
  [weaponId]);

  // Sync grid to pos (on manual input)
  const handlePlayerGridChange = (grid: string) => {
    setPlayerGrid(grid);
    const pos = gridToPos(grid);
    if (pos) setPlayerPos(pos);
  };

  const handleTargetGridChange = (grid: string) => {
    setTargetGrid(grid);
    const pos = gridToPos(grid);
    if (pos) setTargetPos(pos);
  };

  // Sync pos to grid (on map drag)
  const handlePlayerMove = (pos: { x: number, y: number }) => {
    setPlayerPos(pos);
    setPlayerGrid(posToGrid(pos.x, pos.y, playerGrid.length === 8 ? 8 : 6));
  };

  const handleTargetMove = (pos: { x: number, y: number }) => {
    setTargetPos(pos);
    setTargetGrid(posToGrid(pos.x, pos.y, targetGrid.length === 8 ? 8 : 6));
  };

  // Handle weapon/shell defaults
  useEffect(() => {
    if (currentWeapon) {
      const availableShells = currentWeapon.systemType === 'mortar' 
        ? currentWeapon.shellTypes || []
        : currentWeapon.projectileTypes || [];
      
      if (availableShells.length === 0) return;

      const shellExists = availableShells.some(s => {
        const id = 'type' in s ? s.type : (s as any).id;
        return id === shellType;
      });
      
      if (!shellType || !shellExists) {
        const first = availableShells[0];
        const defaultShell = 'type' in first ? first.type : (first as any).id;
        setShellType(defaultShell);
      }
    }
  }, [weaponId, currentWeapon, shellType, setShellType]);

  // Calculate firing solution
  useEffect(() => {
    if (currentWeapon && playerPos && targetPos) {
      const dx = targetPos.x - playerPos.x;
      const dy = targetPos.y - playerPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      setDistance(Math.round(dist));
      
      const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      
      const input: CalculatorInput = {
        distance: dist,
        heightDifference: targetZ - playerZ,
        bearing: bearing,
        weaponId: weaponId,
        shellType: shellType
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
      setDistance(0);
    }
  }, [playerPos, playerZ, targetPos, targetZ, weaponId, shellType, currentWeapon]);

  // State Synchronization with URL Hash
  useEffect(() => {
    const syncToUrl = () => {
      const state = {
        w: weaponId,
        s: shellType,
        pg: playerGrid,
        pz: playerZ,
        tg: targetGrid,
        tz: targetZ
      };
      const hash = btoa(JSON.stringify(state));
      window.history.replaceState(null, '', `#${hash}`);
    };

    const timer = setTimeout(syncToUrl, 500);
    return () => clearTimeout(timer);
  }, [weaponId, shellType, playerGrid, playerZ, targetGrid, targetZ]);

  // Load from URL Hash on mount
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    if (hash) {
      try {
        const state = JSON.parse(atob(hash));
        if (state.w) setWeaponId(state.w);
        if (state.s) setShellType(state.s);
        if (state.pg) handlePlayerGridChange(state.pg);
        if (state.pz) setPlayerZ(state.pz);
        if (state.tg) handleTargetGridChange(state.tg);
        if (state.tz) setTargetZ(state.tz);
      } catch (e) {
        console.error("Failed to parse URL state", e);
      }
    }
  }, []);

  return (
    <div className="app-container">
      <header className="top-strip">
        <div className="title">ARMA REFORGER | НАВОДЧИК WEB</div>
        <div style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>v2.5.0-map</div>
      </header>

      <TacticalMap 
        playerPos={playerPos}
        targetPos={targetPos}
        onPlayerMove={handlePlayerMove}
        onTargetMove={handleTargetMove}
      />

      <WeaponSelector 
        data={data as BallisticData}
        weaponId={weaponId}
        shellType={shellType}
        onWeaponChange={setWeaponId}
        onShellChange={setShellType}
        currentWeapon={currentWeapon as any}
      />

      <div className="grid-inputs">
        <CoordinateInput 
          title="Позиция орудия"
          grid={playerGrid}
          z={playerZ}
          onGridChange={handlePlayerGridChange}
          onZChange={setPlayerZ}
        />
        <CoordinateInput 
          title="Позиция цели"
          grid={targetGrid}
          z={targetZ}
          onGridChange={handleTargetGridChange}
          onZChange={setTargetZ}
        />
      </div>

      <ArtilleryCalculator 
        playerPos={{ ...playerPos, alt: playerZ }}
        targetPos={{ ...targetPos, alt: targetZ }}
        weaponId={weaponId}
        shellType={shellType}
      />

      <ResultDisplay 
        solution={solution}
        distance={distance}
        isActive={!!(playerGrid && targetGrid)}
      />
    </div>
  );
};

export default App;
