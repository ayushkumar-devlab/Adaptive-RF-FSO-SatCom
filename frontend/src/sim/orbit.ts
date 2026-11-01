// assumed for illustration
export const R_E = 6371;
export const ORBIT_ALTITUDE_KM = 550;
export const ORBIT_INCLINATION_DEG = 53;
export const MU = 398600.4418;
export const MASK_ELEVATION_DEG = 10;
export const EARTH_ROTATION_RAD_S = 7.2921159e-5;
export const ORBIT_RADIUS_KM = R_E + ORBIT_ALTITUDE_KM;
export const ORBIT_PERIOD_S =
  2 * Math.PI * Math.sqrt(ORBIT_RADIUS_KM ** 3 / MU);
export const SIMULATION_DAY_S = 24 * 60 * 60;
export const KM_PER_SCENE_UNIT = R_E / 2;
export const ORBIT_RADIUS_SCENE_UNITS = ORBIT_RADIUS_KM / KM_PER_SCENE_UNIT;
// Orbit altitude is exaggerated for visibility; link physics uses the true radius.
export const VISUAL_ORBIT_RADIUS = 2.45;
export const WALKER_PLANES = 12;
export const WALKER_SATS_PER_PLANE = 12;
export const WALKER_TOTAL_SATS = 144;
export const WALKER_PHASE_FACTOR = 1;
export const LINK_GEOMETRY_ASSUMPTIONS = {
  rfReferenceSnrDb: 15,
  fsoReferenceSnrDb: 22,
  zenithRangeKm: 550,
  zenithAtmosphericLossDb: 1.5,
} as const;

export type Vector3Tuple = readonly [number, number, number];
export type SimClock = { t: number; speed: number; playing: boolean };
export type SimClockRef = { current: SimClock };
export type ElevationSample = { time: number; elevation: number };
export type PassWindow = {
  start: number;
  end: number;
  maxElevation: number;
  maxTime: number;
};

export const GROUND_STATION_LAT_DEG = 12.97;
export const GROUND_STATION_LON_DEG = 77.59;

export function satellitePositionKm(timeSeconds: number): Vector3Tuple {
  const inclination = (ORBIT_INCLINATION_DEG * Math.PI) / 180;
  const anomaly = (2 * Math.PI * timeSeconds) / ORBIT_PERIOD_S;
  return [
    ORBIT_RADIUS_KM * Math.cos(anomaly),
    ORBIT_RADIUS_KM * Math.sin(anomaly) * Math.cos(inclination),
    ORBIT_RADIUS_KM * Math.sin(anomaly) * Math.sin(inclination),
  ];
}

export function orbitPoint(plane: number, argumentOfLatitude: number): Vector3Tuple {
  // Build the inclined orbital-plane point, rotate by RAAN, then map ECI to scene axes.
  const inclination = (ORBIT_INCLINATION_DEG * Math.PI) / 180;
  const raan = (plane * 2 * Math.PI) / WALKER_PLANES;
  const xOrbital = ORBIT_RADIUS_SCENE_UNITS * Math.cos(argumentOfLatitude);
  const yOrbital = ORBIT_RADIUS_SCENE_UNITS * Math.sin(argumentOfLatitude);
  const xEci = xOrbital * Math.cos(raan) - yOrbital * Math.cos(inclination) * Math.sin(raan);
  const yEci = xOrbital * Math.sin(raan) + yOrbital * Math.cos(inclination) * Math.cos(raan);
  const zEci = yOrbital * Math.sin(inclination);
  return [xEci, zEci, -yEci];
}

export function getDisplayPosition(plane: number, argumentOfLatitude: number): Vector3Tuple {
  const [x, y, z] = orbitPoint(plane, argumentOfLatitude);
  const scale = VISUAL_ORBIT_RADIUS / ORBIT_RADIUS_SCENE_UNITS;
  return [x * scale, y * scale, z * scale];
}

