import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  CameraControls,
  CameraControlsImpl,
  Html,
  Stars,
  useTexture,
} from "@react-three/drei";
import type { RefObject } from "react";
import * as THREE from "three";
import { theme } from "./theme";
import {
  EARTH_ROTATION_RAD_S,
  MASK_ELEVATION_DEG,
  ORBIT_INCLINATION_DEG,
  ORBIT_PERIOD_S,
  ORBIT_RADIUS_SCENE_UNITS,
  R_E,
  WALKER_SATS_PER_PLANE,
  WALKER_TOTAL_SATS,
  getNextPassTime,
  SIMULATION_DAY_S,
  type ElevationSample,
  type SimClockRef,
} from "./sim/orbit";

const rfShaderColor = new THREE.Color(theme.rf);
const fsoSignalColor = new THREE.Color(theme.fso);

// Change these coordinates to move the illustrative ground station.
const GROUND_STATION = { name: "Ground station", lat: 12.97, lon: 77.59 };

function latLonToVector3(
  lat: number,
  lon: number,
  radius: number,
): THREE.Vector3 {
  const latitude = THREE.MathUtils.degToRad(lat);
  const longitude = THREE.MathUtils.degToRad(lon);
  const latitudeRadius = radius * Math.cos(latitude);

  return new THREE.Vector3(
    latitudeRadius * Math.cos(longitude),
    radius * Math.sin(latitude),
    -latitudeRadius * Math.sin(longitude),
  );
}

const STATION_SCALE = 1.2;
const GROUND_STATION_POSITION = latLonToVector3(
  GROUND_STATION.lat,
  GROUND_STATION.lon,
  2,
);
const GROUND_STATION_NORMAL = latLonToVector3(
  GROUND_STATION.lat,
  GROUND_STATION.lon,
  1,
);
const GROUND_STATION_ORIENTATION = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 1, 0),
  GROUND_STATION_NORMAL,
);
const EARTH_NORMAL_SCALE = new THREE.Vector2(0.8, 0.8);
const UNIT_Y = new THREE.Vector3(0, 1, 0);
const ORBIT_INCLINATION_RAD = THREE.MathUtils.degToRad(ORBIT_INCLINATION_DEG);
const DISPLAY_ORBIT_RADIUS = 3.25;

export type CameraView = "orbit" | "ground" | "follow" | "overview" | "manual";

function setOrbitPosition(
  target: THREE.Vector3,
  plane: number,
  argumentOfLatitude: number,
  radius: number,
) {
  const raan = (plane * 2 * Math.PI) / 12;
  const xOrbital = radius * Math.cos(argumentOfLatitude);
  const yOrbital = radius * Math.sin(argumentOfLatitude);
  const xEci = xOrbital * Math.cos(raan) - yOrbital * Math.cos(ORBIT_INCLINATION_RAD) * Math.sin(raan);
  const yEci = xOrbital * Math.sin(raan) + yOrbital * Math.cos(ORBIT_INCLINATION_RAD) * Math.cos(raan);
  const zEci = yOrbital * Math.sin(ORBIT_INCLINATION_RAD);
  target.set(xEci, zEci, -yEci);
}

function updateCameraAspect(camera: THREE.Camera, aspect: number) {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}

type SceneProps = {
  selectedLink: string;
  cloudAttenuationDb: number;
  cameraView: CameraView;
  htmlPortal: RefObject<HTMLElement>;
  clockRef: SimClockRef;
  orbitTimeRef: RefObject<number>;
  passSamples: readonly ElevationSample[];
  autoSkip: boolean;
  onAutoSkip: (seconds: number) => void;
  playing: boolean;
  controlsEnabled: boolean;
  stageHeight: number;
  onCameraManual: () => void;
  onLinkTruth: (truth: LinkTruth) => void;
  constellationMode: boolean;
  showConstellation?: boolean;
};

type LinkTruth = {
  visible: boolean;
  elevationDeg: number;
  slantRangeKm: number;
  satelliteId: number;
  inViewCount: number;
};
type LinkTruthRef = { current: LinkTruth };

type LinkSelectionProps = Pick<SceneProps, "selectedLink">;

const _occSeg = new THREE.Vector3();
const _occDir = new THREE.Vector3();
const _occToEarth = new THREE.Vector3();
const _occClosest = new THREE.Vector3();
const _earthRotationAxis = new THREE.Vector3(0, 1, 0);
const _satelliteOrbitNormal = new THREE.Vector3();
const _satelliteNadir = new THREE.Vector3();
const _satelliteAlongTrack = new THREE.Vector3();
const _satelliteCrossTrack = new THREE.Vector3();
const _satelliteAttitudeMatrix = new THREE.Matrix4();
const _satelliteAttitudeQuaternion = new THREE.Quaternion();
const FRAMING_RADIUS = 3.7;
const AUTO_AIM_SHIFT = 0.45;

function checkSatelliteOcclusion(
  camPos: THREE.Vector3,
  satPos: THREE.Vector3,
  earthPos: THREE.Vector3,
  earthRadius = 2.0,
): boolean {
  _occSeg.subVectors(satPos, camPos);
  const len = _occSeg.length();
  if (len < 1e-6) return false;
  _occDir.copy(_occSeg).multiplyScalar(1 / len);
  _occToEarth.subVectors(earthPos, camPos);
  const t = _occToEarth.dot(_occDir);
  const tClosest = Math.max(0, Math.min(len, t));
  _occClosest.copy(camPos).addScaledVector(_occDir, tClosest);
  return _occClosest.distanceToSquared(earthPos) < earthRadius * earthRadius;
}

type CalloutProps = {
  direction: "up-right" | "down-left";
  title: string;
  subtitle?: string;
  detail?: string;
};

