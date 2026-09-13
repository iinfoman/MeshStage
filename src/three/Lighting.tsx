/**
 * Three-point studio lighting.
 *
 * No HDR environment map: fetching one would block first paint on a phone
 * connection, so key/fill/rim lights plus a hemisphere ambient carry the look.
 */
export function StudioLighting({ accent = '#22d3ee' }: { accent?: string }) {
  return (
    <>
      <hemisphereLight args={['#44506e', '#08080b', 0.55]} />
      {/* Key */}
      <directionalLight
        position={[2.4, 3.6, 2.8]}
        intensity={2.9}
        color="#fff6ea"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={12}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={3}
        shadow-camera-bottom={-1}
        shadow-bias={-0.0015}
      />
      {/* Cool fill from camera left */}
      <directionalLight position={[-3, 1.4, 1.6]} intensity={0.45} color="#7dd3fc" />
      {/* Rim separates the silhouette from the obsidian backdrop */}
      <directionalLight position={[-1.2, 2.2, -3.2]} intensity={2.4} color={accent} />
      <pointLight position={[0, 1.3, 1.6]} intensity={0.5} color="#ffffff" distance={6} />
    </>
  );
}
