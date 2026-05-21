/**
 * Arma Reforger Ballistic Calculator - Core Engine
 * Ported from official_BallisticCalculator.js and ballistics_math.py
 */

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

export interface GridCoordinate {
  grid: string;
  z: number;
}

export interface CalculatorInput {
  distance: number;
  heightDifference: number;
  bearing: number;
  weaponId: string;
  shellType: string;
  chargeLevel?: number;
}

export interface FiringSolution {
  inRange: boolean;
  charge?: number;
  elevation?: number;
  elevationPrecise?: number;
  elevationCorrection?: number;
  elevationDegrees?: number;
  azimuth?: number;
  azimuthMils?: number;
  timeOfFlight?: number;
  tofCorrection?: number;
  minRange: number;
  maxRange: number;
  error?: string;
}

export interface BallisticData {
  version: string;
  weaponSystems: WeaponSystem[];
}

export interface WeaponSystem {
  id: string;
  name: string;
  caliber: number;
  systemType: 'mortar' | 'mlrs' | 'howitzer';
  milSystem: {
    name: string;
    milsPerCircle: number;
    milsPerDegree: number;
  };
  shellTypes?: ShellType[];
  projectileTypes?: ProjectileType[];
}

export interface ShellType {
  type: string;
  name: string;
  charges: Charge[];
}

export interface ProjectileType {
  id: string;
  name: string;
  type: string;
  minRange: number;
  maxRange: number;
  ballisticTable: BallisticEntry[];
}

export interface Charge {
  level: number;
  minRange: number;
  maxRange: number;
  rangeTable: BallisticEntry[];
}

export interface BallisticEntry {
  range: number;
  elevation: number;
  tof: number;
  dElev: number;
  tofPer100m?: number;
}

const HEIGHT_CORRECTION_FACTOR = 0.6;

/**
 * Core Ballistic Calculator Class
 */
export class BallisticCalculator {
  private data: BallisticData | null = null;

  constructor(data?: BallisticData) {
    if (data) this.data = data;
  }

  setData(data: BallisticData) {
    this.data = data;
  }

  isLoaded(): boolean {
    return this.data !== null;
  }

  // --- Geometry Utilities ---

  calculateDistance(pos1: Position3D, pos2: Position3D): number {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const dz = pos2.z - pos1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  calculateHorizontalDistance(pos1: Position3D, pos2: Position3D): number {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  calculateBearing(pos1: Position3D, pos2: Position3D): number {
    const dy = pos2.x - pos1.x;
    const dx = pos2.y - pos1.y;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    return parseFloat(angle.toFixed(1));
  }

  // --- Solver Logic ---

  private lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
    if (x1 === x0) return y0;
    return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
  }

  private interpolateFromTable(rangeTable: BallisticEntry[], distance: number): BallisticEntry | null {
    let lower: BallisticEntry | null = null;
    let upper: BallisticEntry | null = null;

    for (const entry of rangeTable) {
      if (entry.range === distance) return { ...entry };
      if (entry.range < distance) {
        lower = entry;
      } else {
        upper = entry;
        break;
      }
    }

    if (!lower || !upper) return null;

    return {
      range: distance,
      elevation: this.lerp(distance, lower.range, upper.range, lower.elevation, upper.elevation),
      tof: this.lerp(distance, lower.range, upper.range, lower.tof, upper.tof),
      dElev: this.lerp(distance, lower.range, upper.range, lower.dElev, upper.dElev),
      tofPer100m: this.lerp(distance, lower.range, upper.range, lower.tofPer100m || 0, upper.tofPer100m || 0),
    };
  }

  calculateFiringSolution(input: CalculatorInput): FiringSolution {
    if (!this.data) throw new Error("Data not loaded");

    const weapon = this.data.weaponSystems.find(w => w.id === input.weaponId);
    if (!weapon) throw new Error(`Unknown weapon: ${input.weaponId}`);

    if (weapon.systemType === 'mlrs') {
      const projectile = weapon.projectileTypes?.find(p => p.type === input.shellType || p.id === input.shellType);
      if (!projectile) throw new Error(`Unknown projectile: ${input.shellType}`);
      return this.calculateForProjectile(projectile, input, weapon);
    } else {
      const shell = weapon.shellTypes?.find(s => s.type === input.shellType);
      if (!shell) throw new Error(`Unknown shell: ${input.shellType}`);
      
      const charges = shell.charges;
      let selectedCharge = charges.find(c => c.level === input.chargeLevel);
      
      if (input.chargeLevel === undefined) {
        selectedCharge = charges.find(c => input.distance >= c.minRange && input.distance <= c.maxRange);
      }

      if (!selectedCharge) {
        return {
          inRange: false,
          minRange: Math.min(...charges.map(c => c.minRange)),
          maxRange: Math.max(...charges.map(c => c.maxRange)),
          error: "Out of range"
        };
      }

      return this.calculateForCharge(selectedCharge, input, weapon);
    }
  }

  private calculateForCharge(charge: Charge, input: CalculatorInput, weapon: WeaponSystem): FiringSolution {
    const ballistics = this.interpolateFromTable(charge.rangeTable, input.distance);
    if (!ballistics) {
      return { inRange: false, minRange: charge.minRange, maxRange: charge.maxRange, error: "Table error" };
    }

    const elevationCorrection = (input.heightDifference / 100) * ballistics.dElev * (input.heightDifference < -100 ? HEIGHT_CORRECTION_FACTOR : 1);
    const correctedElevation = ballistics.elevation - elevationCorrection;
    
    const tofCorrection = (input.heightDifference / 100) * (ballistics.tofPer100m || 0);
    const correctedTOF = ballistics.tof + tofCorrection;

    const milsPerDegree = weapon.milSystem.milsPerDegree;

    return {
      inRange: true,
      charge: charge.level,
      elevation: Math.round(correctedElevation),
      elevationPrecise: parseFloat(correctedElevation.toFixed(1)),
      elevationCorrection: parseFloat(elevationCorrection.toFixed(1)),
      elevationDegrees: parseFloat((correctedElevation / milsPerDegree).toFixed(2)),
      azimuth: input.bearing,
      azimuthMils: Math.round(input.bearing * milsPerDegree),
      timeOfFlight: parseFloat(correctedTOF.toFixed(1)),
      tofCorrection: parseFloat(tofCorrection.toFixed(2)),
      minRange: charge.minRange,
      maxRange: charge.maxRange
    };
  }

  private calculateForProjectile(projectile: ProjectileType, input: CalculatorInput, weapon: WeaponSystem): FiringSolution {
    const ballistics = this.interpolateFromTable(projectile.ballisticTable, input.distance);
    if (!ballistics) {
      return { inRange: false, minRange: projectile.minRange, maxRange: projectile.maxRange, error: "Table error" };
    }

    // Similar height correction for MLRS (standard approach)
    const elevationCorrection = (input.heightDifference / 100) * ballistics.dElev;
    const correctedElevation = ballistics.elevation - elevationCorrection;
    
    const milsPerDegree = weapon.milSystem.milsPerDegree;

    return {
      inRange: true,
      elevation: Math.round(correctedElevation),
      elevationPrecise: parseFloat(correctedElevation.toFixed(1)),
      elevationDegrees: parseFloat((correctedElevation / milsPerDegree).toFixed(2)),
      azimuth: input.bearing,
      azimuthMils: Math.round(input.bearing * milsPerDegree),
      timeOfFlight: parseFloat(ballistics.tof.toFixed(1)),
      minRange: projectile.minRange,
      maxRange: projectile.maxRange
    };
  }
}