function Callout({ direction, title, subtitle, detail }: CalloutProps) {
  if (direction === "up-right") {
    return (
      <div className="callout callout-up-right">
        <div className="callout-dot" style={{ left: 20, top: -18 }} />
        <svg
          className="callout-leader"
          style={{ position: "absolute", left: 20, top: -38, width: 36, height: 20 }}
        >
          <polyline
            points="0,20 20,0 36,0"
            fill="none"
            stroke="var(--border)"
            strokeWidth="1.5"
          />
        </svg>
        <div
          className="callout-card"
          style={{ position: "absolute", left: 58, top: -52 }}
        >
          <div className="callout-title">{title}</div>
          {subtitle && <div className="callout-sub">{subtitle}</div>}
          {detail && <div className="callout-sub">{detail}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="callout callout-down-left">
      <div className="callout-dot" style={{ left: 0, top: 0 }} />
      <svg
        className="callout-leader"
        style={{ position: "absolute", left: -36, top: 0, width: 36, height: 22 }}
      >
        <polyline
          points="36,0 16,22 0,22"
          fill="none"
          stroke="var(--border)"
          strokeWidth="1.5"
        />
      </svg>
      <div
        className="callout-card"
        style={{
          position: "absolute",
          left: -40,
          top: 8,
          transform: "translateX(-100%)",
        }}
      >
        <div className="callout-title">{title}</div>
        {subtitle && <div className="callout-sub">{subtitle}</div>}
        {detail && <div className="callout-sub">{detail}</div>}
      </div>
    </div>
  );
}

function StationCallout({
  stationRef,
  earthCenterRef,
  htmlPortal,
}: {
  stationRef: RefObject<THREE.Group | null>;
  earthCenterRef: RefObject<THREE.Group | null>;
  htmlPortal: RefObject<HTMLElement>;
}) {
  const { camera } = useThree();
  const [visible, setVisible] = useState(true);
  const stationWorldPos = useMemo(() => new THREE.Vector3(), []);
  const earthWorldPos = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  const toCam = useMemo(() => new THREE.Vector3(), []);
  const elapsedRef = useRef(0);
  const visibleRef = useRef(true);

  useFrame((_, delta) => {
    elapsedRef.current += Math.min(delta, 0.05);
    if (elapsedRef.current < 0.25) return;
    elapsedRef.current = 0;
    const station = stationRef.current;
    const earthCenter = earthCenterRef.current;
    if (!station || !earthCenter) return;
    station.getWorldPosition(stationWorldPos);
    earthCenter.getWorldPosition(earthWorldPos);
    up.subVectors(stationWorldPos, earthWorldPos).normalize();
    toCam.subVectors(camera.position, stationWorldPos);
    const nextVisible = up.dot(toCam) > 0.02;
    if (nextVisible !== visibleRef.current) {
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
    }
  }, -1);

  if (!visible) return null;

  return (
    <Html position={[0, 0.22, 0]} center portal={htmlPortal}>
      <MemoizedCallout
        direction="down-left"
        title="Ground station / Bengaluru · 12.97°N 77.59°E"
      />
    </Html>
  );
}

const MemoizedCallout = memo(Callout);
const MemoizedStationCallout = memo(StationCallout);

function Earth({
  stationRef,
  stationDishRef,
  dishFeedRef,
  earthCenterRef,
  cloudAttenuationDb,
  htmlPortal,
}: {
  stationRef: RefObject<THREE.Group | null>;
  stationDishRef: RefObject<THREE.Group | null>;
  dishFeedRef: RefObject<THREE.Group | null>;
  earthCenterRef: RefObject<THREE.Group | null>;
  cloudAttenuationDb: number;
  htmlPortal: RefObject<HTMLElement>;
}) {
  const [colorMap, specularMap, normalMap, cloudsMap, lightsMap] = useTexture(
    [
      "/textures/earth_atmos_2048.jpg",
      "/textures/earth_specular_2048.jpg",
      "/textures/earth_normal_2048.jpg",
      "/textures/earth_clouds_1024.png",
      "/textures/earth_lights_2048.png",
    ],
    (textures) => {
      for (const texture of textures) {
        texture.anisotropy = 8;
        texture.needsUpdate = true;
      }
      textures[0].colorSpace = THREE.SRGBColorSpace;
      textures[3].colorSpace = THREE.SRGBColorSpace;
      textures[4].colorSpace = THREE.SRGBColorSpace;
    },
  );
  const cloudOpacity =
    0.25 + 0.7 * THREE.MathUtils.clamp(cloudAttenuationDb / 30, 0, 1);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[2, 96, 96]} />
        <meshStandardMaterial
          map={colorMap}
          normalMap={normalMap}
          normalScale={EARTH_NORMAL_SCALE}
          roughnessMap={specularMap}
          emissiveMap={lightsMap}
          emissive={theme.card}
          emissiveIntensity={0.9}
          roughness={0.9}
          metalness={0}
          color={theme.scene.planet}
          onBeforeCompile={(shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
              "totalEmissiveRadiance *= emissiveColor.rgb;",
              "totalEmissiveRadiance *= emissiveColor.rgb * (1.0 - smoothstep(0.0, 0.25, max(dot(normalize(geometry.normal), normalize(directionalLights[0].direction)), 0.0)));",
            );
          }}
        />
      </mesh>
      <GroundStation
        stationRef={stationRef}
        stationDishRef={stationDishRef}
        dishFeedRef={dishFeedRef}
        earthCenterRef={earthCenterRef}
        htmlPortal={htmlPortal}
      />
      <mesh>
        <sphereGeometry args={[2.02, 96, 96]} />
        <meshStandardMaterial
          map={cloudsMap}
          color={theme.scene.cloud}
          transparent
          opacity={cloudOpacity}
          depthWrite={false}
          roughness={1}
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[2.08, 96, 96]} />
        <shaderMaterial
          vertexShader={`
            varying vec3 vNormal;

            void main() {
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying vec3 vNormal;

            void main() {
              float intensity = pow(max(0.0, 0.72 - dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 3.0);
              float alpha = min(intensity, 1.0) * 0.35;
              gl_FragColor = vec4(vec3(${rfShaderColor.r}, ${rfShaderColor.g}, ${rfShaderColor.b}), alpha);
            }
          `}
          transparent
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function SatelliteModel({
  selectedLink,
  stationRef,
  earthCenterRef,
  satelliteRef,
  rfEmitterRef,
  fsoEmitterRef,
  htmlPortal,
  orbitTimeRef,
  linkTruthRef,
  onLinkTruth,
  constellationMode,
}: LinkSelectionProps & {
  stationRef: RefObject<THREE.Group | null>;
  earthCenterRef: RefObject<THREE.Group | null>;
  satelliteRef: RefObject<THREE.Group | null>;
  rfEmitterRef: RefObject<THREE.Group | null>;
  fsoEmitterRef: RefObject<THREE.Group | null>;
  htmlPortal: RefObject<HTMLElement>;
  orbitTimeRef: RefObject<number>;
  linkTruthRef: LinkTruthRef;
  onLinkTruth: (truth: LinkTruth) => void;
  constellationMode: boolean;
}) {
  const solarTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create the satellite solar-array texture.");
    }

    context.fillStyle = theme.rfFill;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = theme.scene.silver;
    context.lineWidth = 2;
    for (let x = 0; x <= canvas.width; x += 32) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 32) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }, []);
  useEffect(() => () => solarTexture.dispose(), [solarTexture]);
  const stationWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const satelliteWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const earthCenter = useMemo(() => new THREE.Vector3(), []);
  const stationLocalBaseline = useMemo(() => new THREE.Vector3(), []);
  const stationNormal = useMemo(() => new THREE.Vector3(), []);
  const satelliteDirection = useMemo(() => new THREE.Vector3(), []);
  const realSatelliteLocalPosition = useMemo(() => new THREE.Vector3(), []);
  const planeNormal = useMemo(() => new THREE.Vector3(), []);
  const constellationCandidate = useMemo(() => new THREE.Vector3(), []);
  const candidateDirection = useMemo(() => new THREE.Vector3(), []);
  const stationBaselineCapturedRef = useRef(false);
  const linkUpRef = useRef(false);
  const publishElapsedRef = useRef(0);
  const servingIdRef = useRef(1);
  const lastPublishedRef = useRef<LinkTruth | null>(null);
  const rfActive = selectedLink === "RF";
  const fsoActive = selectedLink === "FSO";

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (satelliteRef.current) {
      const currentPlane = Math.floor((servingIdRef.current - 1) / WALKER_SATS_PER_PLANE);
      const currentSatellite = (servingIdRef.current - 1) % WALKER_SATS_PER_PLANE;
      const anomaly = (2 * Math.PI * orbitTimeRef.current) / ORBIT_PERIOD_S;
      const argumentOfLatitude = constellationMode
        ? anomaly +
          (currentSatellite * 2 * Math.PI) / WALKER_SATS_PER_PLANE +
          (currentPlane * 2 * Math.PI) / WALKER_TOTAL_SATS
        : anomaly;
      const orbitPlane = constellationMode ? currentPlane : 0;
      setOrbitPosition(realSatelliteLocalPosition, orbitPlane, argumentOfLatitude, ORBIT_RADIUS_SCENE_UNITS);
      setOrbitPosition(satelliteRef.current.position, orbitPlane, argumentOfLatitude, DISPLAY_ORBIT_RADIUS);

      const raan = (orbitPlane * 2 * Math.PI) / 12;
      _satelliteOrbitNormal.set(
        Math.sin(ORBIT_INCLINATION_RAD) * Math.sin(raan),
        Math.cos(ORBIT_INCLINATION_RAD),
        Math.sin(ORBIT_INCLINATION_RAD) * Math.cos(raan),
      );
      _satelliteNadir.copy(satelliteRef.current.position).negate().normalize();
      _satelliteAlongTrack
        .crossVectors(_satelliteOrbitNormal, satelliteRef.current.position)
        .normalize();
      _satelliteCrossTrack
        .crossVectors(_satelliteNadir, _satelliteAlongTrack)
        .normalize();
      _satelliteAttitudeMatrix.makeBasis(
        _satelliteCrossTrack,
        _satelliteNadir,
        _satelliteAlongTrack,
      );
      _satelliteAttitudeQuaternion.setFromRotationMatrix(_satelliteAttitudeMatrix);
      satelliteRef.current.quaternion.copy(_satelliteAttitudeQuaternion);
      if (import.meta.env.DEV) {
        planeNormal.set(
          Math.sin(ORBIT_INCLINATION_RAD) * Math.sin(raan),
          Math.cos(ORBIT_INCLINATION_RAD),
          Math.sin(ORBIT_INCLINATION_RAD) * Math.cos(raan),
        );
        console.assert(
          Math.abs(satelliteRef.current.position.length() - DISPLAY_ORBIT_RADIUS) < 0.001 &&
          Math.abs(satelliteRef.current.position.dot(planeNormal)) < 0.001,
          "Serving satellite is not on its orbit plane.",
        );
      }
    }
    if (stationRef.current && earthCenterRef.current && satelliteRef.current) {
      stationRef.current.getWorldPosition(stationWorldPosition);
      earthCenterRef.current.getWorldPosition(earthCenter);
      satelliteWorldPosition.copy(realSatelliteLocalPosition).applyMatrix4(earthCenterRef.current.matrixWorld);
      stationNormal.subVectors(stationWorldPosition, earthCenter).normalize();
      satelliteDirection.subVectors(satelliteWorldPosition, stationWorldPosition);
      const elevation = Math.asin(
        THREE.MathUtils.clamp(
          satelliteDirection.dot(stationNormal) / satelliteDirection.length(),
          -1,
          1,
        ),
      ) * THREE.MathUtils.RAD2DEG;
      const slantRangeKm = satelliteDirection.length() * (R_E / 2);
      let inViewCount = 0;
      let bestElevation = elevation;
      let bestId = servingIdRef.current;
      if (constellationMode) {
        for (let id = 1; id <= WALKER_TOTAL_SATS; id += 1) {
          const plane = Math.floor((id - 1) / WALKER_SATS_PER_PLANE);
          const sat = (id - 1) % WALKER_SATS_PER_PLANE;
          const candidateAnomaly =
            (2 * Math.PI * orbitTimeRef.current) / ORBIT_PERIOD_S +
            (sat * 2 * Math.PI) / WALKER_SATS_PER_PLANE +
            (plane * 2 * Math.PI) / WALKER_TOTAL_SATS;
          setOrbitPosition(constellationCandidate, plane, candidateAnomaly, ORBIT_RADIUS_SCENE_UNITS);
          constellationCandidate.applyMatrix4(earthCenterRef.current.matrixWorld);
          candidateDirection.subVectors(constellationCandidate, stationWorldPosition);
          const candidateElevation = Math.asin(THREE.MathUtils.clamp(candidateDirection.dot(stationNormal) / candidateDirection.length(), -1, 1)) * THREE.MathUtils.RAD2DEG;
          if (candidateElevation >= MASK_ELEVATION_DEG) inViewCount += 1;
          if (candidateElevation > bestElevation) {
            bestElevation = candidateElevation;
            bestId = id;
          }
        }
        if (bestId !== servingIdRef.current && elevation < 15) {
          servingIdRef.current = bestId;
        }
      }
      const currentElevation = constellationMode ? bestElevation : elevation;
      linkUpRef.current = currentElevation >= MASK_ELEVATION_DEG;
      const truth = linkTruthRef.current;
      truth.visible = linkUpRef.current;
      truth.elevationDeg = currentElevation;
      truth.slantRangeKm = slantRangeKm;
      truth.satelliteId = servingIdRef.current;
      truth.inViewCount = constellationMode ? inViewCount : (elevation >= MASK_ELEVATION_DEG ? 1 : 0);
      publishElapsedRef.current += dt;
      if (publishElapsedRef.current >= 0.25) {
        publishElapsedRef.current = 0;
        const previous = lastPublishedRef.current;
        if (
          !previous ||
          previous.visible !== truth.visible ||
          Math.round(previous.elevationDeg) !== Math.round(truth.elevationDeg) ||
          Math.round(previous.slantRangeKm) !== Math.round(truth.slantRangeKm) ||
          previous.satelliteId !== truth.satelliteId ||
          previous.inViewCount !== truth.inViewCount
        ) {
          const publishedTruth = { ...truth };
          lastPublishedRef.current = publishedTruth;
          onLinkTruth(publishedTruth);
        }
      }
      if (import.meta.env.DEV) {
        if (!stationBaselineCapturedRef.current) {
          stationLocalBaseline.copy(stationRef.current.position);
          stationBaselineCapturedRef.current = true;
        }
        console.assert(
          stationRef.current.position.distanceToSquared(stationLocalBaseline) < 0.000001,
          "Ground station local position changed.",
        );
        console.assert(
          Math.abs(stationWorldPosition.distanceTo(earthCenter) - 2) < 0.001,
          "Ground station is not on the Earth surface.",
        );
        console.assert(
          Math.abs(satelliteWorldPosition.distanceTo(earthCenter) - ORBIT_RADIUS_SCENE_UNITS) < 0.001,
          "Satellite orbit radius is inconsistent with the assumed orbit.",
        );
      }
      const target = truth.visible ? stationWorldPosition : earthCenter;
      rfEmitterRef.current?.lookAt(target);
      fsoEmitterRef.current?.lookAt(target);
    }
  }, -2);

  return (
    <group ref={satelliteRef}>
      <MemoizedSatelliteCallout selectedLink={selectedLink} htmlPortal={htmlPortal} orbitTimeRef={orbitTimeRef} satelliteRef={satelliteRef} linkTruthRef={linkTruthRef} earthCenterRef={earthCenterRef} />
      <group scale={0.45}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.24, 0.008, 8, 32]} />
        <meshBasicMaterial color={theme.text} transparent opacity={0.9} depthTest />
      </mesh>
      <pointLight position={[0.8, 0.6, 0.5]} intensity={1.4} distance={3} color={theme.scene.dayLight} />
      <mesh>
        <boxGeometry args={[0.3, 0.24, 0.22]} />
        <meshStandardMaterial
          color={theme.scene.satelliteGold}
          metalness={0.9}
          roughness={0.35}
        />
      </mesh>

      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.11, 0, 0.116]}>
          <boxGeometry args={[0.035, 0.2, 0.008]} />
          <meshStandardMaterial color={theme.scene.silver} metalness={0.85} roughness={0.3} />
        </mesh>
      ))}

      <mesh position={[0, 0, -0.116]}>
        <boxGeometry args={[0.24, 0.18, 0.008]} />
        <meshStandardMaterial color={theme.scene.silver} metalness={0.85} roughness={0.3} />
      </mesh>

      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.16, 0, 0]}>
          <mesh
            position={[side * 0.24, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.009, 0.009, 0.5, 8]} />
            <meshStandardMaterial color={theme.scene.silver} metalness={0.85} roughness={0.3} />
          </mesh>
          {[0, 1, 2].map((panel) => (
            <mesh
              key={panel}
              position={[side * (0.08 + panel * 0.16), 0.012, 0]}
            >
              <boxGeometry args={[0.15, 0.012, 0.2]} />
              <meshStandardMaterial
                map={solarTexture}
                metalness={0.45}
                roughness={0.42}
              />
            </mesh>
          ))}
          </group>
      ))}

      <group ref={rfEmitterRef} position={[-0.075, 0.105, 0]}>
        <mesh position={[0, 0, 0.035]} rotation={[Math.PI / 2, 0, 0]}>
          <sphereGeometry args={[0.09, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={theme.scene.silver}
            metalness={0.9}
            roughness={0.25}
            emissive={theme.rf}
            emissiveIntensity={rfActive ? 0.28 : 0.025}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0, 0.105]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.022, 0.08, 12]} />
          <meshStandardMaterial color={theme.scene.satelliteGold} metalness={0.8} roughness={0.35} />
        </mesh>
      </group>

      <group ref={fsoEmitterRef} position={[0.09, 0.105, 0]}>
        <mesh position={[0, 0, 0.065]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.028, 0.13, 16]} />
          <meshStandardMaterial color={theme.scene.satelliteGold} metalness={0.85} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.135]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.019, 0.019, 0.009, 20]} />
          <meshStandardMaterial
            color={theme.fso}
            emissive={theme.fso}
            emissiveIntensity={fsoActive ? 0.4 : 0.025}
            metalness={0.3}
            roughness={0.2}
          />
        </mesh>
        <mesh position={[0, 0, 0.14]}>
          <torusGeometry args={[0.023, 0.003, 8, 24]} />
          <meshBasicMaterial color={theme.fso} />
        </mesh>
      </group>

      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.012, 0.018, 0.08, 12]} />
        <meshStandardMaterial
          color={theme.scene.silver}
          metalness={0.8}
          roughness={0.35}
        />
      </mesh>
      </group>
    </group>
  );
}

