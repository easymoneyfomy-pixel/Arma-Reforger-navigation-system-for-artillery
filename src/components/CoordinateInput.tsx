import React from 'react';

interface CoordinateInputProps {
  title: string;
  grid: string;
  z: number;
  onGridChange: (grid: string) => void;
  onZChange: (z: number) => void;
  placeholder?: string;
}

const CoordinateInput: React.FC<CoordinateInputProps> = ({
  title,
  grid,
  z,
  onGridChange,
  onZChange,
  placeholder
}) => {
  return (
    <div className="card">
      <div className="section-title">{title}</div>
      <div className="input-group" style={{ marginBottom: '10px' }}>
        <label>Квадрат (058/071)</label>
        <input 
          value={grid} 
          onChange={(e) => onGridChange(e.target.value)} 
          placeholder={placeholder || "058/071"} 
        />
      </div>
      <div className="input-group">
        <label>Высота (м)</label>
        <input 
          type="number" 
          value={z} 
          onChange={(e) => onZChange(Number(e.target.value))} 
        />
      </div>
    </div>
  );
};

export default CoordinateInput;
