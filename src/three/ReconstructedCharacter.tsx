import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { useStudio } from '../state/StudioContext';
import { VISEMES } from '../lib/visemes';
import type { MotionPreset } from '../types/studio';

/**
 * Displays a mesh reconstructed from the user's image by a provider.
 *
 * This is the real image-to-3D path: the geometry is whatever the service
 * produced from the upload, not a procedural stand-in. What arrives is usually
 * *only* geometry — image-to-3D models output a surface, not a skeleton — so
 * lip-sync is only possible when the provider also ran a rigging pass and left
 * blendshapes behind. This component drives them when they exist and says
 * nothing when they don't, rather than pretending.
 */
export function ReconstructedCharacter({
  url,
  motion,
  onStatus,
}: {
  url: string;
  motion: MotionPreset;
  onStatus?: (status: { loading: boolean; error: string | null; rigged: boolean }) => void;
}) {
  const { lipSync, scene } = useStudio();
  const [model, setModel] = useState<THREE.Group | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  /** Morph targets whose names look like visemes, if the provider left any. */
  const visemeTargets = useRef<Array<{ mesh: THREE.Mesh; index: number; viseme: string }>>([]);

  const loader = useMemo(() => {
    const gltf = new GLTFLoader();
    // Providers commonly return Draco-compressed geometry; the decoder is
    // fetched only when a compressed file actually turns up.
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    gltf.setDRACOLoader(draco);
    return gltf;
  }, []);

  useEffect(() => {
    let cancelled = false;
    onStatus?.({ loading: true, error: null, rigged: false });

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;

        const root = gltf.scene;
        root.name = 'MeshStage_Character';

        // Normalise scale and centring: providers return wildly different
        // units, and a mesh 400x too large reads as an empty viewport.
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const longest = Math.max(size.x, size.y, size.z) || 1;
        root.scale.setScalar(1.6 / longest);

        root.updateMatrixWorld(true);
        const centred = new THREE.Box3().setFromObject(root);
        const centre = centred.getCenter(new THREE.Vector3());
        root.position.sub(new THREE.Vector3(centre.x, centred.min.y, centre.z));

        // Find anything the provider left that we can drive as a viseme.
        const found: Array<{ mesh: THREE.Mesh; index: number; viseme: string }> = [];
        root.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          const names = mesh.morphTargetDictionary;
          if (!names) return;
          for (const [name, index] of Object.entries(names)) {
            const match = VISEMES.find(
              (viseme) => name.toLowerCase() === `viseme_${viseme}`.toLowerCase(),
            );
            if (match) found.push({ mesh, index, viseme: match });
          }
        });

        visemeTargets.current = found;
        setModel(root);
        onStatus?.({ loading: false, error: null, rigged: found.length > 0 });
      },
      undefined,
      (error) => {
        if (cancelled) return;
        onStatus?.({
          loading: false,
          rigged: false,
          error:
            error instanceof Error
              ? `Could not load the reconstructed mesh: ${error.message}`
              : 'Could not load the reconstructed mesh.',
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url, loader, onStatus]);

  // Publish for the exporters, which work off whatever is on screen.
  useEffect(() => {
    if (!model) return;
    scene.current.exportRoot = model;
    return () => {
      if (scene.current.exportRoot === model) scene.current.exportRoot = null;
    };
  }, [model, scene]);

  // Release GPU memory when the character is discarded.
  useEffect(
    () => () => {
      model?.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
    },
    [model],
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    const t = performance.now() / 1000;
    const { weight, viseme } = lipSync.clock.sample(performance.now());

    // Without a skeleton there are no limbs to move, so the presets act on the
    // whole object — which is what a head or a bust wants anyway.
    switch (motion) {
      case 'standing':
        group.position.y = Math.sin(t * 1.4) * 0.012;
        group.rotation.y = Math.sin(t * 0.4) * 0.16;
        break;
      case 'talking':
        group.position.y = Math.sin(t * 2.2) * 0.016 * (lipSync.clock.playing ? 1 : 0.3);
        group.rotation.y = Math.sin(t * 1.1) * 0.1;
        group.rotation.x = -weight * 0.06;
        break;
      case 'floating':
        group.position.y = 0.06 + Math.sin(t * 0.9) * 0.05;
        group.rotation.y = Math.sin(t * 0.3) * 0.3;
        group.rotation.z = Math.sin(t * 0.7) * 0.03;
        break;
    }

    for (const target of visemeTargets.current) {
      const influences = target.mesh.morphTargetInfluences;
      if (!influences) continue;
      const goal = target.viseme === viseme ? weight : 0;
      influences[target.index] += (goal - influences[target.index]) * 0.35;
    }
  });

  if (!model) return null;
  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  );
}