const MemoizedSatelliteModel = memo(SatelliteModel);

function SatelliteCallout({
  selectedLink,
  htmlPortal,
  orbitTimeRef,
  satelliteRef,
  linkTruthRef,
  earthCenterRef,
}: {
  selectedLink: string;
  htmlPortal: RefObject<HTMLElement>;
  orbitTimeRef: RefObject<number>;
  satelliteRef: RefObject<THREE.Group | null>;
  linkTruthRef: LinkTruthRef;
  earthCenterRef: RefObject<THREE.Group | null>;
}) {
  const { camera } = useThree();
  const [visible, setVisible] = useState(true);
  const [title, setTitle] = useState("SATCOM-1");
  const [subtitle, setSubtitle] = useState("Below horizon");
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const satWorld = useMemo(() => new THREE.Vector3(), []);
  const earthWorld = useMemo(() => new THREE.Vector3(), []);
  const earthLocalPosition = useMemo(() => new THREE.Vector3(), []);
  const elapsedRef = useRef(0);
  const visibleRef = useRef(true);
  const titleRef = useRef("SATCOM-1");
  const subtitleRef = useRef("Below horizon");
  const detailRef = useRef<string | undefined>(undefined);

  useFrame((_, delta) => {
    elapsedRef.current += Math.min(delta, 0.05);
    if (elapsedRef.current < 0.25) return;
    elapsedRef.current = 0;
    const satellite = satelliteRef.current;
    const earthCenter = earthCenterRef.current;
    if (!satellite || !earthCenter) return;
    satellite.getWorldPosition(satWorld);
    earthCenter.getWorldPosition(earthWorld);

    // Ray-sphere intersection test: Earth blocks satellite view
    const occluded = checkSatelliteOcclusion(camera.position, satWorld, earthWorld, 2.0);
    const nextVisible = !occluded;
    if (nextVisible !== visibleRef.current) {
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
    }
    const truth = linkTruthRef.current;
    const nextTitle = `SATCOM-${truth.satelliteId}`;
    const nextSubtitle =
      truth.visible
        ? `Elevation ${Math.round(truth.elevationDeg)}° · ${Math.round(truth.slantRangeKm).toLocaleString()} km`
        : "Below horizon";
    const nextDetail = truth.visible ? `Active link: ${selectedLink}` : undefined;
    if (nextTitle !== titleRef.current) {
      titleRef.current = nextTitle;
      setTitle(nextTitle);
    }
    if (nextSubtitle !== subtitleRef.current) {
      subtitleRef.current = nextSubtitle;
      setSubtitle(nextSubtitle);
    }
    if (nextDetail !== detailRef.current) {
      detailRef.current = nextDetail;
      setDetail(nextDetail);
    }

    if (import.meta.env.DEV && linkTruthRef.current.elevationDeg > 85) {
      earthLocalPosition.copy(satellite.position).applyAxisAngle(
        _earthRotationAxis,
        -EARTH_ROTATION_RAD_S * orbitTimeRef.current,
      );
      const radius = earthLocalPosition.length();
      const latitudeDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(earthLocalPosition.y / radius, -1, 1)));
      const longitudeDeg = THREE.MathUtils.radToDeg(Math.atan2(-earthLocalPosition.z, earthLocalPosition.x));
      console.assert(
        Math.abs(latitudeDeg - GROUND_STATION.lat) < 3 && Math.abs(longitudeDeg - GROUND_STATION.lon) < 3,
        "Overhead satellite position does not match the ground-station texture mapping.",
      );
    }
  }, -1);

  if (!visible) return null;

  return (
    <Html position={[0, 0, 0]} center portal={htmlPortal}>
      <MemoizedCallout
        direction="up-right"
        title={title}
        subtitle={subtitle}
        detail={detail}
      />
    </Html>
  );
}