export function constellationSatellitePositionKm(
  timeSeconds: number,
  plane: number,
  satellite: number,
): Vector3Tuple {
  const inclination = (ORBIT_INCLINATION_DEG * Math.PI) / 180;
  const anomaly =
    (2 * Math.PI * timeSeconds) / ORBIT_PERIOD_S +
    (satellite * 2 * Math.PI) / WALKER_SATS_PER_PLANE +
    (plane * WALKER_PHASE_FACTOR * 2 * Math.PI) / WALKER_TOTAL_SATS;
  const raan = (plane * 2 * Math.PI) / WALKER_PLANES;
  const xOrbital = ORBIT_RADIUS_KM * Math.cos(anomaly);
  const yOrbital = ORBIT_RADIUS_KM * Math.sin(anomaly);
  const x = xOrbital * Math.cos(raan) - yOrbital * Math.cos(inclination) * Math.sin(raan);
  const y = xOrbital * Math.sin(raan) + yOrbital * Math.cos(inclination) * Math.cos(raan);
  const z = yOrbital * Math.sin(inclination);
  return [x, y, z];
}

export function groundStationPositionKm(timeSeconds: number): Vector3Tuple {
  const phi = (GROUND_STATION_LAT_DEG * Math.PI) / 180;
  const lambda =
    (GROUND_STATION_LON_DEG * Math.PI) / 180 +
    EARTH_ROTATION_RAD_S * timeSeconds;
  return [
    R_E * Math.cos(phi) * Math.cos(lambda),
    R_E * Math.cos(phi) * Math.sin(lambda),
    R_E * Math.sin(phi),
  ];
}

export function getOrbitMetrics(timeSeconds: number): {
  elevationDeg: number;
  slantRangeKm: number;
} {
  const satellite = satellitePositionKm(timeSeconds);
  const station = groundStationPositionKm(timeSeconds);
  const dx = satellite[0] - station[0];
  const dy = satellite[1] - station[1];
  const dz = satellite[2] - station[2];
  const slantRangeKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const stationUnitX = station[0] / R_E;
  const stationUnitY = station[1] / R_E;
  const stationUnitZ = station[2] / R_E;
  const sineElevation =
    (dx * stationUnitX + dy * stationUnitY + dz * stationUnitZ) /
    slantRangeKm;
  return {
    elevationDeg: (Math.asin(Math.max(-1, Math.min(1, sineElevation))) * 180) /
      Math.PI,
    slantRangeKm,
  };
}

export function isAboveHorizon(timeSeconds: number): boolean {
  return getOrbitMetrics(timeSeconds).elevationDeg >= MASK_ELEVATION_DEG;
}

export function isConstellationAboveHorizon(timeSeconds: number): boolean {
  const station = groundStationPositionKm(timeSeconds);
  const stationLength = Math.sqrt(station[0] ** 2 + station[1] ** 2 + station[2] ** 2);
  for (let id = 0; id < WALKER_TOTAL_SATS; id += 1) {
    const position = constellationSatellitePositionKm(
      timeSeconds,
      Math.floor(id / WALKER_SATS_PER_PLANE),
      id % WALKER_SATS_PER_PLANE,
    );
    const direction = [
      position[0] - station[0],
      position[1] - station[1],
      position[2] - station[2],
    ];
    const range = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
    const elevation = Math.asin(
      Math.max(-1, Math.min(1, (direction[0] * station[0] + direction[1] * station[1] + direction[2] * station[2]) / range / stationLength)),
    ) * 180 / Math.PI;
    if (elevation >= MASK_ELEVATION_DEG) return true;
  }
  return false;
}

export function createCoverageSummary(stepSeconds = 60) {
  let singleVisible = 0;
  let constellationVisible = 0;
  const count = Math.floor(SIMULATION_DAY_S / stepSeconds) + 1;
  for (let index = 0; index < count; index += 1) {
    const time = Math.min(SIMULATION_DAY_S, index * stepSeconds);
    if (isAboveHorizon(time)) singleVisible += 1;
    if (isConstellationAboveHorizon(time)) constellationVisible += 1;
  }
  return {
    singlePercent: (singleVisible / count) * 100,
    constellationPercent: (constellationVisible / count) * 100,
  };
}

