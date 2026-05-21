import React from 'react';
import { BallisticData, WeaponSystem } from '../logic/ballistics';

interface WeaponSelectorProps {
  data: BallisticData;
  weaponId: string;
  shellType: string;
  onWeaponChange: (id: string) => void;
  onShellChange: (type: string) => void;
  currentWeapon: WeaponSystem | undefined;
}

const WeaponSelector: React.FC<WeaponSelectorProps> = ({ 
  data, 
  weaponId, 
  shellType, 
  onWeaponChange, 
  onShellChange,
  currentWeapon 
}) => {
  return (
    <div className="card">
      <div className="section-title">Орудие и боеприпас</div>
      <div className="grid-inputs">
        <div className="input-group">
          <label>Система</label>
          <select value={weaponId} onChange={(e) => onWeaponChange(e.target.value)}>
            {data.weaponSystems.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="input-group">
          <label>Тип снаряда</label>
          <select value={shellType} onChange={(e) => onShellChange(e.target.value)}>
            {currentWeapon?.systemType === 'mortar' 
              ? currentWeapon.shellTypes?.map(s => <option key={s.type} value={s.type}>{s.name}</option>)
              : currentWeapon?.projectileTypes?.map(p => <option key={p.type} value={p.type}>{p.name}</option>)
            }
          </select>
        </div>
      </div>
    </div>
  );
};

export default WeaponSelector;