const MemoizedSatelliteCallout = memo(SatelliteCallout);

function GroundStation({
  stationRef,
  stationDishRef,
  dishFeedRef,
  earthCenterRef,
  htmlPortal,
}: {
  stationRef: RefObject<THREE.Group | null>;
  stationDishRef: RefObject<THREE.Group | null>;
  dishFeedRef: RefObject<THREE.Group | null>;
  earthCenterRef: RefObject<THREE.Group | null>;
  htmlPortal: RefObject<HTMLElement>;
}) {
  return (
    <group
      ref={stationRef}
      position={GROUND_STATION_POSITION}
      quaternion={GROUND_STATION_ORIENTATION}
      scale={STATION_SCALE}
    >
      <mesh position={[0, 0.014, 0]}>
        <cylinderGeometry args={[0.055, 0.065, 0.028, 24]} />
        <meshStandardMaterial color={theme.scene.silver} metalness={0.65} />
      </mesh>

      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.012, 0.018, 0.1, 16]} />
        <meshStandardMaterial color={theme.scene.silver} metalness={0.7} />
      </mesh>

      <group ref={stationDishRef} position={[0, 0.13, 0]}>
        <mesh>
          <sphereGeometry
            args={[0.075, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.48]}
          />
          <meshStandardMaterial
            color={theme.scene.silver}
            metalness={0.75}
            roughness={0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
        <group ref={dishFeedRef} position={[0, 0.07, 0]} />
      </group>

      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.009, 0.018, 0.045, 12]} />
        <meshStandardMaterial color={theme.scene.silver} metalness={0.7} />
      </mesh>

      <MemoizedStationCallout
        stationRef={stationRef}
        earthCenterRef={earthCenterRef}
        htmlPortal={htmlPortal}
      />

      <mesh position={[0, 0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.085, 0.003, 8, 40]} />
        <meshBasicMaterial color={theme.rf} />
      </mesh>

      <mesh
        position={[0, 0.008, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.18, 0.1, 1]}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial
          color={theme.rf}
          transparent
          opacity={0.12}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.009, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.024, 24]} />
        <meshBasicMaterial
          color={theme.fso}
          transparent
          opacity={0.85}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function CameraRig({
  cameraView,
  stationRef,
  satelliteRef,
  earthCenterRef,
  controlsEnabled,
  stageHeight,
  onCameraManual,
}: {
  cameraView: SceneProps["cameraView"];
  stationRef: RefObject<THREE.Group | null>;
  satelliteRef: RefObject<THREE.Group | null>;
  earthCenterRef: RefObject<THREE.Group | null>;
  controlsEnabled: boolean;
  stageHeight: number;
  onCameraManual: () => void;
}) {
  const { camera, size } = useThree();
  const controlsRef = useRef<CameraControlsImpl>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const target = useMemo(() => new THREE.Vector3(), []);
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  const desiredCameraPosition = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const followAbove = useMemo(() => new THREE.Vector3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);
  const currentTarget = useMemo(() => new THREE.Vector3(), []);
  const earthQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const zenith = useMemo(() => new THREE.Vector3(), []);
  const earthNorth = useMemo(() => new THREE.Vector3(), []);
  const stationNorth = useMemo(() => new THREE.Vector3(), []);
  const viewDirection = useMemo(() => new THREE.Vector3(), []);
  const aimTarget = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    updateCameraAspect(camera, size.width / Math.max(1, size.height));
    if (camera instanceof THREE.PerspectiveCamera) {
      const aspect = size.width / Math.max(1, size.height);
      camera.fov = cameraView === "orbit"
        ? THREE.MathUtils.radToDeg(
            2 * Math.atan((DISPLAY_ORBIT_RADIUS * 1.08) / (8 * Math.min(1, aspect))),
          )
        : 45;
      camera.updateProjectionMatrix();
    }
    camera.setViewOffset(size.width, size.height, 0, Math.max(0, (size.height - stageHeight) / 2), size.width, size.height);
    camera.updateProjectionMatrix();
    return () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, cameraView, size.height, size.width, stageHeight]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || cameraView === "manual" || cameraView === "ground" || cameraView === "follow") return;

    if (cameraView === "orbit") {
      controls.setLookAt(0, -1.7, 8, 0, -1.7, 0, false);
      return;
    }

    if (cameraView === "overview") {
      controls.setLookAt(0, -0.3, 8.5, 0, -1.1, 0, true);
      return;
    }

  }, [cameraView]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const controls = controlsRef.current;
    if (!controls || cameraBusy) return;

    if (cameraView === "follow" && satelliteRef.current && earthCenterRef.current) {
      satelliteRef.current.updateWorldMatrix(true, false);
      satelliteRef.current.getWorldPosition(target);
      earthCenterRef.current.getWorldPosition(center);
      direction.copy(target).sub(center).normalize();
      followAbove.set(0, 1, 0).addScaledVector(direction, -direction.y);
      if (followAbove.lengthSq() < 1e-6) {
        followAbove.set(1, 0, 0).addScaledVector(direction, -direction.x);
      }
      followAbove.normalize();
      desiredCameraPosition
        .copy(target)
        .addScaledVector(direction, 1.55)
        .addScaledVector(followAbove, 0.65);

      const damping = 1 - Math.pow(0.85, dt * 60);
      controls.getPosition(cameraPosition);
      cameraPosition.lerp(desiredCameraPosition, damping);
      controls.getTarget(currentTarget);
      currentTarget.lerp(target, damping);
      controls.setLookAt(
        cameraPosition.x,
        cameraPosition.y,
        cameraPosition.z,
        currentTarget.x,
        currentTarget.y,
        currentTarget.z,
        false,
      );
      return;
    }

    if (cameraView === "ground" && stationRef.current && earthCenterRef.current) {
      stationRef.current.getWorldPosition(target);
      earthCenterRef.current.getWorldPosition(center);
      const earthQuat = earthCenterRef.current.getWorldQuaternion(earthQuaternion);

      direction.subVectors(target, center);
      zenith.copy(direction).normalize();

      aimTarget.copy(center).addScaledVector(zenith, AUTO_AIM_SHIFT);

      // Earth's North pole in world coordinates
      earthNorth.copy(UNIT_Y).applyQuaternion(earthQuat).normalize();
      stationNorth.copy(earthNorth).addScaledVector(zenith, -earthNorth.dot(zenith)).normalize();

      // View station about 32° off its zenith, tilted south
      const angle32 = THREE.MathUtils.degToRad(32);
      viewDirection.copy(zenith).multiplyScalar(Math.cos(angle32)).addScaledVector(stationNorth, -Math.sin(angle32)).normalize();

      const fieldOfView = THREE.MathUtils.degToRad(camera instanceof THREE.PerspectiveCamera ? camera.fov : 45);
      const stageRatio = Math.min(1, stageHeight / Math.max(1, size.height));
      const effectiveVHalf = Math.atan(0.85 * stageRatio * Math.tan(fieldOfView / 2));
      const effectiveHHalf = Math.atan(0.85 * (size.width / Math.max(1, size.height)) * Math.tan(fieldOfView / 2));
      const halfAngle = Math.min(effectiveVHalf, effectiveHHalf);
      const distance = THREE.MathUtils.clamp(FRAMING_RADIUS / Math.sin(halfAngle), 3.2, 18);

      desiredCameraPosition.copy(aimTarget).addScaledVector(viewDirection, distance);

      controls.getPosition(cameraPosition);
      cameraPosition.lerp(desiredCameraPosition, 1 - Math.exp(-dt / 0.8));
      controls.getTarget(currentTarget);
      currentTarget.lerp(aimTarget, 1 - Math.exp(-dt / 0.8));
      controls.setLookAt(
        cameraPosition.x,
        cameraPosition.y,
        cameraPosition.z,
        currentTarget.x,
        currentTarget.y,
        currentTarget.z,
        false,
      );
    }
  });

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      enabled={controlsEnabled}
      minDistance={cameraView === "follow" ? 1.4 : 3.2}
      maxDistance={18}
      minPolarAngle={0.3}
      maxPolarAngle={2.8}
      smoothTime={1}
      draggingSmoothTime={0.25}
      mouseButtons={{
        left: CameraControlsImpl.ACTION.ROTATE,
        middle: CameraControlsImpl.ACTION.NONE,
        right: CameraControlsImpl.ACTION.NONE,
        wheel: CameraControlsImpl.ACTION.DOLLY,
      }}
      touches={{
        one: CameraControlsImpl.ACTION.TOUCH_ROTATE,
        two: CameraControlsImpl.ACTION.TOUCH_DOLLY,
        three: CameraControlsImpl.ACTION.NONE,
      }}
      onControlStart={() => {
        setCameraBusy(true);
        onCameraManual();
      }}
      onControlEnd={() => setCameraBusy(false)}
      onTransitionStart={() => setCameraBusy(true)}
      onRest={() => setCameraBusy(false)}
    />
  );
}