export function getInitialSimulationTime(): number {
  const step = 30;
  for (let time = 0; time <= SIMULATION_DAY_S; time += step) {
    if (isAboveHorizon(time)) return Math.max(0, time - 150);
  }
  return 0;
}

export function createPassSamples(stepSeconds = 30): ElevationSample[] {
  const samples: ElevationSample[] = [];
  for (let time = 0; time <= SIMULATION_DAY_S; time += stepSeconds) {
    samples.push({ time, elevation: getOrbitMetrics(time).elevationDeg });
  }
  return samples;
}

export function getNextPassTime(
  timeSeconds: number,
  samples?: readonly ElevationSample[],
): number | null {
  if (samples && samples.length > 1) {
    const step = samples[1].time - samples[0].time;
    let wasVisible = isAboveHorizon(timeSeconds);
    let leftCurrentPass = !wasVisible;
    for (let time = Math.floor(timeSeconds / step) * step + step;
      time <= timeSeconds + SIMULATION_DAY_S;
      time += step) {
      const dayOffset = Math.floor(time / SIMULATION_DAY_S) * SIMULATION_DAY_S;
      const sampleTime = time - dayOffset;
      const sampleIndex = Math.min(
        samples.length - 1,
        Math.round(sampleTime / step),
      );
      const visible = samples[sampleIndex].elevation >= MASK_ELEVATION_DEG;
      if (wasVisible && !visible) leftCurrentPass = true;
      if (leftCurrentPass && !wasVisible && visible) return time;
      wasVisible = visible;
    }
    return null;
  }

  const step = 30;
  const start = Math.floor(timeSeconds / step) * step;
  let wasVisible = isAboveHorizon(timeSeconds);
  let leftCurrentPass = !wasVisible;
  for (let time = start + step; time <= timeSeconds + SIMULATION_DAY_S; time += step) {
    const visible = isAboveHorizon(time);
    if (wasVisible && !visible) leftCurrentPass = true;
    if (leftCurrentPass && !wasVisible && visible) return time;
    wasVisible = visible;
  }
  return null;
}

export function createElevationSamples() {
  const samples: Array<{ time: number; elevation: number }> = [];
  for (let time = 0; time <= SIMULATION_DAY_S; time += 120) {
    samples.push({ time, elevation: getOrbitMetrics(time).elevationDeg });
  }
  return samples;
}

export function findPasses(
  samples: readonly ElevationSample[],
  mask: number,
): PassWindow[] {
  const passes: PassWindow[] = [];
  let current: PassWindow | null = null;
  for (const sample of samples) {
    if (sample.elevation >= mask) {
      if (!current) {
        current = {
          start: sample.time,
          end: sample.time,
          maxElevation: sample.elevation,
          maxTime: sample.time,
        };
      } else {
        current.end = sample.time;
        if (sample.elevation > current.maxElevation) {
          current.maxElevation = sample.elevation;
          current.maxTime = sample.time;
        }
      }
    } else if (current) {
      passes.push(current);
      current = null;
    }
  }
  if (current) passes.push(current);
  return passes;
}

export function subSatellitePoint(timeSeconds: number): {
  latitudeDeg: number;
  longitudeDeg: number;
} {
  const [x, y, z] = satellitePositionKm(timeSeconds);
  const theta = EARTH_ROTATION_RAD_S * timeSeconds;
  const earthFixedX = x * Math.cos(theta) + y * Math.sin(theta);
  const earthFixedY = -x * Math.sin(theta) + y * Math.cos(theta);
  const radius = Math.sqrt(earthFixedX ** 2 + earthFixedY ** 2 + z ** 2);
  return {
    latitudeDeg: (Math.asin(z / radius) * 180) / Math.PI,
    longitudeDeg: (Math.atan2(earthFixedY, earthFixedX) * 180) / Math.PI,
  };
}
