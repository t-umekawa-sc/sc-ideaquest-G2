"use client";

// SC-31 §9.2/§9.3＝3Dアバタービューア（R3F/three）。**アセット未整備のためプリミティブで見立て**＝
// 実VRM（男女2体＋装備パーツ）は差し替え seam（下記 TODO）。WebGL 非対応時はそもそも描画されない
// （呼び出し側 AvatarView が supportsWebGL() で 2D フォールバックへ分岐＝progressive enhancement）。
// 操作＝ドラッグ回転のみ（ズーム/パンは MVP 外・§9.4）。自動回転は prefers-reduced-motion 尊重（§9.3）。
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

import type { AvatarBase } from "../base";
import { prefersReducedMotion } from "../webgl";

// ベース差の見立て（プレースホルダ）＝実VRM未整備のため体色で区別。実装差し替え時に撤去。
const BASE_BODY_COLOR: Record<AvatarBase, string> = { male: "#4f7cff", female: "#ff6fae" };

function PlaceholderAvatar({ base }: { base: AvatarBase }) {
  const body = BASE_BODY_COLOR[base];
  return (
    <group position={[0, -0.9, 0]}>
      <mesh position={[0, 1.7, 0]}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <meshStandardMaterial color="#f2d2b6" />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <capsuleGeometry args={[0.32, 0.6, 8, 16]} />
        <meshStandardMaterial color={body} />
      </mesh>
      <mesh position={[-0.45, 1.05, 0]} rotation={[0, 0, 0.3]}>
        <capsuleGeometry args={[0.1, 0.6, 8, 16]} />
        <meshStandardMaterial color={body} />
      </mesh>
      <mesh position={[0.45, 1.05, 0]} rotation={[0, 0, -0.3]}>
        <capsuleGeometry args={[0.1, 0.6, 8, 16]} />
        <meshStandardMaterial color={body} />
      </mesh>
      <mesh position={[-0.16, 0.25, 0]}>
        <capsuleGeometry args={[0.12, 0.55, 8, 16]} />
        <meshStandardMaterial color="#37507a" />
      </mesh>
      <mesh position={[0.16, 0.25, 0]}>
        <capsuleGeometry args={[0.12, 0.55, 8, 16]} />
        <meshStandardMaterial color="#37507a" />
      </mesh>
    </group>
  );
}

export function AvatarViewer3D({ base }: { base: AvatarBase }) {
  const reduced = prefersReducedMotion();
  return (
    <Canvas className="viewer__canvas" camera={{ position: [0, 1.4, 3.2], fov: 40 }}>
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      {/* TODO(3D・SC-31 §9.2)＝実VRM ロードに差し替え＝@pixiv/three-vrm で base（男女2体）を読み、
          items.part_ref をスロット（head/face/body/hand）へアタッチ。background は 2D レイヤ（§9.2）。 */}
      <PlaceholderAvatar base={base} />
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate={!reduced}
        autoRotateSpeed={1.2}
        target={[0, 0.9, 0]}
      />
    </Canvas>
  );
}
