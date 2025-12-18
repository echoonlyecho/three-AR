import React, { useRef, useState, useImperativeHandle, forwardRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, ContactShadows, Edges, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { BlockData, WorldRef } from '../types';
import { GUNDAM_COLORS } from '../constants';
import { v4 as uuidv4 } from 'uuid';

const GRAVITY = -9.8;
const BLOCK_SIZE = 1;

interface BoxProps {
  data: BlockData;
}

const Box: React.FC<BoxProps> = ({ data }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.set(data.position[0], data.position[1], data.position[2]);
      // Add a slight rotation based on velocity for visual flair
      meshRef.current.rotation.x += data.velocity[2] * 0.1;
      meshRef.current.rotation.z -= data.velocity[0] * 0.1;
    }
  });

  return (
    <mesh ref={meshRef} position={data.position}>
      <boxGeometry args={[BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE]} />
      <meshStandardMaterial color={data.color} roughness={0.2} metalness={0.8} />
      <Edges color="black" threshold={15} />
    </mesh>
  );
};

// The glowing hand cursor
const HandCursor = ({ position, active }: { position: THREE.Vector3, active: boolean }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
     if (meshRef.current) {
        // Smooth lerp to target position
        meshRef.current.position.lerp(position, 0.2);
        
        // Pulse effect
        const scale = active ? 1.2 + Math.sin(state.clock.elapsedTime * 10) * 0.2 : 0.5;
        meshRef.current.scale.setScalar(scale);
     }
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.5, 32, 32]} />
      <meshStandardMaterial 
        color={active ? "#00ff00" : "#555"} 
        emissive={active ? "#00ff00" : "#000"}
        emissiveIntensity={active ? 2 : 0}
        transparent
        opacity={active ? 0.8 : 0.3}
      />
      {active && <pointLight distance={5} intensity={500} color="#00ff00" />}
    </mesh>
  );
};