function LinkBeams({
  selectedLink,
  stationRef,
  stationDishRef,
  dishFeedRef,
  satelliteRef,
  rfEmitterRef,
  fsoEmitterRef,
  earthCenterRef,
  linkTruthRef,
  playing,
}: Pick<
  SceneProps,
  "selectedLink"
> & {
  stationRef: RefObject<THREE.Group | null>;
  stationDishRef: RefObject<THREE.Group | null>;
  dishFeedRef: RefObject<THREE.Group | null>;
  satelliteRef: RefObject<THREE.Group | null>;
  rfEmitterRef: RefObject<THREE.Group | null>;
  fsoEmitterRef: RefObject<THREE.Group | null>;
  earthCenterRef: RefObject<THREE.Group | null>;
  linkTruthRef: LinkTruthRef;
  playing: boolean;
}) {
  const rfBeamRef = useRef<THREE.Group>(null);
  const rfConeRef = useRef<THREE.Mesh>(null);
  const wavefrontRefs = useRef<Array<THREE.Mesh | null>>([]);
  const uplinkWavefrontRefs = useRef<Array<THREE.Mesh | null>>([]);
  const fsoBeamRef = useRef<THREE.Group>(null);
  const fsoCoreRef = useRef<THREE.Mesh>(null);
  const fsoGlowRef = useRef<THREE.Mesh>(null);
  const pulseRefs = useRef<Array<THREE.Mesh | null>>([]);
  const uplinkPulseRefs = useRef<Array<THREE.Mesh | null>>([]);
  const rfSource = useMemo(() => new THREE.Vector3(), []);
  const fsoSource = useMemo(() => new THREE.Vector3(), []);
  const rfMidpoint = useMemo(() => new THREE.Vector3(), []);
  const fsoMidpoint = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const satellitePosition = useMemo(() => new THREE.Vector3(), []);
  const stationPosition = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const rfDirection = useMemo(() => new THREE.Vector3(), []);
  const fsoDirection = useMemo(() => new THREE.Vector3(), []);
  const rfOrientation = useMemo(() => new THREE.Quaternion(), []);
  const fsoOrientation = useMemo(() => new THREE.Quaternion(), []);
  const stationWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const dishWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const dishLocalQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const realTimeRef = useRef(0);
  const transitionProgressRef = useRef(0.2);
  const previousSelectionRef = useRef(selectedLink);
  const fromRfOpacityRef = useRef(selectedLink === "RF" ? 1 : 0.45);
  const targetRfOpacityRef = useRef(selectedLink === "RF" ? 1 : 0.45);
  const rfWaveGeometry = useMemo(() => new THREE.TorusGeometry(1, 0.007, 4, 36), []);
  const rfWaveMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: theme.rf,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), []);
  const fsoPulseGeometry = useMemo(() => new THREE.CapsuleGeometry(0.008, 0.028, 3, 8), []);
  const fsoPulseMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: fsoSignalColor,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const rfConeGeometry = useMemo(() => {
    const geometry = new THREE.ConeGeometry(1, 1, 32, 1, true);
    geometry.translate(0, -0.5, 0);
    geometry.scale(1, -1, 1);
    return geometry;
  }, []);
  useEffect(() => () => {
    rfConeGeometry.dispose();
    rfWaveGeometry.dispose();
    rfWaveMaterial.dispose();
    fsoPulseGeometry.dispose();
    fsoPulseMaterial.dispose();
  }, [fsoPulseGeometry, fsoPulseMaterial, rfConeGeometry, rfWaveGeometry, rfWaveMaterial]);
  const rfWaveCount = 3;
  const fsoPulseCount = 3;

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (playing) realTimeRef.current += dt;
    if (previousSelectionRef.current !== selectedLink) {
      fromRfOpacityRef.current = targetRfOpacityRef.current;
      targetRfOpacityRef.current = selectedLink === "RF" ? 1 : 0.45;
      transitionProgressRef.current = 0;
      previousSelectionRef.current = selectedLink;
    }
    if (playing) transitionProgressRef.current = Math.min(1, transitionProgressRef.current + dt / 0.2);
    const eased = transitionProgressRef.current * transitionProgressRef.current *
      (3 - 2 * transitionProgressRef.current);
    const rfSelection = THREE.MathUtils.lerp(
      fromRfOpacityRef.current,
      targetRfOpacityRef.current,
      eased,
    );
    const fsoSelection = 1.45 - rfSelection;
    const rfIntensity = rfSelection;
    const fsoIntensity = Math.max(0.45, fsoSelection);
    const stationDish = stationDishRef.current;
    const dishFeed = dishFeedRef.current;
    const station = stationRef.current;
    const satellite = satelliteRef.current;
    const rfEmitter = rfEmitterRef.current;
    const fsoEmitter = fsoEmitterRef.current;
    const earthCenter = earthCenterRef.current;
    if (!stationDish || !dishFeed || !station || !satellite || !rfEmitter || !fsoEmitter || !earthCenter) {
      return;
    }

    satellite.getWorldPosition(satellitePosition);
    station.getWorldPosition(stationPosition);
    earthCenter.getWorldPosition(target);
    direction.subVectors(satellitePosition, stationPosition);
    const linkVisible = linkTruthRef.current.visible;
    const rfVisible = linkVisible && selectedLink === "RF";
    const fsoVisible = linkVisible && selectedLink === "FSO";
    const beamVisible = linkVisible;
    const visibility = linkVisible ? 1 : 0;
    if (import.meta.env.DEV) {
      console.assert(
        !linkTruthRef.current.visible || beamVisible,
        "Beam is hidden while the link is up.",
      );
    }
    station.getWorldQuaternion(stationWorldQuaternion);
    if (linkVisible) {
      direction.subVectors(satellitePosition, stationPosition).normalize();
      dishWorldQuaternion.setFromUnitVectors(UNIT_Y, direction);
      stationWorldQuaternion.invert();
      dishLocalQuaternion.copy(stationWorldQuaternion).multiply(dishWorldQuaternion);
    } else {
      dishLocalQuaternion.identity();
    }
    stationDish.quaternion.slerp(dishLocalQuaternion, 1 - Math.exp(-dt / 0.15));
    dishFeed.getWorldPosition(target);

    rfEmitter.lookAt(beamVisible ? target : earthCenter.getWorldPosition(target));
    fsoEmitter.lookAt(beamVisible ? target : earthCenter.getWorldPosition(target));
    rfEmitter.getWorldPosition(rfSource);
    fsoEmitter.getWorldPosition(fsoSource);
    rfDirection.subVectors(target, rfSource);
    const rfLength = rfDirection.length();
    rfDirection.normalize();
    rfMidpoint.addVectors(rfSource, target).multiplyScalar(0.5);
    fsoDirection.subVectors(target, fsoSource);
    const fsoLength = fsoDirection.length();
    fsoDirection.normalize();
    fsoMidpoint.addVectors(fsoSource, target).multiplyScalar(0.5);
    if (rfBeamRef.current && rfConeRef.current) {
      rfBeamRef.current.visible = rfVisible;
      rfBeamRef.current.position.copy(rfMidpoint);
      rfOrientation.setFromUnitVectors(UNIT_Y, rfDirection);
      rfBeamRef.current.quaternion.copy(rfOrientation);
      rfConeRef.current.position.y = -rfLength / 2;
      rfConeRef.current.scale.set(0.35, rfLength, 0.35);
      const coneMaterial = rfConeRef.current.material;
      if (coneMaterial instanceof THREE.MeshBasicMaterial) coneMaterial.opacity = 0.3 * visibility * rfIntensity;
      for (let index = 0; index < rfWaveCount; index += 1) {
        const wave = wavefrontRefs.current[index];
        if (!wave) continue;
        const phase = (realTimeRef.current * 1.2 / rfLength + index / rfWaveCount) % 1;
        const radius = Math.max(0.015, phase * 0.35);
        wave.position.set(0, rfLength * (phase - 0.5), 0);
        wave.scale.set(radius, radius, 1);
      }
      for (let index = 0; index < rfWaveCount; index += 1) {
        const wave = uplinkWavefrontRefs.current[index];
        if (!wave) continue;
        const phase = (realTimeRef.current * 1.2 / rfLength + index / rfWaveCount + 0.5) % 1;
        const radius = Math.max(0.015, phase * 0.35);
        wave.position.set(0, rfLength * (0.5 - phase), 0);
        wave.scale.set(radius, radius, 1);
      }
      const waveMaterial = wavefrontRefs.current[0]?.material;
      if (waveMaterial instanceof THREE.MeshBasicMaterial) {
        waveMaterial.opacity = visibility * rfIntensity;
      }
    }
    if (fsoBeamRef.current && fsoCoreRef.current && fsoGlowRef.current) {
      fsoBeamRef.current.visible = fsoVisible;
      fsoBeamRef.current.position.copy(fsoMidpoint);
      fsoOrientation.setFromUnitVectors(UNIT_Y, fsoDirection);
      fsoBeamRef.current.quaternion.copy(fsoOrientation);
      fsoCoreRef.current.position.y = 0;
      fsoGlowRef.current.position.y = 0;
      fsoCoreRef.current.scale.y = fsoLength;
      fsoGlowRef.current.scale.y = fsoLength;
      const coreMaterial = fsoCoreRef.current.material;
      if (coreMaterial instanceof THREE.MeshBasicMaterial) coreMaterial.opacity = visibility * fsoIntensity;
      const glowMaterial = fsoGlowRef.current.material;
      if (glowMaterial instanceof THREE.MeshBasicMaterial) glowMaterial.opacity = 0.25 * visibility * fsoIntensity;
      for (let index = 0; index < fsoPulseCount; index += 1) {
        const pulse = pulseRefs.current[index];
        if (!pulse) continue;
        const phase = (realTimeRef.current * 1.8 / fsoLength + index / fsoPulseCount) % 1;
        pulse.position.y = fsoLength * (phase - 0.5);
      }
      for (let index = 0; index < fsoPulseCount; index += 1) {
        const pulse = uplinkPulseRefs.current[index];
        if (!pulse) continue;
        const phase = (realTimeRef.current * 1.8 / fsoLength + index / fsoPulseCount + 0.5) % 1;
        pulse.position.y = fsoLength * (0.5 - phase);
      }
      const pulseMaterial = pulseRefs.current[0]?.material;
      if (pulseMaterial instanceof THREE.MeshBasicMaterial) {
        pulseMaterial.opacity = visibility * fsoIntensity;
      }
    }

  }, -1);

  return (
    <>
      <group ref={rfBeamRef}>
        <mesh ref={rfConeRef} renderOrder={10}>
          <primitive object={rfConeGeometry} attach="geometry" />
          <meshBasicMaterial
            color={theme.rf}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthTest
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
        {Array.from({ length: rfWaveCount }, (_, index) => (
          <mesh
            key={index}
            ref={(mesh) => {
              wavefrontRefs.current[index] = mesh;
            }}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <primitive object={rfWaveGeometry} attach="geometry" />
            <primitive object={rfWaveMaterial} attach="material" />
          </mesh>
        ))}
        {Array.from({ length: rfWaveCount }, (_, index) => (
          <mesh key={`up-${index}`} ref={(mesh) => { uplinkWavefrontRefs.current[index] = mesh; }} rotation={[Math.PI / 2, 0, 0]}>
            <primitive object={rfWaveGeometry} attach="geometry" />
            <primitive object={rfWaveMaterial} attach="material" />
          </mesh>
        ))}
      </group>

      <group ref={fsoBeamRef}>
        <mesh ref={fsoGlowRef} renderOrder={11}>
          <cylinderGeometry args={[0.035, 0.035, 1, 12, 1, true]} />
          <meshBasicMaterial
            color={fsoSignalColor}
            transparent
            opacity={0}
            depthTest
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={fsoCoreRef} renderOrder={12}>
          <cylinderGeometry args={[0.012, 0.012, 1, 8, 1, true]} />
          <meshBasicMaterial
            color={fsoSignalColor}
            transparent
            opacity={0}
            depthTest
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        {Array.from({ length: fsoPulseCount }, (_, index) => (
          <mesh
            key={index}
            ref={(mesh) => {
              pulseRefs.current[index] = mesh;
            }}
          >
            <primitive object={fsoPulseGeometry} attach="geometry" />
            <primitive object={fsoPulseMaterial} attach="material" />
          </mesh>
        ))}
        {Array.from({ length: fsoPulseCount }, (_, index) => (
          <mesh key={`up-${index}`} ref={(mesh) => { uplinkPulseRefs.current[index] = mesh; }}>
            <primitive object={fsoPulseGeometry} attach="geometry" />
            <primitive object={fsoPulseMaterial} attach="material" />
          </mesh>
        ))}
      </group>
    </>
  );
}

