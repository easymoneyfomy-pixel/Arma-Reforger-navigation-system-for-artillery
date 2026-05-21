import copy
import json
import math
from pathlib import Path

from ballistics_constants import (
    DEFAULT_CONFIG_PATH,
    DEFAULT_PRESETS,
    HEIGHT_CORRECTION_FACTOR,
    OFFICIAL_WEAPON_LABELS,
)
from ballistics_data import load_official_overrides
from ballistics_math import (
    _as_finite_float,
    _azimuth_mils_from_degrees,
    _choose_default_ammo_id,
    _coerce_finite_float,
    _coerce_positive_finite_float,
    _js_round,
    _require_finite_float,
    _round_mils,
    _sanitize_ballistic_table,
    _sanitize_legacy_table_points,
    _sanitize_range_bounds,
    _signed_angle_delta_deg,
    _within_range,
    interpolate_ballistic_table,
    interpolate_point_table,
    interpolate_point_table_with_slope,
)
from ballistics_parsing import parse_grid_pair, parse_meter_pair


class Calculator:
    def __init__(self, config_path=None):
        self.config_path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
        self.default_presets = copy.deepcopy(DEFAULT_PRESETS)
        self.official_overrides = load_official_overrides()
        self._apply_official_overrides(self.default_presets)
        self.presets = copy.deepcopy(self.default_presets)
        self._loaded_mtime = None
        self.last_load_error = None
        self.load_tables(force=True)

    def _merge_presets(self, loaded):
        merged = copy.deepcopy(self.default_presets)

        for weapon_name, weapon_data in loaded.items():
            if not isinstance(weapon_data, dict):
                continue

            base = merged.get(weapon_name)
            if base is None:
                base = {
                    "data_source": "legacy",
                    "max_elevation": _coerce_positive_finite_float(weapon_data.get("max_elevation", 89.0), 89.0),
                    "v0_approx": _coerce_positive_finite_float(weapon_data.get("v0_approx", 300.0), 300.0),
                    "mil_scale": _coerce_positive_finite_float(weapon_data.get("mil_scale", 6400.0), 6400.0),
                    "range_bias_m": _coerce_finite_float(weapon_data.get("range_bias_m", 0.0), 0.0),
                    "table": {},
                }

            weapon = copy.deepcopy(base)
            if base.get("__official__"):
                if "range_bias_m" in weapon_data:
                    weapon["range_bias_m"] = _coerce_finite_float(
                        weapon_data.get("range_bias_m", 0.0),
                        base.get("range_bias_m", 0.0),
                    )
                merged[weapon_name] = weapon
                continue

            for key, value in weapon_data.items():
                if key == "table":
                    if isinstance(value, dict):
                        weapon["table"] = copy.deepcopy(value)
                else:
                    weapon[key] = value

            if not isinstance(weapon.get("table"), dict):
                weapon["table"] = {}

            weapon["max_elevation"] = _coerce_positive_finite_float(
                weapon.get("max_elevation", base.get("max_elevation", 89.0)),
                base.get("max_elevation", 89.0),
            )
            weapon["v0_approx"] = _coerce_positive_finite_float(
                weapon.get("v0_approx", base.get("v0_approx", 300.0)),
                base.get("v0_approx", 300.0),
            )
            weapon["mil_scale"] = _coerce_positive_finite_float(
                weapon.get("mil_scale", base.get("mil_scale", 6400.0)),
                base.get("mil_scale", 6400.0),
            )
            weapon["range_bias_m"] = _coerce_finite_float(
                weapon.get("range_bias_m", base.get("range_bias_m", 0.0)),
                base.get("range_bias_m", 0.0),
            )
            if "data_source" not in weapon:
                weapon["data_source"] = base.get("data_source", "legacy")

            merged[weapon_name] = weapon

        return merged

    def _apply_official_overrides(self, presets):
        if not self.official_overrides:
            return

        for weapon_name, override in self.official_overrides.items():
            base = presets.get(weapon_name)
            if base is None:
                presets[weapon_name] = copy.deepcopy(override)
                continue

            merged = copy.deepcopy(override)
            merged["range_bias_m"] = _coerce_finite_float(
                base.get("range_bias_m", override.get("range_bias_m", 0.0)),
                override.get("range_bias_m", 0.0),
            )
            presets[weapon_name] = merged

    def load_tables(self, force=False):
        self.last_load_error = None

        if not self.config_path.exists():
            if not force and self._loaded_mtime == "missing":
                return True
            self.presets = copy.deepcopy(self.default_presets)
            self._loaded_mtime = "missing"
            return True

        try:
            current_mtime = self.config_path.stat().st_mtime
        except OSError as exc:
            self.last_load_error = f"Не удалось прочитать {self.config_path.name}: {exc}"
            return False

        if not force and self._loaded_mtime == current_mtime:
            return True

        try:
            with self.config_path.open("r", encoding="utf-8") as handle:
                loaded = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            self.last_load_error = f"Не удалось загрузить {self.config_path.name}: {exc}"
            return False

        if not isinstance(loaded, dict):
            self.last_load_error = f"{self.config_path.name} должен содержать словарь орудий."
            return False

        self.presets = self._merge_presets(loaded)
        self._apply_official_overrides(self.presets)
        self._loaded_mtime = current_mtime
        return True

    def save_tables(self, data=None):
        payload = data if data is not None else self.presets
        sanitized = {}
        for weapon_name, weapon_data in payload.items():
            if not isinstance(weapon_data, dict):
                continue
            if weapon_data.get("__official__"):
                sanitized[weapon_name] = {
                    "range_bias_m": _coerce_finite_float(weapon_data.get("range_bias_m", 0.0), 0.0),
                }
            else:
                sanitized[weapon_name] = copy.deepcopy(weapon_data)

        with self.config_path.open("w", encoding="utf-8") as handle:
            json.dump(sanitized, handle, indent=4, ensure_ascii=False, allow_nan=False)
        self._loaded_mtime = self.config_path.stat().st_mtime
        self.last_load_error = None
        return self.config_path

    def get_weapons(self):
        return list(self.presets.keys())

    def get_weapon_data(self, weapon_type):
        weapon_data = self.presets.get(weapon_type)
        if weapon_data is None:
            available = ", ".join(self.get_weapons()) or "нет доступных орудий"
            raise ValueError(f"Неизвестное орудие: {weapon_type}. Доступно: {available}")
        return weapon_data

    def get_ammo_options(self, weapon_type):
        weapon_data = self.get_weapon_data(weapon_type)
        options = weapon_data.get("ammo_options")
        if not isinstance(options, list):
            return []
        return copy.deepcopy(options)

    def get_default_ammo_id(self, weapon_type):
        weapon_data = self.get_weapon_data(weapon_type)
        default_ammo_id = weapon_data.get("default_ammo_id")
        if default_ammo_id:
            return default_ammo_id
        return _choose_default_ammo_id(weapon_data.get("system_type", "mortar"), weapon_data.get("ammo_options", []))

    def get_weapon_source_info(self, weapon_type):
        weapon_data = self.get_weapon_data(weapon_type)
        return copy.deepcopy(self._get_data_source_info(weapon_data))

    def _get_data_source_info(self, weapon_data):
        source_id = str(
            weapon_data.get(
                "data_source",
                "official" if weapon_data.get("__official__") else "legacy",
            )
        ).strip().lower()

        if source_id == "official":
            return {
                "id": "official",
                "label": "Официальная таблица",
                "warning": "",
            }

        return {
            "id": "legacy",
            "label": "Legacy fallback",
            "warning": "Работает по резервной таблице. Точность ниже официальной.",
        }

    def _ensure_finite_solution(self, *values):
        return all(math.isfinite(float(value)) for value in values)

    def _build_accuracy_metadata(self, weapon_data, effective_distance, range_min=None, range_max=None):
        source_info = self._get_data_source_info(weapon_data)
        warnings = []

        if source_info["warning"]:
            warnings.append(source_info["warning"])

        if range_min is not None and range_max is not None:
            try:
                range_min = float(range_min)
                range_max = float(range_max)
                effective_distance = float(effective_distance)
            except (TypeError, ValueError):
                range_min = range_max = effective_distance = None

            if range_min is not None and range_max is not None and range_max > range_min:
                span = max(1.0, range_max - range_min)
                edge_margin = max(100.0, min(400.0, span * 0.05))
                if (effective_distance - range_min) <= edge_margin or (range_max - effective_distance) <= edge_margin:
                    warnings.append("Цель у края диапазона боеприпаса.")

        return {
            "data_source": source_info["id"],
            "data_source_label": source_info["label"],
            "warnings": warnings,
        }

    def _finalize_result(
        self,
        result,
        weapon_data,
        effective_distance,
        range_min=None,
        range_max=None,
        recommended_ammo=None,
    ):
        result.update(
            self._build_accuracy_metadata(
                weapon_data,
                effective_distance,
                range_min=range_min,
                range_max=range_max,
            )
        )

        if recommended_ammo is not None:
            result["recommended_ammo_id"] = recommended_ammo.get("id")
            result["recommended_ammo_name"] = recommended_ammo.get("name")
            result["recommended_ammo_label"] = recommended_ammo.get("label")
            result["recommended_ammo_reason"] = recommended_ammo.get("reason")
            if result.get("ammo_id") and recommended_ammo.get("id") != result.get("ammo_id"):
                result["ammo_advice"] = recommended_ammo.get("label")
                if str(weapon_data.get("official_id", "")).upper() == "BM21":
                    warnings = result.setdefault("warnings", [])
                    warning_text = "Текущий боеприпас BM-21 для этой дальности не лучший."
                    if warning_text not in warnings:
                        warnings.append(warning_text)

        return result

    def _normalize_trajectory_mode(self, trajectory_mode):
        mode = str(trajectory_mode or "").strip().lower()
        if mode in {
            "навесом",
            "навес",
            "высокая",
            "высокая дуга",
            "high",
            "high_arc",
            "high-arc",
            "steep",
            "steep_arc",
        }:
            return "high"
        if mode in {
            "плоско",
            "плоская",
            "плоская дуга",
            "low",
            "low_arc",
            "low-arc",
            "flat",
        }:
            return "low"
        return "auto"

    def _evaluate_artillery_option(self, weapon_data, option, distance_m):
        system_type = str(weapon_data.get("system_type", "mortar")).lower()
        if system_type not in ("mlrs", "howitzer"):
            return None

        ballistic_table = option.get("ballistic_table")
        if not isinstance(ballistic_table, list) or not ballistic_table:
            return None

        interpolated = self._interpolate_ballistic_table(ballistic_table, distance_m)
        if interpolated is None:
            return None

        return {
            "option": option,
            "elevation_raw": float(interpolated["elevation"]),
            "tof_s": float(interpolated.get("tof", 0.0)),
            "tof_available": bool(interpolated.get("tof_available", True)),
            "ballistics": interpolated,
        }

    def _select_artillery_option(self, weapon_data, ammo_options, distance_m, trajectory_mode="Навесом"):
        candidates = []
        for option in ammo_options or []:
            evaluated = self._evaluate_artillery_option(weapon_data, option, distance_m)
            if evaluated is not None:
                candidates.append(evaluated)

        if not candidates:
            return None

        priority = self._normalize_trajectory_mode(trajectory_mode)
        if priority == "high":
            return max(
                candidates,
                key=lambda item: (
                    item["elevation_raw"],
                    item["tof_s"],
                    -_coerce_finite_float(item["option"].get("min_range", 0.0), 0.0),
                ),
            )
        if priority == "low":
            return min(
                candidates,
                key=lambda item: (
                    item["elevation_raw"],
                    item["tof_s"],
                    _coerce_finite_float(item["option"].get("min_range", 0.0), 0.0),
                ),
            )

        return min(
            candidates,
            key=lambda item: (
                _coerce_finite_float(item["option"].get("max_range", 0.0), 0.0),
                _coerce_finite_float(item["option"].get("max_range", 0.0), 0.0) - float(distance_m),
            ),
        )

    def _evaluate_mortar_charge(self, charge, distance_m):
        if charge is None:
            return None

        ballistics = self._interpolate_ballistic_table(charge.get("range_table", []), distance_m)
        if ballistics is None:
            return None

        return {
            "charge": charge,
            "charge_level": int(_coerce_finite_float(charge.get("level", 0), 0.0)),
            "elevation_raw": float(ballistics["elevation"]),
            "tof_s": float(ballistics.get("tof", 0.0)),
            "ballistics": ballistics,
        }

    def _select_mortar_charge(self, charges, distance_m, trajectory_mode="Навесом"):
        candidates = []
        for charge in charges or []:
            if not _within_range(
                distance_m,
                _coerce_finite_float(charge.get("min_range", 0.0), 0.0),
                _coerce_finite_float(charge.get("max_range", 0.0), 0.0),
            ):
                continue

            evaluated = self._evaluate_mortar_charge(charge, distance_m)
            if evaluated is not None:
                candidates.append(evaluated)

        if not candidates:
            return None

        priority = self._normalize_trajectory_mode(trajectory_mode)
        if priority == "high":
            return max(
                candidates,
                key=lambda item: (
                    item["elevation_raw"],
                    item["charge_level"],
                ),
            )
        if priority == "low":
            return min(
                candidates,
                key=lambda item: (
                    item["elevation_raw"],
                    item["charge_level"],
                ),
            )

        return min(
            candidates,
            key=lambda item: (
                _coerce_finite_float(item["charge"].get("max_range", 0.0), 0.0),
                _coerce_finite_float(item["charge"].get("max_range", 0.0), 0.0) - float(distance_m),
                item["charge_level"],
            ),
        )

    def get_recommended_ammo(self, weapon_type, distance_m, trajectory_mode="Навесом"):
        weapon_data = self.get_weapon_data(weapon_type)
        ammo_options = weapon_data.get("ammo_options")
        if not ammo_options:
            return None

        distance_m = _as_finite_float(distance_m)
        if distance_m is None or distance_m < 0.0:
            return None

        in_range = [
            option
            for option in ammo_options
            if _within_range(
                distance_m,
                _coerce_finite_float(option.get("min_range", 0.0), 0.0),
                _coerce_finite_float(option.get("max_range", 0.0), 0.0),
            )
        ]

        if in_range:
            system_type = str(weapon_data.get("system_type", "mortar")).lower()
            priority = self._normalize_trajectory_mode(trajectory_mode)
            if system_type in ("mlrs", "howitzer"):
                selected = self._select_artillery_option(weapon_data, in_range, distance_m, trajectory_mode=trajectory_mode)
                if selected is not None:
                    recommended = selected["option"]
                    if priority == "high":
                        reason = "самый навесной вариант для этой дальности"
                    elif priority == "low":
                        reason = "самый плоский вариант для этой дальности"
                    else:
                        reason = "самый короткий боеприпас, который достаёт до цели"
                else:
                    recommended = in_range[0]
                    reason = "цель попадает в диапазон"
            else:
                recommended = min(
                    in_range,
                    key=lambda option: (
                        _coerce_finite_float(option.get("max_range", 0.0), 0.0),
                        _coerce_finite_float(option.get("max_range", 0.0), 0.0) - distance_m,
                    ),
                )
                reason = "самый короткий боеприпас, который достаёт до цели"
        else:
            lower = max(
                (
                    option
                    for option in ammo_options
                    if distance_m < _coerce_finite_float(option.get("min_range", 0.0), 0.0)
                ),
                default=None,
                key=lambda option: _coerce_finite_float(option.get("min_range", 0.0), 0.0),
            )
            upper = min(
                (
                    option
                    for option in ammo_options
                    if distance_m > _coerce_finite_float(option.get("max_range", 0.0), 0.0)
                ),
                default=None,
                key=lambda option: _coerce_finite_float(option.get("max_range", 0.0), 0.0),
            )

            if lower is not None and upper is not None:
                lower_gap = _coerce_finite_float(lower.get("min_range", 0.0), 0.0) - distance_m
                upper_gap = distance_m - _coerce_finite_float(upper.get("max_range", 0.0), 0.0)
                recommended = lower if lower_gap <= upper_gap else upper
            else:
                recommended = lower or upper or ammo_options[0]

            reason = "цель вне диапазона выбранного боеприпаса"

        return {
            "id": recommended.get("id"),
            "name": recommended.get("name", recommended.get("id")),
            "label": recommended.get("label", recommended.get("name", recommended.get("id"))),
            "reason": reason,
            "min_range": _coerce_finite_float(recommended.get("min_range", 0.0), 0.0),
            "max_range": _coerce_finite_float(recommended.get("max_range", 0.0), 0.0),
        }

    def _build_zero_result(
        self,
        weapon_data,
        weapon_type,
        azimuth,
        dz,
        mil_scale,
        grid_scale_m,
        range_bias_m,
    ):
        return self._finalize_result(
            {
                "distance": 0,
                "distance_m": 0.0,
                "azimuth": round(azimuth, 1),
                "azimuth_deg": round(azimuth, 1),
                "azimuth_mils": _azimuth_mils_from_degrees(round(azimuth, 1), mil_scale),
                "elevation_deg": 0.0,
                "elevation_mils": 0,
                "tof_s": 0.0,
                "tof_available": True,
                "range_min": 0,
                "range_max": 0,
                "mil_scale": int(round(mil_scale)),
                "effective_distance": 0.0,
                "effective_distance_m": 0.0,
                "grid_scale_m": grid_scale_m,
                "range_bias_m": range_bias_m,
                "height_diff_m": round(dz, 1),
                "height_correction_deg": 0.0,
                "projectile_name": weapon_data.get("projectile_name"),
                "weapon_name": weapon_type,
            },
            weapon_data,
            0.0,
            range_min=0.0,
            range_max=0.0,
        )

    def _calculate_resolved(
        self,
        flat_distance,
        azimuth,
        dz,
        weapon_type,
        weapon_data,
        mil_scale,
        grid_scale_m,
        range_bias_m,
        ammo_type=None,
        trajectory_mode="Навесом",
    ):
        if not self._ensure_finite_solution(flat_distance, azimuth, dz, mil_scale, grid_scale_m, range_bias_m):
            raise ValueError("Расчёт содержит некорректные числа. Проверь координаты, высоты и поправки.")

        if flat_distance <= 0.0:
            return self._build_zero_result(
                weapon_data,
                weapon_type,
                azimuth,
                dz,
                mil_scale,
                grid_scale_m,
                range_bias_m,
            )

        base_distance = flat_distance + range_bias_m
        if not math.isfinite(base_distance) or base_distance <= 0.0:
            raise ValueError(
                "Итоговая дистанция вышла за допустимые пределы.\n"
                "Попробуйте уточнить координаты, высоты или поправку дальности."
            )

        ammo_options = weapon_data.get("ammo_options")
        if isinstance(ammo_options, list) and ammo_options:
            ammo_lookup = {}
            for option in ammo_options:
                for key in (
                    option.get("id"),
                    option.get("name"),
                    option.get("label"),
                ):
                    if key is not None:
                        ammo_lookup[str(key)] = option

            selected_ammo_id = ammo_type
            auto_selected = selected_ammo_id in (None, "", "Авто")
            recommended_ammo = self.get_recommended_ammo(weapon_type, base_distance, trajectory_mode=trajectory_mode)
            if auto_selected and recommended_ammo is not None:
                selected_ammo_id = recommended_ammo.get("id")
            elif auto_selected:
                selected_ammo_id = weapon_data.get("default_ammo_id") or _choose_default_ammo_id(
                    weapon_data.get("system_type", "mortar"),
                    ammo_options,
                )

            selected_ammo = ammo_lookup.get(str(selected_ammo_id))
            if selected_ammo is None:
                available = ", ".join(
                    option.get("label", option.get("name", str(option.get("id"))))
                    for option in ammo_options[:8]
                )
                raise ValueError(
                    f"Неизвестный боеприпас: {selected_ammo_id}.\n"
                    f"Доступно: {available}"
                )

            system_type = str(weapon_data.get("system_type", "mortar")).lower()
            ammo_label = selected_ammo.get("label", selected_ammo.get("name", str(selected_ammo.get("id"))))
            ammo_name = selected_ammo.get("name", ammo_label)
            ammo_min = _coerce_finite_float(selected_ammo.get("min_range", 0.0), 0.0)
            ammo_max = _coerce_finite_float(selected_ammo.get("max_range", 0.0), 0.0)

            if not _within_range(base_distance, ammo_min, ammo_max):
                raise ValueError(
                    f"Дистанция {int(round(base_distance))} м вне диапазона боеприпаса.\n"
                    f"{ammo_label}: от {int(round(ammo_min))} м до {int(round(ammo_max))} м."
                )

            if system_type in ("mlrs", "howitzer"):
                selected_candidate = self._evaluate_artillery_option(weapon_data, selected_ammo, base_distance)
                if selected_candidate is None:
                    raise ValueError(
                        f"Дистанция {int(round(base_distance))} м вне диапазона боеприпаса.\n"
                        f"{ammo_label}: от {int(round(ammo_min))} м до {int(round(ammo_max))} м."
                    )

                elevation_raw = float(selected_candidate["elevation_raw"])
                corrected_tof = float(selected_candidate["tof_s"])
                tof_available = bool(selected_candidate.get("tof_available", True))
                elevation_mils = elevation_raw
                elevation_deg = elevation_mils * 360.0 / mil_scale
                if not self._ensure_finite_solution(elevation_mils, elevation_deg, corrected_tof):
                    raise ValueError("Баллистическая таблица содержит некорректные значения.")
                if tof_available and corrected_tof < 0.0:
                    raise ValueError("Время полёта не может быть отрицательным.")
                height_correction_deg = 0.0
                charge_label = ""
                charge_level = None
                solution_min = ammo_min
                solution_max = ammo_max
            else:
                charges = selected_ammo.get("charges") or []
                selected_charge = self._select_mortar_charge(
                    charges,
                    base_distance,
                    trajectory_mode=trajectory_mode,
                )
                if selected_charge is None:
                    raise ValueError(
                        f"Дистанция {int(round(base_distance))} м вне диапазона боеприпаса.\n"
                        f"{ammo_label}: от {int(round(ammo_min))} м до {int(round(ammo_max))} м."
                    )

                charge = selected_charge["charge"]
                ballistics = selected_charge["ballistics"]
                elevation_raw = float(ballistics["elevation"])
                tof_s = float(ballistics.get("tof", 0.0))
                d_elev = float(ballistics.get("dElev", 0.0) or 0.0)
                tof_per_100m = float(ballistics.get("tofPer100m", 0.0) or 0.0)
                correction = (dz / 100.0) * d_elev
                if dz < -100:
                    correction *= HEIGHT_CORRECTION_FACTOR
                elevation_mils = elevation_raw - correction
                corrected_tof = tof_s + ((dz / 100.0) * tof_per_100m)
                tof_available = True
                elevation_deg = elevation_mils * 360.0 / mil_scale
                if not self._ensure_finite_solution(elevation_raw, elevation_mils, elevation_deg, corrected_tof):
                    raise ValueError("Поправка по высоте дала некорректное решение. Проверь входные данные.")
                if tof_available and corrected_tof < 0.0:
                    raise ValueError("Поправка по высоте даёт отрицательное время полёта. Проверь высоты цели и орудия.")
                charge_min_elev = _coerce_finite_float(charge.get("min_elevation", elevation_raw), elevation_raw)
                charge_max_elev = _coerce_finite_float(charge.get("max_elevation", elevation_raw), elevation_raw)
                if elevation_mils < (charge_min_elev - 0.5) or elevation_mils > (charge_max_elev + 0.5):
                    raise ValueError(
                        "Поправка по высоте выводит решение за пределы проверенной таблицы заряда.\n"
                        "Проверь высоты цели и орудия."
                    )
                height_correction_deg = (elevation_mils - elevation_raw) * 360.0 / mil_scale
                charge_level = int(_coerce_finite_float(charge.get("level", 0), 0.0))
                charge_label = f"Заряд {charge_level}"
                solution_min = _coerce_finite_float(charge.get("min_range", ammo_min), ammo_min)
                solution_max = _coerce_finite_float(charge.get("max_range", ammo_max), ammo_max)

            max_elev = _coerce_positive_finite_float(weapon_data.get("max_elevation", 0.0), 0.0)
            if max_elev and elevation_deg > max_elev:
                raise ValueError(
                    f"Требуется наклон {elevation_deg:.1f}°.\n"
                    f"Орудие ({weapon_type}) не может подняться выше {max_elev:.0f}."
                )

            tof_value = round(corrected_tof, 1)
            result = {
                "distance": int(round(flat_distance)),
                "distance_m": round(flat_distance, 1),
                "azimuth": round(azimuth, 1),
                "azimuth_deg": round(azimuth, 1),
                "azimuth_mils": _azimuth_mils_from_degrees(round(azimuth, 1), mil_scale),
                "elev_low": round(elevation_deg, 1),
                "elevation_deg": round(elevation_deg, 1),
                "elev_low_mils": _round_mils(elevation_mils),
                "elevation_mils": _round_mils(elevation_mils),
                "tof_low": tof_value,
                "tof_s": tof_value,
                "tof_available": tof_available,
                "range_min": int(round(solution_min)),
                "range_max": int(round(solution_max)),
                "ammo_range_min": int(round(ammo_min)),
                "ammo_range_max": int(round(ammo_max)),
                "effective_distance": round(base_distance, 1),
                "effective_distance_m": round(base_distance, 1),
                "mil_scale": int(round(mil_scale)),
                "grid_scale_m": grid_scale_m,
                "range_bias_m": round(range_bias_m, 1),
                "height_diff_m": round(dz, 1),
                "height_correction_deg": round(height_correction_deg, 2),
                "projectile_name": ammo_name,
                "ammo_id": selected_ammo.get("id"),
                "ammo_name": ammo_name,
                "ammo_label": ammo_label,
                "weapon_name": weapon_type,
                "auto_selected": auto_selected,
                "trajectory_mode": trajectory_mode,
            }
            if charge_label:
                result["charge"] = charge_level
                result["charge_label"] = charge_label
            return self._finalize_result(
                result,
                weapon_data,
                base_distance,
                range_min=solution_min,
                range_max=solution_max,
                recommended_ammo=recommended_ammo,
            )

        ballistic_table = _sanitize_ballistic_table(weapon_data.get("ballistic_table"))
        if ballistic_table:
            interpolated = self._interpolate_ballistic_table(ballistic_table, base_distance)
            if interpolated is None:
                table_min = float(ballistic_table[0]["range"])
                table_max = float(ballistic_table[-1]["range"])
                min_range, max_range = _sanitize_range_bounds(
                    weapon_data.get("min_range", table_min),
                    weapon_data.get("max_range", table_max),
                    table_min,
                    table_max,
                )
                raise ValueError(
                    f"Дистанция {int(round(base_distance))} м вне диапазона орудия.\n"
                    f"{weapon_type}: от {int(min_range)} м до {int(max_range)} м."
                )

            table_min = float(ballistic_table[0]["range"])
            table_max = float(ballistic_table[-1]["range"])
            min_range, max_range = _sanitize_range_bounds(
                weapon_data.get("min_range", table_min),
                weapon_data.get("max_range", table_max),
                table_min,
                table_max,
            )
            elevation_raw = float(interpolated["elevation"])
            tof_s = float(interpolated["tof"])
            tof_available = bool(interpolated.get("tof_available", True))
            elevation_units = str(weapon_data.get("elevation_units", "mils")).lower()
            if elevation_units == "mils":
                elevation_mils = elevation_raw
                elevation_deg = elevation_mils * 360.0 / mil_scale
            else:
                elevation_deg = elevation_raw
                elevation_mils = elevation_deg * (mil_scale / 360.0)
            if not self._ensure_finite_solution(elevation_raw, elevation_mils, elevation_deg, tof_s):
                raise ValueError("Баллистическая таблица содержит некорректные значения.")
            if tof_available and tof_s < 0.0:
                raise ValueError("Время полёта не может быть отрицательным.")
            if elevation_deg < 0.0:
                raise ValueError("Возвышение не может быть отрицательным.")

            max_elev = _coerce_positive_finite_float(weapon_data.get("max_elevation", 0.0), 0.0)
            if max_elev and elevation_deg > max_elev:
                raise ValueError(
                    f"Требуется наклон {elevation_deg:.1f}°.\n"
                    f"Орудие ({weapon_type}) не может подняться выше {max_elev:.0f}."
                )

            return self._finalize_result(
                {
                    "distance": int(round(flat_distance)),
                    "distance_m": round(flat_distance, 1),
                    "azimuth": round(azimuth, 1),
                    "azimuth_deg": round(azimuth, 1),
                    "azimuth_mils": _azimuth_mils_from_degrees(round(azimuth, 1), mil_scale),
                    "elev_low": round(elevation_deg, 1),
                    "elevation_deg": round(elevation_deg, 1),
                    "elev_low_mils": _round_mils(elevation_mils),
                    "elevation_mils": _round_mils(elevation_mils),
                    "tof_low": round(tof_s, 1),
                    "tof_s": round(tof_s, 1),
                    "tof_available": tof_available,
                    "range_min": int(round(min_range)),
                    "range_max": int(round(max_range)),
                    "effective_distance": round(base_distance, 1),
                    "effective_distance_m": round(base_distance, 1),
                    "mil_scale": int(round(mil_scale)),
                    "grid_scale_m": grid_scale_m,
                    "range_bias_m": round(range_bias_m, 1),
                    "height_diff_m": round(dz, 1),
                    "height_correction_deg": 0.0,
                    "projectile_name": weapon_data.get("projectile_name"),
                    "weapon_name": weapon_type,
                },
                weapon_data,
                base_distance,
                range_min=min_range,
                range_max=max_range,
            )

        table = weapon_data.get("table", {})
        if not table:
            raise ValueError(f"Нет таблицы дальности для {weapon_type}.")

        points = _sanitize_legacy_table_points(table)
        if not points:
            raise ValueError(f"Таблица дальности для {weapon_type} повреждена или пуста.")
        min_range = points[0][0]
        max_range = points[-1][0]

        if not _within_range(base_distance, min_range, max_range):
            raise ValueError(
                f"Дистанция {int(round(base_distance))} м вне диапазона орудия.\n"
                f"{weapon_type}: от {int(min_range)} м до {int(max_range)} м."
            )

        elevation_low, slope_deg_per_m = self._interpolate_with_slope(points, base_distance)
        height_correction = dz * slope_deg_per_m
        if dz < -100:
            height_correction *= HEIGHT_CORRECTION_FACTOR
        elevation_low += height_correction

        if not self._ensure_finite_solution(elevation_low, height_correction):
            raise ValueError("Поправка по высоте дала некорректное решение. Проверь входные данные.")

        max_elev = _coerce_positive_finite_float(weapon_data.get("max_elevation", 89.0), 89.0)
        if elevation_low > max_elev:
            raise ValueError(
                f"Требуется наклон {elevation_low:.1f}°.\n"
                f"Орудие ({weapon_type}) не может подняться выше {max_elev}°."
            )

        if elevation_low < 0.0:
            raise ValueError("Поправка по высоте делает решение ниже 0°. Проверь высоты цели и орудия.")

        v0 = _coerce_positive_finite_float(weapon_data.get("v0_approx", 300.0), 300.0)
        cos_el = math.cos(math.radians(elevation_low))
        if cos_el <= 1e-6:
            raise ValueError("Решение слишком близко к вертикали. Проверь дистанцию или таблицу.")
        tof_low = base_distance / (v0 * cos_el)
        elevation_mils = elevation_low * (mil_scale / 360.0)
        if not self._ensure_finite_solution(tof_low, elevation_mils):
            raise ValueError("Расчёт времени полёта или возвышения дал некорректный результат.")
        if tof_low < 0.0:
            raise ValueError("Время полёта не может быть отрицательным.")

        return self._finalize_result(
            {
                "distance": int(round(flat_distance)),
                "distance_m": round(flat_distance, 1),
                "azimuth": round(azimuth, 1),
                "azimuth_deg": round(azimuth, 1),
                "azimuth_mils": _azimuth_mils_from_degrees(round(azimuth, 1), mil_scale),
                "elev_low": round(elevation_low, 1),
                "elevation_deg": round(elevation_low, 1),
                "elev_low_mils": _round_mils(elevation_mils),
                "elevation_mils": _round_mils(elevation_mils),
                "tof_low": round(tof_low, 1),
                "tof_s": round(tof_low, 1),
                "tof_available": True,
                "range_min": int(min_range),
                "range_max": int(max_range),
                "effective_distance": round(base_distance, 1),
                "effective_distance_m": round(base_distance, 1),
                "mil_scale": int(round(mil_scale)),
                "grid_scale_m": grid_scale_m,
                "range_bias_m": round(range_bias_m, 1),
                "height_diff_m": round(dz, 1),
                "height_correction_deg": round(height_correction, 2),
                "projectile_name": weapon_data.get("projectile_name"),
                "weapon_name": weapon_type,
            },
            weapon_data,
            base_distance,
            range_min=min_range,
            range_max=max_range,
        )

    def calculate(
        self,
        x1,
        y1,
        z1,
        x2,
        y2,
        z2,
        weapon_type="Миномет (Mortar)",
        ammo_type=None,
        grid_scale_m=100.0,
        range_bias_m=0.0,
        trajectory_mode="Навесом",
    ):
        self.load_tables()

        x1 = _require_finite_float(x1, "Введите корректные координаты сетки.")
        y1 = _require_finite_float(y1, "Введите корректные координаты сетки.")
        x2 = _require_finite_float(x2, "Введите корректные координаты сетки.")
        y2 = _require_finite_float(y2, "Введите корректные координаты сетки.")

        grid_scale_m = _require_finite_float(grid_scale_m, "Масштаб сетки должен быть конечным числом.")
        if grid_scale_m <= 0.0:
            raise ValueError("Масштаб сетки должен быть больше нуля.")

        z1 = _require_finite_float(z1, "Высота должна быть конечным числом.", default=0.0)
        z2 = _require_finite_float(z2, "Высота должна быть конечным числом.", default=0.0)
        range_bias_m = _require_finite_float(
            range_bias_m,
            "Коррекция дальности должна быть конечным числом.",
            default=0.0,
        )

        weapon_data = self.get_weapon_data(weapon_type)
        mil_scale = _coerce_positive_finite_float(weapon_data.get("mil_scale", 6400.0), 6400.0)

        dx = (x2 - x1) * grid_scale_m
        dy = (y2 - y1) * grid_scale_m
        dz = z2 - z1

        flat_distance = math.hypot(dx, dy)
        if not math.isfinite(flat_distance):
            raise ValueError("Дистанция получилась слишком большой для точного расчёта.")
        azimuth = 0.0
        if flat_distance > 0.0:
            azimuth = (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0

        return self._calculate_resolved(
            flat_distance=flat_distance,
            azimuth=azimuth,
            dz=dz,
            weapon_type=weapon_type,
            weapon_data=weapon_data,
            mil_scale=mil_scale,
            grid_scale_m=grid_scale_m,
            range_bias_m=range_bias_m,
            ammo_type=ammo_type,
            trajectory_mode=trajectory_mode,
        )

    def calculate_from_distance(
        self,
        distance_m,
        azimuth_deg,
        height_diff_m=0.0,
        weapon_type="Миномет (Mortar)",
        ammo_type=None,
        grid_scale_m=1.0,
        range_bias_m=0.0,
        trajectory_mode="Навесом",
    ):
        self.load_tables()

        flat_distance = _require_finite_float(distance_m, "Дистанция должна быть конечным числом.")

        if flat_distance < 0.0:
            raise ValueError("Дистанция не может быть отрицательной.")

        azimuth = _require_finite_float(azimuth_deg, "Азимут должен быть конечным числом.") % 360.0
        dz = _require_finite_float(height_diff_m, "Разница высот должна быть конечным числом.", default=0.0)
        grid_scale_m = _require_finite_float(grid_scale_m, "Масштаб сетки должен быть конечным числом.")
        if grid_scale_m <= 0.0:
            raise ValueError("Масштаб сетки должен быть больше нуля.")

        range_bias_m = _require_finite_float(
            range_bias_m,
            "Коррекция дальности должна быть конечным числом.",
            default=0.0,
        )

        weapon_data = self.get_weapon_data(weapon_type)
        mil_scale = _coerce_positive_finite_float(weapon_data.get("mil_scale", 6400.0), 6400.0)

        return self._calculate_resolved(
            flat_distance=flat_distance,
            azimuth=azimuth,
            dz=dz,
            weapon_type=weapon_type,
            weapon_data=weapon_data,
            mil_scale=mil_scale,
            grid_scale_m=grid_scale_m,
            range_bias_m=range_bias_m,
            ammo_type=ammo_type,
            trajectory_mode=trajectory_mode,
        )

    def calibrate_range_bias(
        self,
        player_x,
        player_y,
        target_x,
        target_y,
        impact_x,
        impact_y,
        grid_scale_m=100.0,
        current_bias_m=0.0,
    ):
        player_x = _require_finite_float(player_x, "Координаты для пристрелки должны быть конечными числами.")
        player_y = _require_finite_float(player_y, "Координаты для пристрелки должны быть конечными числами.")
        target_x = _require_finite_float(target_x, "Координаты для пристрелки должны быть конечными числами.")
        target_y = _require_finite_float(target_y, "Координаты для пристрелки должны быть конечными числами.")
        impact_x = _require_finite_float(impact_x, "Координаты для пристрелки должны быть конечными числами.")
        impact_y = _require_finite_float(impact_y, "Координаты для пристрелки должны быть конечными числами.")

        grid_scale_m = _require_finite_float(grid_scale_m, "Параметры пристрелки должны быть конечными числами.")
        current_bias_m = _require_finite_float(
            current_bias_m,
            "Параметры пристрелки должны быть конечными числами.",
            default=0.0,
        )

        if grid_scale_m <= 0.0:
            raise ValueError("Масштаб сетки должен быть больше нуля.")

        tx = (target_x - player_x) * grid_scale_m
        ty = (target_y - player_y) * grid_scale_m
        ix = (impact_x - player_x) * grid_scale_m
        iy = (impact_y - player_y) * grid_scale_m

        target_distance = math.hypot(tx, ty)
        if not math.isfinite(target_distance) or target_distance <= 0.0:
            raise ValueError("Цель должна быть дальше точки стрельбы.")

        ux = tx / target_distance
        uy = ty / target_distance
        impact_along = ix * ux + iy * uy
        impact_cross = ix * uy - iy * ux
        signed_error = impact_along - target_distance
        new_bias = current_bias_m - signed_error

        return {
            "target_distance": round(target_distance, 1),
            "impact_along": round(impact_along, 1),
            "signed_error_m": round(signed_error, 1),
            "cross_track_m": round(impact_cross, 1),
            "new_bias_m": round(new_bias, 1),
        }

    def apply_fire_correction(
        self,
        player_x,
        player_y,
        target_x,
        target_y,
        left_right_m=0.0,
        add_drop_m=0.0,
        grid_scale_m=100.0,
    ):
        player_x = _require_finite_float(player_x, "Параметры коррекции должны быть конечными числами.")
        player_y = _require_finite_float(player_y, "Параметры коррекции должны быть конечными числами.")
        target_x = _require_finite_float(target_x, "Параметры коррекции должны быть конечными числами.")
        target_y = _require_finite_float(target_y, "Параметры коррекции должны быть конечными числами.")
        left_right_m = _require_finite_float(
            left_right_m,
            "Параметры коррекции должны быть конечными числами.",
            default=0.0,
        )
        add_drop_m = _require_finite_float(
            add_drop_m,
            "Параметры коррекции должны быть конечными числами.",
            default=0.0,
        )
        grid_scale_m = _require_finite_float(grid_scale_m, "Параметры коррекции должны быть конечными числами.")

        if grid_scale_m <= 0.0:
            raise ValueError("Масштаб сетки должен быть больше нуля.")

        tx = (target_x - player_x) * grid_scale_m
        ty = (target_y - player_y) * grid_scale_m
        target_distance = math.hypot(tx, ty)
        if not math.isfinite(target_distance) or target_distance <= 0.0:
            raise ValueError("Цель должна быть дальше точки стрельбы.")

        ux = tx / target_distance
        uy = ty / target_distance
        right_x = uy
        right_y = -ux

        corrected_x = target_x + ((ux * add_drop_m) + (right_x * left_right_m)) / grid_scale_m
        corrected_y = target_y + ((uy * add_drop_m) + (right_y * left_right_m)) / grid_scale_m
        if not self._ensure_finite_solution(corrected_x, corrected_y):
            raise ValueError("Коррекция дала некорректные координаты. Проверь входные данные.")

        return {
            "corrected_x": round(corrected_x, 3),
            "corrected_y": round(corrected_y, 3),
            "target_distance": round(target_distance, 1),
            "left_right_m": round(left_right_m, 1),
            "add_drop_m": round(add_drop_m, 1),
        }

    def suggest_adjustment_from_impact(
        self,
        player_x,
        player_y,
        player_z,
        target_x,
        target_y,
        target_z,
        impact_x,
        impact_y,
        weapon_type="Миномет (Mortar)",
        ammo_type=None,
        grid_scale_m=100.0,
        range_bias_m=0.0,
        trajectory_mode="Навесом",
    ):
        current_result = self.calculate(
            player_x,
            player_y,
            player_z,
            target_x,
            target_y,
            target_z,
            weapon_type=weapon_type,
            ammo_type=ammo_type,
            grid_scale_m=grid_scale_m,
            range_bias_m=range_bias_m,
            trajectory_mode=trajectory_mode,
        )

        calibration = self.calibrate_range_bias(
            player_x,
            player_y,
            target_x,
            target_y,
            impact_x,
            impact_y,
            grid_scale_m=grid_scale_m,
            current_bias_m=range_bias_m,
        )

        corrected_target = self.apply_fire_correction(
            player_x,
            player_y,
            target_x,
            target_y,
            left_right_m=-float(calibration["cross_track_m"]),
            add_drop_m=-float(calibration["signed_error_m"]),
            grid_scale_m=grid_scale_m,
        )

        corrected_result = self.calculate(
            player_x,
            player_y,
            player_z,
            corrected_target["corrected_x"],
            corrected_target["corrected_y"],
            target_z,
            weapon_type=weapon_type,
            ammo_type=ammo_type,
            grid_scale_m=grid_scale_m,
            range_bias_m=range_bias_m,
            trajectory_mode=trajectory_mode,
        )

        azimuth_delta_deg = _signed_angle_delta_deg(
            corrected_result["azimuth_deg"],
            current_result["azimuth_deg"],
        )
        azimuth_delta_mils = _js_round(azimuth_delta_deg * (float(current_result["mil_scale"]) / 360.0))
        elevation_delta_deg = round(float(corrected_result["elevation_deg"]) - float(current_result["elevation_deg"]), 1)
        elevation_delta_mils = int(corrected_result["elevation_mils"]) - int(current_result["elevation_mils"])

        distance_error = float(calibration["signed_error_m"])
        cross_error = float(calibration["cross_track_m"])
        if abs(distance_error) < 0.05:
            range_command = "по дальности почти норма"
        elif distance_error < 0:
            range_command = f"добавь дальность на {abs(distance_error):.0f} м"
        else:
            range_command = f"убери дальность на {abs(distance_error):.0f} м"

        if abs(cross_error) < 0.05:
            lateral_command = "по направлению почти норма"
        elif cross_error > 0:
            lateral_command = f"уведи левее на {abs(cross_error):.0f} м"
        else:
            lateral_command = f"уведи правее на {abs(cross_error):.0f} м"

        if abs(elevation_delta_deg) < 0.05:
            elevation_command = "возвышение почти не менять"
        elif elevation_delta_deg > 0:
            elevation_command = f"подними на {abs(elevation_delta_deg):.1f}° / {abs(elevation_delta_mils)} мил"
        else:
            elevation_command = f"опусти на {abs(elevation_delta_deg):.1f}° / {abs(elevation_delta_mils)} мил"

        if abs(azimuth_delta_deg) < 0.05:
            azimuth_command = "азимут почти не менять"
        elif azimuth_delta_deg > 0:
            azimuth_command = f"доверни вправо на {abs(azimuth_delta_deg):.1f}° / {abs(azimuth_delta_mils)} мил"
        else:
            azimuth_command = f"доверни влево на {abs(azimuth_delta_deg):.1f}° / {abs(azimuth_delta_mils)} мил"

        return {
            "current_result": current_result,
            "corrected_result": corrected_result,
            "calibration": calibration,
            "corrected_target": corrected_target,
            "distance_error_m": round(distance_error, 1),
            "cross_error_m": round(cross_error, 1),
            "range_command": range_command,
            "lateral_command": lateral_command,
            "elevation_delta_deg": elevation_delta_deg,
            "elevation_delta_mils": elevation_delta_mils,
            "elevation_command": elevation_command,
            "azimuth_delta_deg": round(azimuth_delta_deg, 1),
            "azimuth_delta_mils": azimuth_delta_mils,
            "azimuth_command": azimuth_command,
            "suggested_range_bias_m": round(float(calibration["new_bias_m"]), 1),
        }

    def _interpolate(self, points, distance):
        return interpolate_point_table(points, distance)

    def _interpolate_with_slope(self, points, distance):
        return interpolate_point_table_with_slope(points, distance)

    def _interpolate_ballistic_table(self, ballistic_table, distance):
        return interpolate_ballistic_table(ballistic_table, distance)
