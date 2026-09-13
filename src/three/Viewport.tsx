import { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { StudioLighting } from './Lighting';
import { FitCamera } from './FitCamera';
import { useStudio } from '../state/StudioContext';
import { cn } from '../lib/utils';

/** Publishes the WebGL canvas so the video exporter can capture its stream. */
function CanvasRegistrar() {
  const gl = useThree((three) => three.gl);
  const { scene } = useStudio();

  useEffect(() => {
    scene.current.canvas = gl.domElement;
    return () => {
      if (scene.current.canvas === gl.domElement) scene.current.canvas = null;
    };
  }, [gl, scene]);

  return null;
}

/**
 * Throttles the renderer when the tab is hidden and caps DPR on high-density
 * phone screens. A 3x DPR render of a full-bleed viewport is the fastest way
 * to thermally throttle an iPhone; 2x is visually indistinguishable here.
 */
function MobilePerformanceGuard() {
  const { gl, invalidate } = useThree();

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') invalidate();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // WebGL contexts are routinely evicted on iOS when memory is tight.
    const canvas = gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      console.warn('[MeshStage] WebGL context lost — waiting for restore.');
    };
    canvas.addEventListener('webglcontextlost', handleLost);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      canvas.removeEventListener('webglcontextlost', handleLost);
    };
  }, [gl, invalidate]);

  return null;
}

export interface ViewportProps {
  children: ReactNode;
  className?: string;
  /** Disables orbit on stages where the user should not be posing the camera. */
  interactive?: boolean;
  autoRotate?: boolean;
  accent?: string;
  cameraPosition?: [number, number, number];
  target?: [number, number, number];
  /** Transparent clear colour, for the alpha-channel video export. */
  transparent?: boolean;
  overlay?: ReactNode;
  /** Auto-frames the subject once it mounts; omit to keep the manual camera. */
  fit?: {
    focus?: number;
    padding?: number;
    azimuth?: number;
    elevation?: number;
    dependency?: unknown;
  };
}

export function Viewport({
  children,
  className,
  interactive = true,
  autoRotate = false,
  accent = '#22d3ee',
  cameraPosition = [0, 1.5, 3.1],
  target = [0, 1.25, 0],
  transparent = false,
  overlay,
  fit,
}: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    // `relative` is load-bearing — the overlay layer positions against it, and
    // R3F sizes the canvas from it — so it is applied last and callers should
    // size this element with flex/grid rather than their own position utility.
    <div ref={containerRef} className={cn('isolate overflow-hidden', className, 'relative')}>
      <Canvas
        // `preserveDrawingBuffer` is what lets MediaRecorder and screenshot
        // capture read back a non-blank frame.
        gl={{
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        }}
        dpr={[1, 2]}
        shadows="soft"
        camera={{ position: cameraPosition, fov: 34, near: 0.1, far: 60 }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.08;
          gl.setClearColor(0x000000, 0);
          scene.fog = transparent ? null : new THREE.Fog('#0a0a0c', 6, 14);
        }}
      >
        <CanvasRegistrar />
        <MobilePerformanceGuard />
        <StudioLighting accent={accent} />
        <Suspense fallback={null}>{children}</Suspense>
        {/* Rendered after the subject so its bounding box is already resolved. */}
        {fit && <FitCamera {...fit} />}
        <OrbitControls
          makeDefault
          enabled={interactive}
          enablePan={false}
          enableZoom={interactive}
          autoRotate={autoRotate}
          autoRotateSpeed={0.6}
          minDistance={1.8}
          maxDistance={5.5}
          minPolarAngle={Math.PI * 0.12}
          maxPolarAngle={Math.PI * 0.56}
          target={target}
          // One-finger orbit, two-finger dolly — no drag-to-pan, which on a
          // phone is almost always an accidental scroll.
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>

      {overlay}
    </div>
  );
}
