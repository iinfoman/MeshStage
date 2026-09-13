import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createCharacterRig } from './characterFactory';
import { useStudio } from '../state/StudioContext';
import { VISEMES } from '../lib/visemes';
import type { MotionPreset } from '../types/studio';

/** How quickly morph influences chase their target (per second). */
const VISEME_ATTACK = 22;
const VISEME_RELEASE = 13;

interface CharacterProps {
  seed: number;
  motion: MotionPreset;
}

export function Character({ seed, motion }: CharacterProps) {
  const { lipSync, scene } = useStudio();

  // Rebuilt only when the seed changes, i.e. when a genuinely new character
  // is generated — motion preset changes never touch geometry.
  const rig = useMemo(() => createCharacterRig(seed), [seed]);

  const influences = useRef<Float32Array>(new Float32Array(VISEMES.length));
  const blinkRef = useRef({ next: 2, closing: 0 });

  useEffect(() => {
    scene.current.rig = rig;
    return () => {
      if (scene.current.rig === rig) scene.current.rig = null;
      rig.dispose();
    };
  }, [rig, scene]);

  useFrame((_, rawDelta) => {
    // Clamp delta so a backgrounded tab doesn't snap the pose on resume.
    const delta = Math.min(rawDelta, 0.05);
    const time = performance.now();
    const t = time / 1000;

    const { viseme, weight } = lipSync.clock.sample(time);
    const activeIndex = VISEMES.indexOf(viseme);

    // ---- Blendshapes -------------------------------------------------------
    const target = influences.current;
    for (let i = 0; i < VISEMES.length; i += 1) {
      const goal = i === activeIndex ? weight : 0;
      const rate = goal > target[i] ? VISEME_ATTACK : VISEME_RELEASE;
      target[i] += (goal - target[i]) * Math.min(1, rate * delta);
    }

    const morphs = rig.mouth.morphTargetInfluences;
    if (morphs) {
      for (let i = 0; i < morphs.length; i += 1) morphs[i] = target[i];
    }

    // The jaw bone follows the open vowels; the mouth cavity scales with it so
    // the cavity never clips through the chin.
    const openness = target[VISEMES.indexOf('aa')] + target[VISEMES.indexOf('O')] * 0.8;
    rig.jaw.rotation.x = THREE.MathUtils.lerp(rig.jaw.rotation.x, openness * 0.26, 0.4);
    rig.mouth.scale.setScalar(1 + weight * 0.25);

    // ---- Idle / motion presets --------------------------------------------
    const { bones, headPivot, root } = rig;
    const speaking = lipSync.clock.playing;
    const breathe = Math.sin(t * 1.6) * 0.5 + 0.5;

    // Breathing rides on every preset.
    bones.chest.scale.setScalar(1 + breathe * 0.018);
    bones.spine.rotation.x = Math.sin(t * 1.6) * 0.012;

    // Arms hang at the sides in the rest pose, so gestures are offsets from
    // that — `rotation.x` swings forward, `rotation.z` opens outward.
    const restZ = 0.14;

    switch (motion) {
      case 'standing': {
        const shift = Math.sin(t * 0.75);
        root.position.y = THREE.MathUtils.lerp(root.position.y, 0, 0.1);
        bones.hips.position.x = shift * 0.022;
        bones.hips.rotation.z = -shift * 0.045;
        bones.chest.rotation.z = shift * 0.03;
        bones.shoulderL.rotation.z = -restZ - Math.sin(t * 0.9) * 0.05;
        bones.shoulderR.rotation.z = restZ + Math.sin(t * 0.9) * 0.05;
        bones.shoulderL.rotation.x = Math.sin(t * 0.7) * 0.07;
        bones.shoulderR.rotation.x = Math.sin(t * 0.7 + 0.5) * 0.07;
        bones.elbowL.rotation.x = 0.18;
        bones.elbowR.rotation.x = 0.18;
        headPivot.rotation.y = Math.sin(t * 0.42) * 0.18;
        headPivot.rotation.x = Math.sin(t * 0.6) * 0.04;
        break;
      }

      case 'talking': {
        // Gestures scale up while the character is actually speaking.
        const energy = speaking ? 1 : 0.3;
        root.position.y = THREE.MathUtils.lerp(root.position.y, 0, 0.1);
        bones.hips.position.x = Math.sin(t * 1.1) * 0.012 * energy;
        bones.chest.rotation.y = Math.sin(t * 1.35) * 0.07 * energy;
        bones.shoulderL.rotation.z = -restZ - (0.1 + Math.sin(t * 2.1) * 0.16) * energy;
        bones.shoulderR.rotation.z = restZ + (0.1 + Math.sin(t * 2.1 + 1.1) * 0.16) * energy;
        bones.shoulderL.rotation.x = -(0.35 + Math.sin(t * 2.4) * 0.3) * energy;
        bones.shoulderR.rotation.x = -(0.35 + Math.sin(t * 2.4 + 1.4) * 0.3) * energy;
        bones.elbowL.rotation.x = -(0.55 + Math.sin(t * 2.9) * 0.35) * energy;
        bones.elbowR.rotation.x = -(0.55 + Math.sin(t * 2.9 + 1.0) * 0.35) * energy;
        headPivot.rotation.y = Math.sin(t * 1.25) * 0.12 * energy;
        // A small nod on each stressed syllable sells the sync.
        headPivot.rotation.x = -weight * 0.09 + Math.sin(t * 2.4) * 0.03 * energy;
        break;
      }

      case 'floating': {
        root.position.y = 0.16 + Math.sin(t * 0.9) * 0.07;
        root.rotation.y = Math.sin(t * 0.28) * 0.24;
        bones.hips.rotation.x = Math.sin(t * 0.7) * 0.08;
        bones.shoulderL.rotation.z = -restZ - 0.42 + Math.sin(t * 0.8) * 0.1;
        bones.shoulderR.rotation.z = restZ + 0.42 - Math.sin(t * 0.8 + 0.5) * 0.1;
        bones.shoulderL.rotation.x = -0.22 + Math.sin(t * 0.65) * 0.12;
        bones.shoulderR.rotation.x = -0.22 + Math.sin(t * 0.65 + 0.8) * 0.12;
        bones.elbowL.rotation.x = -0.5;
        bones.elbowR.rotation.x = -0.5;
        bones.thighL.rotation.x = -0.34 + Math.sin(t * 0.6) * 0.08;
        bones.thighR.rotation.x = -0.16 + Math.sin(t * 0.6 + 0.9) * 0.08;
        bones.kneeL.rotation.x = 0.5;
        bones.kneeR.rotation.x = 0.3;
        headPivot.rotation.y = Math.sin(t * 0.5) * 0.22;
        break;
      }
    }

    // ---- Blink -------------------------------------------------------------
    const blink = blinkRef.current;
    blink.next -= delta;
    if (blink.next <= 0) {
      blink.closing = 1;
      blink.next = 2.4 + Math.random() * 3.4;
    }
    if (blink.closing > 0) {
      blink.closing = Math.max(0, blink.closing - delta * 7);
      const lid = 1 - Math.sin(blink.closing * Math.PI) * 0.88;
      headPivot.children.forEach((child) => {
        if (child.name.startsWith('Eye_')) child.scale.y = lid;
      });
    }
  });

  return <primitive object={rig.root} />;
}
