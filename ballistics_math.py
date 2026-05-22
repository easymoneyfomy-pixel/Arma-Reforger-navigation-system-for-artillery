from __future__ import annotations

import math

from ballistics_constants import RANGE_EPSILON


def _lerp(start, end, fraction):
    return start + ((end - start) * fraction)


def _format_range_label(min_range, max_range):
    min_range = float(min_range)
    max_range = float(max_range)
    if max_range >= 1000 or min_range >= 1000:
        return f"{min_range / 1000:.1f}-{max_range / 1000:.1f}km"
    return f"{int(round(min_range))}-{int(round(max_range))}m"


def _choose_default_ammo_id(system_type, ammo_options):
    if not ammo_options:
        return None

    if system_type in ("mlrs", "howitzer"):
        for option in ammo_options:
            if str(option.get("variant", "")).lower() == "standard":
                return option.get("id")
    else:
        for option in ammo_options:
            if str(option.get("type", "")).upper() == "HE":
                return option.get("id")

    return ammo_options[0].get("id")


def _as_finite_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(number):
        return None

    return number


def _coerce_finite_float(value, default=0.0):
    number = _as_finite_float(value)
    return float(default) if number is None else number


def _coerce_positive_finite_float(value, default):
    number = _as_finite_float(value)
    if number is None or number <= 0.0:
        return float(default)
    return number


def _require_finite_float(value, error_message, default=None):
    if value in ("", None):
        if default is not None:
            return float(default)
        raise ValueError(error_message)

    number = _as_finite_float(value)
    if number is None:
        raise ValueError(error_message)
    return number


def _sanitize_range_bounds(min_value, max_value, table_min, table_max):
    lower = _coerce_finite_float(min_value, table_min)
    upper = _coerce_finite_float(max_value, table_max)

    lower = min(max(lower, table_min), table_max)
    upper = min(max(upper, table_min), table_max)
    if upper < lower:
        return table_min, table_max

    return lower, upper


def _sanitize_ballistic_table(ballistic_table):
    if not isinstance(ballistic_table, list):
        return []

    sanitized = []
    for entry in ballistic_table:
        if not isinstance(entry, dict):
            continue

        range_value = _as_finite_float(entry.get("range"))
        elevation = _as_finite_float(entry.get("elevation"))
        tof_available_flag = entry.get("tof_available")
        if tof_available_flag is False:
            tof_value = None
        else:
            tof_value = _as_finite_float(entry.get("tof"))
        if range_value is None or elevation is None or range_value < 0.0:
            continue

        sanitized.append(
            {
                "range": range_value,
                "elevation": elevation,
                "tof": 0.0 if tof_value is None else tof_value,
                "tof_available": tof_value is not None,
                "dElev": _coerce_finite_float(entry.get("dElev", 0.0), 0.0),
                "tofPer100m": _coerce_finite_float(entry.get("tofPer100m", 0.0), 0.0),
            }
        )

    sanitized.sort(key=lambda item: item["range"])

    deduped = []
    for entry in sanitized:
        if deduped and math.isclose(entry["range"], deduped[-1]["range"], abs_tol=RANGE_EPSILON):
            deduped[-1] = entry
        else:
            deduped.append(entry)

    return deduped


def _sanitize_legacy_table_points(table):
    if not isinstance(table, dict):
        return []

    points = []
    for distance, angle in table.items():
        distance_value = _as_finite_float(distance)
        angle_value = _as_finite_float(angle)
        if distance_value is None or angle_value is None or distance_value < 0.0:
            continue
        points.append((distance_value, angle_value))

    points.sort(key=lambda item: item[0])

    deduped = []
    for point in points:
        if deduped and math.isclose(point[0], deduped[-1][0], abs_tol=RANGE_EPSILON):
            deduped[-1] = point
        else:
            deduped.append(point)

    return deduped


def _within_range(value, lower, upper, epsilon=RANGE_EPSILON):
    return (lower - epsilon) <= value <= (upper + epsilon)


def _js_round(value):
    value = float(value)
    if value >= 0:
        return int(math.floor(value + 0.5))
    return int(math.ceil(value - 0.5))


def _round_mils(value):
    return _js_round(value)


def _azimuth_mils_from_degrees(azimuth_deg, mil_scale):
    return _js_round(float(azimuth_deg) * (float(mil_scale) / 360.0))