const MemoizedLinkBeams = memo(LinkBeams);

function useSimClock(
  clockRef: SimClockRef,
  orbitTimeRef: RefObject<number>,
  autoSkip: boolean,
  passSamples: readonly ElevationSample[],
  onAutoSkip: (seconds: number) => void,
) {
  const belowHorizonElapsedRef = useRef(0);
  const skipArmedRef = useRef(true);

  const passStep = passSamples.length > 1 ? passSamples[1].time - passSamples[0].time : 30;
  const isPassVisibleAt = (time: number) => {
    const wrappedTime = ((time % SIMULATION_DAY_S) + SIMULATION_DAY_S) % SIMULATION_DAY_S;
    const index = Math.min(passSamples.length - 1, Math.floor(wrappedTime / passStep));
    const start = passSamples[index]?.elevation ?? -90;
    const end = passSamples[Math.min(index + 1, passSamples.length - 1)]?.elevation ?? start;
    const fraction = (wrappedTime - index * passStep) / passStep;
    return THREE.MathUtils.lerp(start, end, fraction) >= MASK_ELEVATION_DEG;
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (!clockRef.current.playing) return;
    let remaining = dt * clockRef.current.speed;
    while (remaining > 0) {
      const simulatedStep = Math.min(remaining, 1);
      orbitTimeRef.current += simulatedStep;
      clockRef.current.t =
        (clockRef.current.t + simulatedStep) % SIMULATION_DAY_S;
      remaining -= simulatedStep;
    }

    const isVisible = isPassVisibleAt(clockRef.current.t);
    if (!autoSkip) {
      belowHorizonElapsedRef.current = 0;
      skipArmedRef.current = true;
    } else if (isVisible) {
      belowHorizonElapsedRef.current = 0;
      skipArmedRef.current = true;
    } else if (skipArmedRef.current) {
      belowHorizonElapsedRef.current += dt;
      if (belowHorizonElapsedRef.current >= 3) {
        const nextPass = getNextPassTime(clockRef.current.t, passSamples);
        if (nextPass !== null) {
          const lead = 20;
          if (nextPass - clockRef.current.t > lead) {
            const destination = nextPass - lead;
            const skipped = destination - clockRef.current.t;
            if (skipped > 0) {
              clockRef.current.t = destination % SIMULATION_DAY_S;
              orbitTimeRef.current += skipped;
              onAutoSkip(skipped);
            }
          }
        }
        belowHorizonElapsedRef.current = 0;
        skipArmedRef.current = false;
      }
    }
  }, -3);
}

