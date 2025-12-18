// @ts-nocheck
import React, { useRef, useState, useImperativeHandle, forwardRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, ContactShadows, Edges, Sphere, Float } from '@react-three/drei';
import * as THREE from 'three';
import { BlockData, WorldRef } from '../types';
import { GUNDAM_COLORS } from '../constants';
import { v4 as uuidv4 } from 'uuid';

const GRAVITY = -9.8;
const BLOCK_SIZE = 1;

// Minovsky Particles (Visual Feedback)
const Particles = ({ active, position }: { active: boolean, position: THREE.Vector3 }) => {
  const count = 40;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      t: Math.random() * 100,
      factor: 20 + Math.random() * 10,
      speed: 0.01 + Math.random() / 50,
      xFactor: -5 + Math.random() * 10,
      yFactor: -5 + Math.random() * 10,
      zFactor: -5 + Math.random() * 10,
    }));
  }, []);

  useFrame((state) => {
    if (!mesh.current) return;
    particles.forEach((particle, i) => {
      let { t, factor, speed, xFactor, yFactor, zFactor } = particle;
      t = particle.t += speed / 2;
      const a = Math.cos(t) + Math.sin(t * 1) / 10;
      const b = Math.sin(t) + Math.cos(t * 2) / 10;
      const s = Math.cos(t);
      
      const multiplier = active ? 2 : 0.2;
      dummy.position.set(
        position.x + (active ? Math.cos(t) * multiplier : 0) + (xFactor + Math.cos(t * 1.5)) * (multiplier / 5),
        position.y + (active ? Math.sin(t) * multiplier : 0) + (yFactor + Math.sin(t * 1.5)) * (multiplier / 5),
        position.z + (active ? Math.cos(t) * multiplier : 0) + (zFactor + Math.cos(t * 1.5)) * (multiplier / 5)
      );
      dummy.scale.setScalar(active ? s * 0.2 : 0);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshStandardMaterial color="#00ff00" emissive="#00ff00" emissiveIntensity={2} transparent opacity={0.6} />
    </instancedMesh>
  );
};

const Box: React.FC<{ data: BlockData }> = ({ data }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const rotationRef = useRef(new THREE.Euler(0, 0, 0));
  const angularVelocityRef = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.position.set(data.position[0], data.position[1], data.position[2]);
      
      // Update angular velocity based on linear velocity (simple hack for tumbling)
      if (!data.isSleeping) {
          angularVelocityRef.current.x += data.velocity[2] * 0.05;
          angularVelocityRef.current.z -= data.velocity[0] * 0.05;
          angularVelocityRef.current.y *= 0.95; // Dampen
          
          rotationRef.current.x += angularVelocityRef.current.x * delta;
          rotationRef.current.y += angularVelocityRef.current.y * delta;
          rotationRef.current.z += angularVelocityRef.current.z * delta;
          
          meshRef.current.setRotationFromEuler(rotationRef.current);
      }
      
      // Floor reset rotation
      if (data.position[1] <= BLOCK_SIZE / 2 + 0.01 && Math.abs(data.velocity[1]) < 0.1) {
          angularVelocityRef.current.multiplyScalar(0.8);
      }
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE]} />
      <meshStandardMaterial color={data.color} roughness={0.1} metalness={0.9} />
      <Edges color="black" threshold={15} />
    </mesh>
  );
};

