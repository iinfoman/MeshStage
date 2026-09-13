import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Frames the camera to the character's actual bounding box.
 *
 * Hand-tuned camera positions break the moment proportions change — and they
 * change per seed here. Measuring the rig instead means every character is
 * composed the same way regardless of how tall the generator made it, and the
 * framing holds across phone aspect ratios from 9:20 to 3:4.
 */
export function FitCamera({
  /** Object name to measure; falls back to the whole scene. */
  objectName = 'MeshStage_Character',
  /** >1 leaves headroom around the subject. */
  padding = 1.18,
  /** 0 frames the feet, 1 the top of the head. */
  focus = 0.62,
  /** Orbit angle in radians, measured from +Z. */
  azimuth = 0,
  /** Camera height above the focus point, as a fraction of the fit distance. */
  elevation = 0,
  /** Re-runs the fit when this changes (e.g. a new character seed). */
  dependency,
}: {
  objectName?: string;
  padding?: number;
  focus?: number;
  azimuth?: number;
  elevation?: number;
  dependency?: unknown;
}) {
  const { camera, scene, controls, size } = useThree();
  const pending = useRef(true);

  // Re-arm whenever the subject or the viewport changes shape.
  useEffect(() => {
    pending.current = true;
  }, [objectName, padding, focus, azimuth, elevation, dependency, size]);

  /**
   * The fit runs on a frame tick rather than in an effect. Mount-order is not
   * something we can rely on here: `OrbitControls` publishes itself as the
   * default controls during its own mount, so an effect in this component may
   * run before the controls exist — and the controls would then overwrite our
   * camera with their own target on their first update. By the first rendered
   * frame everything is registered.
   */
  useFrame(() => {
    if (!pending.current) return;

    const target = scene.getObjectByName(objectName) ?? scene;
    const box = new THREE.Box3();

    // Skinned geometry reports its *bind pose* bounds, which is what we want:
    // framing shouldn't jitter as the idle animation moves the character.
    target.updateMatrixWorld(true);

    // Measure only what is drawn. `Box3.setFromObject` includes hidden meshes,
    // so a head-only build would still be framed around the invisible body it
    // was carved out of, putting the head off-screen.
    const scratch = new THREE.Box3();
    target.traverseVisible((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      scratch.setFromBufferAttribute(
        mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
      );
      scratch.applyMatrix4(mesh.matrixWorld);
      box.union(scratch);
    });

    // The subject may not have mounted yet — stay armed and retry next frame.
    if (box.isEmpty()) return;

    const dimensions = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const perspective = camera as THREE.PerspectiveCamera;

    const lookAt = new THREE.Vector3(
      center.x,
      THREE.MathUtils.lerp(box.min.y, box.max.y, focus),
      center.z,
    );

    // Fit the taller constraint: vertical FOV, or horizontal on a wide screen.
    const vFov = THREE.MathUtils.degToRad(perspective.fov);
    const aspect = size.width / Math.max(1, size.height);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const distanceForHeight = dimensions.y / 2 / Math.tan(vFov / 2);
    const distanceForWidth = Math.max(dimensions.x, dimensions.z) / 2 / Math.tan(hFov / 2);
    const distance = Math.max(distanceForHeight, distanceForWidth) * padding;

    perspective.position.set(
      lookAt.x + Math.sin(azimuth) * distance,
      lookAt.y + dimensions.y * 0.06 + distance * elevation,
      lookAt.z + Math.cos(azimuth) * distance,
    );
    perspective.near = Math.max(0.05, distance * 0.02);
    perspective.far = distance * 12;
    perspective.lookAt(lookAt);
    perspective.updateProjectionMatrix();

    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (orbit?.target) {
      orbit.target.copy(lookAt);
      orbit.update?.();
    }

    pending.current = false;
  });

  return null;
}
