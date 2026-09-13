import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createCharacterRig, type CharacterAppearance } from './characterFactory';
import type { PipelinePhase } from '../types/studio';

/**
 * Stage-2 viewport: the mesh materialising phase by phase.
 *
 * `mesh` shows point-cloud → wireframe topology, `rig` reveals the skeleton
 * overlay, `blendshape` pulses the head where the viseme targets bind. It reads
 * the same rig factory as stage 3, so what the user watches assemble is
 * literally the asset they get.
 */
export function RiggingPreview({
  seed,
  progress,
  phase,
  appearance,
}: {
  seed: number;
  progress: number;
  phase: PipelinePhase;
  appearance?: CharacterAppearance;
}) {
  const rig = useMemo(() => createCharacterRig(seed, appearance), [seed, appearance]);
  const groupRef = useRef<THREE.Group>(null);
  const scanRef = useRef<THREE.Mesh>(null);

  // Swap every surface for an additive wireframe — this is a diagnostic view,
  // not the beauty render.
  const { wireframes, skeletonHelper } = useMemo(() => {
    // Normal blending, not additive: overlapping wireframe shells stack their
    // alpha and an additive pass blows the whole mesh out to flat white.
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#3ee6ff'),
      wireframe: true,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });

    const meshes: THREE.Mesh[] = [];
    rig.root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh;
        mesh.material = wireMaterial;
        mesh.castShadow = false;
        meshes.push(mesh);
      }
    });

    const helper = new THREE.SkeletonHelper(rig.skinned);
    const helperMaterial = helper.material as THREE.LineBasicMaterial;
    helperMaterial.color = new THREE.Color('#ff9ae8');
    helperMaterial.transparent = true;
    helperMaterial.depthTest = false;
    helperMaterial.linewidth = 2;

    return { wireframes: meshes, material: wireMaterial, skeletonHelper: helper };
  }, [rig]);

  useEffect(() => () => rig.dispose(), [rig]);

  useFrame((_, delta) => {
    const t = performance.now() / 1000;

    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.55;
    }

    // Mesh fades in across the first phase, skeleton across the second.
    const meshReveal = THREE.MathUtils.clamp(progress / 0.3, 0, 1);
    for (const mesh of wireframes) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.05 + meshReveal * 0.17;
    }

    skeletonHelper.visible = phase !== 'mesh';
    const helperMaterial = skeletonHelper.material as THREE.LineBasicMaterial;
    helperMaterial.opacity = THREE.MathUtils.clamp((progress - 0.42) / 0.2, 0, 1) * 0.95;

    // Blendshape phase: flex the jaw so the viseme binding is visible.
    if (phase === 'blendshape') {
      const pulse = (Math.sin(t * 7) * 0.5 + 0.5) * 0.5;
      rig.jaw.rotation.x = pulse * 0.3;
      const morphs = rig.mouth.morphTargetInfluences;
      if (morphs) {
        const index = Math.floor(t * 6) % morphs.length;
        for (let i = 0; i < morphs.length; i += 1) {
          morphs[i] = i === index ? pulse : morphs[i] * 0.85;
        }
      }
    }

    // Scan plane sweeping bottom-to-top, tied to overall progress.
    if (scanRef.current) {
      scanRef.current.position.y = 0.1 + progress * 1.75;
      const material = scanRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.18 + Math.sin(t * 5) * 0.08;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={rig.root} />
      <primitive object={skeletonHelper} />

      <mesh ref={scanRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.0, 0.52, 64]} />
        <meshBasicMaterial
          color="#38e0f5"
          transparent
          opacity={0.22}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Reference grid — reads as a scanning volume rather than empty space. */}
      <gridHelper args={[3, 12, '#1d3f4a', '#14212a']} position={[0, 0, 0]} />
    </group>
  );
}