const PhysicsScene = forwardRef<WorldRef, {}>((props, ref) => {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const blocksRef = useRef<BlockData[]>([]);
  const handPosRef = useRef(new THREE.Vector3(0, 100, 0));
  const handActiveRef = useRef(false);
  const [cursorPos, setCursorPos] = useState(new THREE.Vector3(0, 100, 0));

  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

  useImperativeHandle(ref, () => ({
    spawnBlock: (colorKey: string, x: number, y: number, z: number) => {
      let hexColor = GUNDAM_COLORS.WHITE;
      if (colorKey === 'random') {
          const keys = Object.values(GUNDAM_COLORS);
          hexColor = keys[Math.floor(Math.random() * keys.length)];
      } else {
          const keyUpper = colorKey.toUpperCase();
          if (keyUpper.includes('RED')) hexColor = GUNDAM_COLORS.RED;
          else if (keyUpper.includes('BLUE')) hexColor = GUNDAM_COLORS.BLUE;
          else if (keyUpper.includes('YELLOW')) hexColor = GUNDAM_COLORS.YELLOW;
      }
      setBlocks(prev => [...prev, { id: uuidv4(), position: [x, y, z], color: hexColor, velocity: [0, 0, 0], isSleeping: false }]);
    },
    pushBlocks: (direction: string, intensity: number) => {
      const currentBlocks = [...blocksRef.current];
      currentBlocks.forEach(b => {
        b.isSleeping = false;
        const force = intensity * 1.8;
        if (direction.includes('explode')) {
           b.velocity[0] += (Math.random() - 0.5) * force * 2;
           b.velocity[1] += force * 1.5;
           b.velocity[2] += (Math.random() - 0.5) * force * 2;
        } else {
           b.velocity[2] -= force; // Forward push
           b.velocity[1] += force * 0.3;
        }
      });
      setBlocks(currentBlocks);
    },
    clearScene: () => setBlocks([]),
    updateHandPosition: (x, y, isActive) => {
      const worldX = (x - 0.5) * 16; 
      const worldY = (1 - y) * 10; 
      const target = new THREE.Vector3(worldX, worldY, 1);
      handPosRef.current.copy(target);
      handActiveRef.current = isActive;
      setCursorPos(target.clone());
    }
  }));

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const currentBlocks = blocksRef.current;
    const handPos = handPosRef.current;
    const isHandActive = handActiveRef.current;

    for (let i = 0; i < currentBlocks.length; i++) {
      const b = currentBlocks[i];
      if (!b.isSleeping) b.velocity[1] += GRAVITY * dt;

      if (isHandActive) {
          const dx = b.position[0] - handPos.x;
          const dy = b.position[1] - handPos.y;
          const dz = b.position[2] - handPos.z;
          const distSq = dx*dx + dy*dy + dz*dz;
          if (distSq < 16) {
             const dist = Math.sqrt(distSq);
             const force = (4 - dist) * 20;
             b.velocity[0] += (dx / dist) * force * dt;
             b.velocity[1] += (dy / dist) * force * dt;
             b.velocity[2] += (dz / dist) * force * dt;
             b.isSleeping = false;
          }
      }

      b.position[0] += b.velocity[0] * dt;
      b.position[1] += b.velocity[1] * dt;
      b.position[2] += b.velocity[2] * dt;

      if (b.position[1] < BLOCK_SIZE / 2) {
        b.position[1] = BLOCK_SIZE / 2;
        b.velocity[1] *= -0.3; 
        b.velocity[0] *= 0.85; 
        b.velocity[2] *= 0.85;
        if (Math.abs(b.velocity[1]) < 0.1 && Math.abs(b.velocity[0]) < 0.1) b.isSleeping = true;
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={800} color="#0057b8" />
      <pointLight position={[-10, 10, -5]} intensity={500} color="#e9002d" />
      <Environment preset="night" />
      
      <Particles active={handActiveRef.current} position={cursorPos} />
      <Sphere position={cursorPos} args={[0.4, 32, 32]}>
          <meshStandardMaterial 
            color={handActiveRef.current ? "#00ff00" : "#555"} 
            emissive={handActiveRef.current ? "#00ff00" : "#000"}
            emissiveIntensity={2}
            transparent 
            opacity={0.7} 
          />
      </Sphere>

      <group>
         {blocks.map((block) => <Box key={block.id} data={block} />)}
      </group>

      <ContactShadows position={[0, 0, 0]} opacity={0.6} scale={30} blur={2} far={5} />
      <Grid infiniteGrid fadeDistance={40} sectionColor="#111" cellColor="#222" />
      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2.1} enableZoom={false} />
    </>
  );
});

const World = forwardRef<WorldRef, {}>((props, ref) => {
  return (
    <div className="w-full h-full cursor-none">
      <Canvas shadows camera={{ position: [0, 6, 15], fov: 40 }}>
        <color attach="background" args={['#020202']} />
        <PhysicsScene ref={ref} />
      </Canvas>
    </div>
  );
});

export default World;