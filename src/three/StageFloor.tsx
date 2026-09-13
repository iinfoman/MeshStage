import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Reflective stage disc plus a radial gradient shadow.
 *
 * A real soft-shadow pass (ContactShadows / accumulative shadows) costs more
 * frames than it is worth on a phone, so the contact darkening is baked into a
 * generated canvas texture and drawn as one transparent plane.
 */
export function StageFloor({ accent = '#22d3ee' }: { accent?: string }) {
  const shadowTexture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0.62)');
      gradient.addColorStop(0.45, 'rgba(0,0,0,0.28)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <planeGeometry args={[3.2, 3.2]} />
        <meshBasicMaterial map={shadowTexture} transparent depthWrite={false} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[1.45, 64]} />
        <meshStandardMaterial color="#0d0d13" roughness={0.32} metalness={0.72} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[1.4, 1.45, 64]} />
        <meshBasicMaterial color={accent} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}