const PhysicsScene = forwardRef<WorldRef, {}>((props, ref) => {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const blocksRef = useRef<BlockData[]>([]);
  
  // Hand State
  const handPosRef = useRef(new THREE.Vector3(0, 100, 0)); // Start far away
  const handActiveRef = useRef(false);
  // We use a state for the cursor visual just to trigger re-renders if needed, 
  // but mostly we rely on the ref passed to the component.
  const [cursorTarget, setCursorTarget] = useState(new THREE.Vector3(0, 100, 0)); 

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useImperativeHandle(ref, () => ({
    spawnBlock: (colorKey: string, x: number, y: number, z: number) => {
      let hexColor = GUNDAM_COLORS.WHITE;
      const keyUpper = colorKey.toUpperCase();
      if (keyUpper.includes('RED')) hexColor = GUNDAM_COLORS.RED;
      else if (keyUpper.includes('BLUE')) hexColor = GUNDAM_COLORS.BLUE;
      else if (keyUpper.includes('YELLOW')) hexColor = GUNDAM_COLORS.YELLOW;
      else if (keyUpper.includes('GREY') || keyUpper.includes('GRAY')) hexColor = GUNDAM_COLORS.GREY;
      
      const newBlock: BlockData = {
        id: uuidv4(),
        position: [x, y, z],
        color: hexColor,
        velocity: [0, 0, 0],
        isSleeping: false
      };
      setBlocks(prev => [...prev, newBlock]);
    },
    pushBlocks: (direction: string, intensity: number) => {
      const currentBlocks = [...blocksRef.current];
      currentBlocks.forEach(b => {
        b.isSleeping = false;
        let fx = 0, fy = 5 + (intensity * 0.5), fz = 0; 
        const force = intensity * 1.5;
        const noise = () => (Math.random() - 0.5) * 2; 

        if (direction.includes('explode')) {
           fx = noise() * force * 2.0; fz = noise() * force * 2.0; fy = force * 1.5;
        } else if (direction.includes('forward')) {
           fz = -force; fx = noise() * force * 0.5; fy += force * 0.5;
        }
        b.velocity[0] += fx; b.velocity[1] += fy; b.velocity[2] += fz;
      });
      setBlocks(currentBlocks);
    },
    clearScene: () => setBlocks([]),
    updateHandPosition: (x: number, y: number, isActive: boolean) => {
      // Map 0-1 screen coordinates to 3D world coordinates
      // Screen X: 0 (left) -> 1 (right)  => World X: -6 -> 6
      // Screen Y: 0 (top) -> 1 (bottom)  => World Y: 8 -> 0
      
      const worldX = (x - 0.5) * 12; 
      const worldY = (1 - y) * 8; 
      const worldZ = 2; // Fixed depth for the "hand plane"

      const target = new THREE.Vector3(worldX, worldY, worldZ);
      handPosRef.current.copy(target);
      handActiveRef.current = isActive;
      setCursorTarget(target.clone());
    }
  }));

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const currentBlocks = blocksRef.current;
    const handPos = handPosRef.current;
    const isHandActive = handActiveRef.current;

    for (let i = 0; i < currentBlocks.length; i++) {
      const b = currentBlocks[i];

      // 1. Gravity
      if (!b.isSleeping) b.velocity[1] += GRAVITY * dt;

      // 2. Hand Repulsor Force (The "Force")
      if (isHandActive) {
          const dx = b.position[0] - handPos.x;
          const dy = b.position[1] - handPos.y;
          const dz = b.position[2] - handPos.z;
          const distSq = dx*dx + dy*dy + dz*dz;
          
          // Interaction radius of 3 units
          if (distSq < 9) {
             const dist = Math.sqrt(distSq);
             const force = (3 - dist) * 15; // Strong repulsion closer to center
             
             // Apply force away from hand
             b.velocity[0] += (dx / dist) * force * dt;
             b.velocity[1] += (dy / dist) * force * dt;
             b.velocity[2] += (dz / dist) * force * dt;
             
             // Add some random noise for "electricity" effect
             b.velocity[0] += (Math.random() - 0.5) * 2;
             b.velocity[1] += (Math.random() - 0.5) * 2;
             
             b.isSleeping = false;
          }
      }

      // 3. Update Position
      b.position[0] += b.velocity[0] * dt;
      b.position[1] += b.velocity[1] * dt;
      b.position[2] += b.velocity[2] * dt;

      // 4. Floor Collision
      if (b.position[1] < BLOCK_SIZE / 2) {
        b.position[1] = BLOCK_SIZE / 2;
        b.velocity[1] *= -0.4; 
        b.velocity[0] *= 0.8; // Friction
        b.velocity[2] *= 0.8;
      }

      // 5. Block vs Block Collision
      for (let j = 0; j < currentBlocks.length; j++) {
        if (i === j) continue;
        const other = currentBlocks[j];
        
        const dx = Math.abs(b.position[0] - other.position[0]);
        const dy = Math.abs(b.position[1] - other.position[1]);
        const dz = Math.abs(b.position[2] - other.position[2]);

        if (dx < BLOCK_SIZE * 0.95 && dy < BLOCK_SIZE * 0.95 && dz < BLOCK_SIZE * 0.95) {
          // Simple resolution
          if (b.position[1] > other.position[1]) {
             b.position[1] = other.position[1] + BLOCK_SIZE;
             b.velocity[1] = 0;
             // Transfer some momentum
             other.velocity[0] += b.velocity[0] * 0.2;
             b.velocity[0] *= 0.5;
          }
        }
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1000} castShadow />
      <pointLight position={[-10, -10, -10]} intensity={500} color="#0057b8" />
      
      <Environment preset="city" />
      
      <HandCursor position={cursorTarget} active={handActiveRef.current} />

      <group>
         {blocks.map((block) => (
           <Box key={block.id} data={block} />
         ))}
      </group>

      <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={20} blur={2} far={4.5} />
      <Grid infiniteGrid fadeDistance={30} sectionColor="#0057b8" cellColor="#333" />
      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2.1} />
    </>
  );
});

const World = forwardRef<WorldRef, {}>((props, ref) => {
  return (
    <Canvas shadows camera={{ position: [0, 5, 12], fov: 45 }}>
      <color attach="background" args={['#050505']} />
      <PhysicsScene ref={ref} />
    </Canvas>
  );
});

export default World;