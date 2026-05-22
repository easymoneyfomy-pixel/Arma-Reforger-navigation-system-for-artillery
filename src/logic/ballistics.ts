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
  trajectoryMode?: string;  // 'high' | 'low' | 'auto'
  chargeLevel?: number;
}

export interface FiringSolution {
  inRange: boolean;
  charge?: number;
  elevation?: number;
  elevationMils?: number;
  elevationPrecise?: number;
  elevationCorrection?: number;
  elevationDegrees?: number;
  azimuth?: number;
  azimuthMils?: number;
  timeOfFlight?: number;
  tofCorrection?: number;
  minRange: number;
  maxRange: number;
  spread?: number; // Circular Error Probable (meters)
  chargeHint?: string; // e.g. "Low angle recommended"
  trajectoryMode?: string;
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

// ── Module-level math/sanitisation helpers ─────────────────────────────────

const HEIGHT_CORRECTION_FACTOR = 0.6;

function asFiniteFloat(value: any): number | null {
  const number = parseFloat(value);
  if (isNaN(number) || !isFinite(number)) return null;
  return number;
}

function coerceFiniteFloat(value: any, defaultValue: number = 0.0): number {
  const number = asFiniteFloat(value);
  return number === null ? defaultValue : number;
}

function sanitizeRangeBounds(minVal: any, maxVal: any, tableMin: number, tableMax: number): [number, number] {
  let lower = coerceFiniteFloat(minVal, tableMin);
  let upper = coerceFiniteFloat(maxVal, tableMax);

  lower = Math.min(Math.max(lower, tableMin), tableMax);
  upper = Math.min(Math.max(upper, tableMin), tableMax);

  if (upper < lower) return [tableMin, tableMax];
  return [lower, upper];
}

function sanitizeBallisticTable(ballisticTable: any[]): BallisticEntry[] {
  if (!Array.isArray(ballisticTable)) return [];

  const sanitized: BallisticEntry[] = [];
  for (const entry of ballisticTable) {
    if (typeof entry !== 'object' || entry === null) continue;

    const rangeValue = asFiniteFloat(entry.range);
    const elevation = asFiniteFloat(entry.elevation);
    const tof = asFiniteFloat(entry.tof);

    if (rangeValue === null || elevation === null || rangeValue < 0.0) continue;

    sanitized.push({
      range: rangeValue,
      elevation,
      tof: tof ?? 0.0,
      dElev: coerceFiniteFloat(entry.dElev, 0.0),
      tofPer100m: coerceFiniteFloat(entry.tofPer100m, 0.0),
    });
  }
  return sanitized.sort((a, b) => a.range - b.range);
}

// ── Calculator class ───────────────────────────────────────────────────────

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

