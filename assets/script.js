// 3D Forest Walking Simulator
// Arrow keys to move, mouse to look around

import * as THREE from 'https://esm.sh/three@0.180.0';
import { PointerLockControls } from 'https://esm.sh/three@0.180.0/examples/jsm/controls/PointerLockControls.js';

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Scene and camera
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd1e5);
scene.fog = new THREE.Fog(0xbfd1e5, 200, 1200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const EYE_HEIGHT = 2;
camera.position.set(0, EYE_HEIGHT, 0);

// Lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0x334433, 0.6);
hemi.position.set(0, 200, 0);
scene.add(hemi);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(-120, 200, 80);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -200;
dirLight.shadow.camera.right = 200;
dirLight.shadow.camera.top = 200;
dirLight.shadow.camera.bottom = -200;
scene.add(dirLight);

// Ground
const GROUND_SIZE = 2000;
const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b }); // brown
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Trees (instanced for performance)
function addForestInstanced(treeCount = 4000) {
  const forest = new THREE.Group();

  // Base unit geometries
  const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const coneGeo = new THREE.ConeGeometry(1, 1, 10);

  // Materials
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a4a21, roughness: 1.0, metalness: 0.0 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.9 });

  // Instanced meshes
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const cones1 = new THREE.InstancedMesh(coneGeo, foliageMat, treeCount);
  const cones2 = new THREE.InstancedMesh(coneGeo, foliageMat, treeCount);
  const cones3 = new THREE.InstancedMesh(coneGeo, foliageMat, treeCount);

  // Shadows: disable casting for performance with thousands of instances
  trunks.castShadow = false;
  trunks.receiveShadow = true;
  cones1.castShadow = false;
  cones2.castShadow = false;
  cones3.castShadow = false;

  const tmp = new THREE.Object3D();
  let index = 0;

  while (index < treeCount) {
    const x = (Math.random() - 0.5) * (GROUND_SIZE - 100);
    const z = (Math.random() - 0.5) * (GROUND_SIZE - 100);

    // Keep a small clear area in the center
    const minRadius = 20;
    if (Math.hypot(x, z) < minRadius) continue;

    const trunkH = 5 + Math.random() * 4;
    const trunkR = 0.25 + Math.random() * 0.15;

    // Trunk transform (scale unit cylinder)
    tmp.position.set(x, trunkH / 2, z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(trunkR, trunkH, trunkR);
    tmp.updateMatrix();
    trunks.setMatrixAt(index, tmp.matrix);

    // Foliage sizes based on trunkH
    const h1 = trunkH * 1.0, r1 = trunkH * 0.55;
    const h2 = trunkH * 0.8,  r2 = trunkH * 0.45;
    const h3 = trunkH * 0.6,  r3 = trunkH * 0.32;

    // First cone
    tmp.position.set(x, trunkH + h1 / 2 - 0.2, z);
    tmp.scale.set(r1, h1, r1);
    tmp.updateMatrix();
    cones1.setMatrixAt(index, tmp.matrix);

    // Second cone
    tmp.position.set(x, trunkH + h1 - 0.3 + h2 / 2, z);
    tmp.scale.set(r2, h2, r2);
    tmp.updateMatrix();
    cones2.setMatrixAt(index, tmp.matrix);

    // Third cone
    tmp.position.set(x, trunkH + h1 + h2 - 0.4 + h3 / 2, z);
    tmp.scale.set(r3, h3, r3);
    tmp.updateMatrix();
    cones3.setMatrixAt(index, tmp.matrix);

    index++;
  }

  trunks.instanceMatrix.needsUpdate = true;
  cones1.instanceMatrix.needsUpdate = true;
  cones2.instanceMatrix.needsUpdate = true;
  cones3.instanceMatrix.needsUpdate = true;

  forest.add(trunks, cones1, cones2, cones3);
  scene.add(forest);
}

addForestInstanced(4000);

// Controls (mouse look + keyboard move)
const controls = new PointerLockControls(camera, document.body);
// PointerLockControls r180 controls the camera directly; no need to add an object to the scene.

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');

controls.addEventListener('lock', () => {
  overlay.style.display = 'none';
});

controls.addEventListener('unlock', () => {
  overlay.style.display = 'flex';
});

startBtn.addEventListener('click', () => {
  controls.lock();
});

// Movement state
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let isSprinting = false;

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const SPEED = 40; // world units per second
const DAMPING = 8.0;
const SPRINT_MULTIPLIER = 2.0;

function onKeyDown(event) {
  switch (event.code) {
    case 'ArrowUp':
    case 'KeyW':
      moveForward = true; event.preventDefault(); break;
    case 'ArrowLeft':
    case 'KeyA':
      moveLeft = true; event.preventDefault(); break;
    case 'ArrowDown':
    case 'KeyS':
      moveBackward = true; event.preventDefault(); break;
    case 'ArrowRight':
    case 'KeyD':
      moveRight = true; event.preventDefault(); break;
    case 'ShiftLeft':
    case 'ShiftRight':
      isSprinting = true; event.preventDefault(); break;
    default:
      break;
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case 'ArrowUp':
    case 'KeyW':
      moveForward = false; event.preventDefault(); break;
    case 'ArrowLeft':
    case 'KeyA':
      moveLeft = false; event.preventDefault(); break;
    case 'ArrowDown':
    case 'KeyS':
      moveBackward = false; event.preventDefault(); break;
    case 'ArrowRight':
    case 'KeyD':
      moveRight = false; event.preventDefault(); break;
    case 'ShiftLeft':
    case 'ShiftRight':
      isSprinting = false; event.preventDefault(); break;
    default:
      break;
  }
}

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// Keep the camera above ground and within bounds
function clampPlayer() {
  const obj = camera; // controls operate directly on the camera in r180
  obj.position.y = EYE_HEIGHT;
  const half = GROUND_SIZE * 0.5 - 5;
  obj.position.x = Math.max(-half, Math.min(half, obj.position.x));
  obj.position.z = Math.max(-half, Math.min(half, obj.position.z));
}

// Animation loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05); // clamp big frame jumps

  // Apply damping
  velocity.x -= velocity.x * DAMPING * delta;
  velocity.z -= velocity.z * DAMPING * delta;

  // Input direction
  direction.z = Number(moveForward) - Number(moveBackward);
  direction.x = Number(moveRight) - Number(moveLeft);
  direction.normalize();

  if (controls.isLocked) {
    const curSpeed = SPEED * (isSprinting ? SPRINT_MULTIPLIER : 1);
    if (moveForward || moveBackward) velocity.z -= direction.z * curSpeed * delta;
    if (moveLeft || moveRight) velocity.x -= direction.x * curSpeed * delta;

    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);
    clampPlayer();
  }

  renderer.render(scene, camera);
}

animate();

// Resize handling
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});