function ConstellationDots({
  orbitTimeRef,
  visible,
  linkTruthRef,
}: {
  orbitTimeRef: RefObject<number>;
  visible: boolean;
  linkTruthRef: LinkTruthRef;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => new Float32Array(WALKER_TOTAL_SATS * 3), []);
  const positionScratch = useMemo(() => new THREE.Vector3(), []);
  const geometry = useMemo(() => {
    const value = new THREE.BufferGeometry();
    value.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return value;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    if (!visible || !pointsRef.current) return;
    const values = geometry.getAttribute("position").array as Float32Array;
    for (let id = 0; id < WALKER_TOTAL_SATS; id += 1) {
      const plane = Math.floor(id / WALKER_SATS_PER_PLANE);
      const satellite = id % WALKER_SATS_PER_PLANE;
      const anomaly =
        (2 * Math.PI * orbitTimeRef.current) / ORBIT_PERIOD_S +
        (satellite * 2 * Math.PI) / WALKER_SATS_PER_PLANE +
        (plane * 2 * Math.PI) / WALKER_TOTAL_SATS;
      setOrbitPosition(positionScratch, plane, anomaly, DISPLAY_ORBIT_RADIUS);
      const offset = id * 3;
      if (id + 1 === linkTruthRef.current.satelliteId) {
        values[offset] = 0;
        values[offset + 1] = 0;
        values[offset + 2] = 0;
      } else {
        values[offset] = positionScratch.x;
        values[offset + 1] = positionScratch.y;
        values[offset + 2] = positionScratch.z;
      }
    }

    (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }, -2);
  return <points ref={pointsRef} geometry={geometry}><pointsMaterial color="#BFD4FF" size={2} sizeAttenuation={false} transparent opacity={0.55} depthTest depthWrite={false} /></points>;
}

const MemoizedConstellationDots = memo(ConstellationDots);

function SceneContents({
  selectedLink,
  cloudAttenuationDb,
  cameraView,
  htmlPortal,
  clockRef,
  orbitTimeRef,
  passSamples,
  autoSkip,
  onAutoSkip,
  playing,
  controlsEnabled,
  stageHeight,
  onLinkTruth,
  constellationMode,
  showConstellation = true,
  onCameraManual,
}: SceneProps) {
  const stationRef = useRef<THREE.Group>(null);
  const stationDishRef = useRef<THREE.Group>(null);
  const dishFeedRef = useRef<THREE.Group>(null);
  const rfEmitterRef = useRef<THREE.Group>(null);
  const fsoEmitterRef = useRef<THREE.Group>(null);
  const satelliteRef = useRef<THREE.Group>(null);
  const earthCenterRef = useRef<THREE.Group>(null);
  const earthGroupRef = useRef<THREE.Group>(null);
  const linkTruthRef = useRef<LinkTruth>({
    visible: false,
    elevationDeg: -90,
    slantRangeKm: 0,
    satelliteId: 1,
    inViewCount: 0,
  });
  useSimClock(clockRef, orbitTimeRef, autoSkip, passSamples, onAutoSkip);
  useFrame(() => {
    if (earthGroupRef.current) {
      earthGroupRef.current.rotation.y = EARTH_ROTATION_RAD_S * orbitTimeRef.current;
    }
  }, -3);

  return (
    <>
      <color attach="background" args={[theme.scene.background]} />
      <ambientLight intensity={0.12} />
      <hemisphereLight args={[theme.scene.dayLight, theme.scene.background, 0.18]} />
      <directionalLight position={[4, 3, 8]} intensity={3.5} color={theme.scene.dayLight} />
      <Stars radius={60} depth={35} count={450} factor={0.8} saturation={0} fade speed={playing ? 0.02 : 0} />
      <group
        ref={earthCenterRef}
        position={[0, -1.7, 0]}
        rotation={[0, 0, THREE.MathUtils.degToRad(23.4)]}
      >
        <group ref={earthGroupRef}>
          <Suspense fallback={null}>
            <Earth
              stationRef={stationRef}
              stationDishRef={stationDishRef}
              dishFeedRef={dishFeedRef}
              earthCenterRef={earthCenterRef}
              cloudAttenuationDb={cloudAttenuationDb}
              htmlPortal={htmlPortal}
            />
          </Suspense>
        </group>
        <MemoizedConstellationDots
          orbitTimeRef={orbitTimeRef}
          visible={constellationMode && showConstellation}
          linkTruthRef={linkTruthRef}
        />
        <MemoizedSatelliteModel
          selectedLink={selectedLink}
          stationRef={stationRef}
          earthCenterRef={earthCenterRef}
          satelliteRef={satelliteRef}
          rfEmitterRef={rfEmitterRef}
          fsoEmitterRef={fsoEmitterRef}
          htmlPortal={htmlPortal}
          orbitTimeRef={orbitTimeRef}
          linkTruthRef={linkTruthRef}
          onLinkTruth={onLinkTruth}
          constellationMode={constellationMode}
        />
      </group>
      <MemoizedLinkBeams
        selectedLink={selectedLink}
        stationRef={stationRef}
        stationDishRef={stationDishRef}
        dishFeedRef={dishFeedRef}
        satelliteRef={satelliteRef}
        rfEmitterRef={rfEmitterRef}
        fsoEmitterRef={fsoEmitterRef}
        earthCenterRef={earthCenterRef}
        linkTruthRef={linkTruthRef}
        playing={playing}
      />
      <CameraRig
        cameraView={cameraView}
        stationRef={stationRef}
        satelliteRef={satelliteRef}
        earthCenterRef={earthCenterRef}
        controlsEnabled={controlsEnabled}
        stageHeight={stageHeight}
        onCameraManual={onCameraManual}
      />
    </>
  );
}

export default function SatelliteScene({
  selectedLink,
  cloudAttenuationDb,
  cameraView,
  htmlPortal,
  clockRef,
  orbitTimeRef,
  passSamples,
  autoSkip,
  onAutoSkip,
  playing,
  controlsEnabled,
  stageHeight,
  onLinkTruth,
  constellationMode,
  showConstellation = true,
  onCameraManual,
}: SceneProps) {
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  return (
    <Canvas
      aria-label="Interactive 3D illustration of Earth, a satellite, and a ground station"
      camera={{ position: [0, -1.58, 6.5], fov: 45 }}
      dpr={[1, 1.5]}
      frameloop={pageVisible ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <SceneContents
        selectedLink={selectedLink}
        cloudAttenuationDb={cloudAttenuationDb}
        cameraView={cameraView}
        htmlPortal={htmlPortal}
        clockRef={clockRef}
        orbitTimeRef={orbitTimeRef}
        passSamples={passSamples}
        autoSkip={autoSkip}
        onAutoSkip={onAutoSkip}
        playing={playing}
        controlsEnabled={controlsEnabled}
        stageHeight={stageHeight}
        onLinkTruth={onLinkTruth}
        constellationMode={constellationMode}
        showConstellation={showConstellation}
        onCameraManual={onCameraManual}
      />
    </Canvas>
  );
}