def _signed_angle_delta_deg(target_deg, current_deg):
    return ((float(target_deg) - float(current_deg) + 180.0) % 360.0) - 180.0


def interpolate_point_table(points, distance):
    for (d1, a1), (d2, a2) in zip(points, points[1:]):
        if d1 <= distance <= d2:
            if d2 == d1:
                return a1
            fraction = (distance - d1) / (d2 - d1)
            return a1 + fraction * (a2 - a1)
    return points[-1][1]


def interpolate_point_table_with_slope(points, distance):
    if len(points) == 1:
        return points[0][1], 0.0

    if distance <= points[0][0]:
        d1, a1 = points[0]
        d2, a2 = points[1]
        slope = (a2 - a1) / (d2 - d1) if d2 != d1 else 0.0
        return a1 + (distance - d1) * slope, slope

    for (d1, a1), (d2, a2) in zip(points, points[1:]):
        if d1 <= distance <= d2:
            if d2 == d1:
                return a1, 0.0
            slope = (a2 - a1) / (d2 - d1)
            fraction = (distance - d1) / (d2 - d1)
            return a1 + fraction * (a2 - a1), slope

    d1, a1 = points[-2]
    d2, a2 = points[-1]
    slope = (a2 - a1) / (d2 - d1) if d2 != d1 else 0.0
    return points[-1][1] + (distance - d2) * slope, slope


def interpolate_ballistic_table(ballistic_table, distance):
    points = _sanitize_ballistic_table(ballistic_table)
    if not points:
        raise ValueError("Нет баллистической таблицы для выбранного боеприпаса.")

    first_range = float(points[0]["range"])
    last_range = float(points[-1]["range"])
    if distance < (first_range - RANGE_EPSILON) or distance > (last_range + RANGE_EPSILON):
        return None
    distance = min(max(distance, first_range), last_range)

    if len(points) == 1:
        entry = points[0]
        return {
            "range": float(entry["range"]),
            "elevation": float(entry["elevation"]),
            "tof": float(entry.get("tof", 0.0) or 0.0),
            "tof_available": bool(entry.get("tof_available", True)),
            "dElev": float(entry.get("dElev", 0.0) or 0.0),
            "tofPer100m": float(entry.get("tofPer100m", 0.0) or 0.0),
        }

    for left, right in zip(points, points[1:]):
        left_range = float(left["range"])
        right_range = float(right["range"])
        if left_range <= distance <= right_range:
            if right_range == left_range:
                fraction = 0.0
            else:
                fraction = (distance - left_range) / (right_range - left_range)
            tof_available = bool(left.get("tof_available", True) and right.get("tof_available", True))
            return {
                "range": distance,
                "elevation": _lerp(float(left["elevation"]), float(right["elevation"]), fraction),
                "tof": _lerp(float(left.get("tof", 0.0) or 0.0), float(right.get("tof", 0.0) or 0.0), fraction),
                "tof_available": tof_available,
                "dElev": _lerp(float(left.get("dElev", 0.0) or 0.0), float(right.get("dElev", 0.0) or 0.0), fraction),
                "tofPer100m": _lerp(
                    float(left.get("tofPer100m", 0.0) or 0.0),
                    float(right.get("tofPer100m", 0.0) or 0.0),
                    fraction,
                ),
            }

    entry = points[-1]
    return {
        "range": float(entry["range"]),
        "elevation": float(entry["elevation"]),
        "tof": float(entry.get("tof", 0.0) or 0.0),
        "tof_available": bool(entry.get("tof_available", True)),
        "dElev": float(entry.get("dElev", 0.0) or 0.0),
        "tofPer100m": float(entry.get("tofPer100m", 0.0) or 0.0),
    }


__all__ = [
    "_as_finite_float",
    "_azimuth_mils_from_degrees",
    "_choose_default_ammo_id",
    "_coerce_finite_float",
    "_coerce_positive_finite_float",
    "_format_range_label",
    "_js_round",
    "_lerp",
    "_require_finite_float",
    "_round_mils",
    "_sanitize_ballistic_table",
    "_sanitize_legacy_table_points",
    "_sanitize_range_bounds",
    "_signed_angle_delta_deg",
    "_within_range",
    "interpolate_ballistic_table",
    "interpolate_point_table",
    "interpolate_point_table_with_slope",
]