  // ── Solver Logic ────────────────────────────────────────────────────────

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
        selectedCharge = this.selectMortarCharge(charges, input.distance, input.trajectoryMode);
      }

      if (!selectedCharge) {
        return {
          inRange: false,
          minRange: Math.min(...charges.map(c => c.minRange)),
          maxRange: Math.max(...charges.map(c => c.maxRange)),
          error: "Out of range",
        };
      }

      return this.calculateForCharge(selectedCharge, input, weapon);
    }
  }

  /**
   * Pick the best mortar charge for a given distance and trajectory preference.
   *
   * Mirrors `Calculator._select_mortar_charge` in calculator.py (line 390).
   */
  private selectMortarCharge(charges: Charge[], distance: number, trajectoryMode?: string): Charge | undefined {
    const priority = (trajectoryMode || 'auto').toLowerCase();

    const inRange = charges.filter(c => distance >= c.minRange && distance <= c.maxRange);
    if (!inRange.length) return undefined;

    if (priority === 'high' || priority === 'high_arc' || priority === 'high-arc' || priority === 'навесом' || priority === 'навес') {
      // Highest elevation → most lob
      return inRange.reduce((best, c) => {
        const bestElev = this.interpolateFromTable(best.rangeTable, distance)!.elevation;
        const cElev    = this.interpolateFromTable(c.rangeTable,    distance)!.elevation;
        return cElev > bestElev ? c : best;
      });
    }

    if (priority === 'low' || priority === 'low_arc' || priority === 'low-arc' || priority === 'плоско' || priority === 'плоская') {
      // Lowest elevation → flatter
      return inRange.reduce((best, c) => {
        const bestElev = this.interpolateFromTable(best.rangeTable, distance)!.elevation;
        const cElev    = this.interpolateFromTable(c.rangeTable,    distance)!.elevation;
        return cElev < bestElev ? c : best;
      });
    }

    // Auto: highest charge whose maxRange still covers the target
    return inRange.reduce((best, c) =>
      c.maxRange >= distance && c.maxRange < (best.maxRange ?? Infinity) ? c : best
    );
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

    const spread = (input.distance / 1000) * (weapon.systemType === 'mortar' ? 12 : 5);
    let chargeHint = "";
    if (input.distance > charge.maxRange * 0.9) chargeHint = "Near max range (consider higher charge)";
    if (input.distance < charge.minRange * 1.1) chargeHint = "Near min range (consider lower charge)";

    return {
      inRange: true,
      charge: charge.level,
      elevation: Math.round(correctedElevation),
      elevationMils: Math.round(correctedElevation),
      elevationPrecise: parseFloat(correctedElevation.toFixed(1)),
      elevationCorrection: parseFloat(elevationCorrection.toFixed(1)),
      elevationDegrees: parseFloat((correctedElevation / milsPerDegree).toFixed(2)),
      azimuth: input.bearing,
      azimuthMils: Math.round(input.bearing * milsPerDegree),
      timeOfFlight: parseFloat(correctedTOF.toFixed(1)),
      tofCorrection: parseFloat(tofCorrection.toFixed(2)),
      minRange: charge.minRange,
      maxRange: charge.maxRange,
      spread: parseFloat(spread.toFixed(1)),
      chargeHint: chargeHint,
    };
  }

  private calculateForProjectile(projectile: ProjectileType, input: CalculatorInput, weapon: WeaponSystem): FiringSolution {
    const ballistics = this.interpolateFromTable(projectile.ballisticTable, input.distance);
    if (!ballistics) {
      return { inRange: false, minRange: projectile.minRange, maxRange: projectile.maxRange, error: "Table error" };
    }

    const elevationCorrection = (input.heightDifference / 100) * ballistics.dElev;
    const correctedElevation = ballistics.elevation - elevationCorrection;

    const milsPerDegree = weapon.milSystem.milsPerDegree;

    return {
      inRange: true,
      elevation: Math.round(correctedElevation),
      elevationMils: Math.round(correctedElevation),
      elevationPrecise: parseFloat(correctedElevation.toFixed(1)),
      elevationDegrees: parseFloat((correctedElevation / milsPerDegree).toFixed(2)),
      azimuth: input.bearing,
      azimuthMils: Math.round(input.bearing * milsPerDegree),
      timeOfFlight: parseFloat(ballistics.tof.toFixed(1)),
      minRange: projectile.minRange,
      maxRange: projectile.maxRange,
    };
  }

  // ── Fire-correction utilities ─────────────────────────────────────────────

  /**
   * Computes a new range-bias correction from a known point–impact error.
   *
   * Mirrors `Calculator.calibrate_range_bias` in calculator.py (line 1018).
   */
  calibrateRangeBias(
    playerX: number, playerY: number,
    targetX: number, targetY: number,
    impactX: number, impactY: number,
    gridScaleM: number = 100,
    currentBiasM: number = 0,
  ): { targetDistance: number; impactAlong: number; signedErrorM: number; crossTrackM: number; newBiasM: number } {
    const tx = (targetX - playerX) * gridScaleM;
    const ty = (targetY - playerY) * gridScaleM;
    const ix = (impactX - playerX) * gridScaleM;
    const iy = (impactY - playerY) * gridScaleM;

    const targetDistance = Math.hypot(tx, ty);
    if (!isFinite(targetDistance) || targetDistance <= 0) {
      throw new Error("Target must be further than the firing point.");
    }

    const ux = tx / targetDistance;
    const uy = ty / targetDistance;
    const impactAlong  = ix * ux + iy * uy;
    const impactCross  = ix * uy - iy * ux;
    const signedError  = impactAlong - targetDistance;
    const newBias      = currentBiasM - signedError;

    return {
      targetDistance: Math.round(targetDistance * 10) / 10,
      impactAlong: Math.round(impactAlong * 10) / 10,
      signedErrorM: Math.round(signedError * 10) / 10,
      crossTrackM: Math.round(impactCross * 10) / 10,
      newBiasM: Math.round(newBias * 10) / 10,
    };
  }

  /**
   * Applies a lateral / drop correction to a target grid coordinate.
   *
   * Mirrors `Calculator.apply_fire_correction` in calculator.py (line 1070).
   */
  applyFireCorrection(
    playerX: number, playerY: number,
    targetX: number, targetY: number,
    leftRightM: number = 0,
    addDropM: number = 0,
    gridScaleM: number = 100,
  ): { correctedX: number; correctedY: number; targetDistance: number; leftRightM: number; addDropM: number } {
    const tx = (targetX - playerX) * gridScaleM;
    const ty = (targetY - playerY) * gridScaleM;
    const targetDistance = Math.hypot(tx, ty);
    if (!isFinite(targetDistance) || targetDistance <= 0) {
      throw new Error("Target must be further than the firing point.");
    }

    const ux         = tx / targetDistance;
    const uy         = ty / targetDistance;
    const rightX     = uy;
    const rightY     = -ux;

    const correctedX = targetX + ((ux * addDropM) + (rightX * leftRightM)) / gridScaleM;
    const correctedY = targetY + ((uy * addDropM) + (rightY * leftRightM)) / gridScaleM;

    return {
      correctedX: Math.round(correctedX * 1000) / 1000,
      correctedY: Math.round(correctedY * 1000) / 1000,
      targetDistance: Math.round(targetDistance * 10) / 10,
      leftRightM: Math.round(leftRightM * 10) / 10,
      addDropM: Math.round(addDropM * 10) / 10,
    };
  }

  /**
   * Full spot-correction workflow: calibrate from an impact point, derive
   * corrected target coords, re-solve, and return human-readable Russian
   * artillery adjustment commands.
   *
   * Mirrors `Calculator.suggest_adjustment_from_impact` in calculator.py (line 1123).
   */
  suggestAdjustmentFromImpact(
    playerX: number, playerY: number, playerZ: number,
    targetX: number, targetY: number, targetZ: number,
    impactX: number, impactY: number,
    weaponId: string,
    shellType: string,
    gridScaleM: number = 100,
    rangeBiasM: number = 0,
    trajectoryMode: string = 'Навесом',
  ): any {
    const currentResult = this.calculateFiringSolution({
      distance: Math.hypot((targetX - playerX) * gridScaleM, (targetY - playerY) * gridScaleM),
      heightDifference: targetZ - playerZ,
      bearing: 0,
      weaponId,
      shellType,
    });

    const calibration = this.calibrateRangeBias(
      playerX, playerY, targetX, targetY, impactX, impactY,
      gridScaleM, rangeBiasM,
    );

    const correctedTarget = this.applyFireCorrection(
      playerX, playerY, targetX, targetY,
      -calibration.crossTrackM,
      -calibration.signedErrorM,
      gridScaleM,
    );

    const correctedResult = this.calculateFiringSolution({
      distance: Math.hypot(
        (correctedTarget.correctedX - playerX) * gridScaleM,
        (correctedTarget.correctedY - playerY) * gridScaleM,
      ),
      heightDifference: targetZ - playerZ,
      bearing: 0,
      weaponId,
      shellType,
    });

    const elevDeltaDeg  = parseFloat((correctedResult.elevationDegrees! - currentResult.elevationDegrees!).toFixed(1));
    const elevDeltaMils = (correctedResult.elevationMils || 0) - (currentResult.elevationMils || 0);

    const milsPerDeg = this.data!.weaponSystems.find(w => w.id === weaponId)!.milSystem.milsPerDegree;
    const azimuthDeltaMils = Math.round((correctedResult.azimuth! - currentResult.azimuth!) * milsPerDeg);

    const distErr  = calibration.signedErrorM;
    const crossErr = calibration.crossTrackM;

    const rangeCommand = Math.abs(distErr) < 0.05
      ? 'по дальности почти норма'
      : distErr < 0
        ? `добавь дальность на ${Math.abs(distErr).toFixed(0)} м`
        : `убери дальность на ${Math.abs(distErr).toFixed(0)} м`;

    const lateralCommand = Math.abs(crossErr) < 0.05
      ? 'по направлению почти норма'
      : crossErr > 0
        ? `уведи левее на ${Math.abs(crossErr).toFixed(0)} м`
        : `уведи правее на ${Math.abs(crossErr).toFixed(0)} м`;

    const elevationCommand = Math.abs(elevDeltaDeg) < 0.05
      ? 'возвышение почти не менять'
      : elevDeltaDeg > 0
        ? `подними на ${Math.abs(elevDeltaDeg).toFixed(1)}° / ${Math.abs(elevDeltaMils)} мил`
        : `опусти на ${Math.abs(elevDeltaDeg).toFixed(1)}° / ${Math.abs(elevDeltaMils)} мил`;

    const azimuthCommand = Math.abs(azimuthDeltaMils) < 1
      ? 'азимут почти не менять'
      : azimuthDeltaMils > 0
        ? `доверни вправо на ${Math.abs(azimuthDeltaMils)} мил`
        : `доверни влево на ${Math.abs(azimuthDeltaMils)} мил`;

    return {
      currentResult,
      correctedResult,
      calibration,
      correctedTarget,
      distanceErrorM: Math.round(distErr * 10) / 10,
      crossErrorM: Math.round(crossErr * 10) / 10,
      rangeCommand,
      lateralCommand,
      elevationDeltaDeg: elevDeltaDeg,
      elevationDeltaMils: elevDeltaMils,
      elevationCommand,
      azimuthDeltaMils,
      azimuthCommand,
      suggestedRangeBiasM: Math.round(calibration.newBiasM * 10) / 10,
    };
  }
}
