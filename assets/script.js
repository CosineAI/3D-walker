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

// Trees
function addForest(treeCount = 300) {
  const forest = new THREE.Group();
  for (let i = 0; i < treeCount; i++) {
    const x = (Math.random() - 0.5) * (GROUND_SIZE - 100);
    const z = (Math.random() - 0.5) * (GROUND_SIZE - 100);

    // Optionally keep a small clear area in the center
    const minRadius = 20;
    if (Math.hypot(x, z) < minRadius) {
      i--;
      continue;
    }

    const trunkH = 5 + Math.random() * 4;
    const trunkR = 0.25 + Math.random() * 0.15;
    const trunkGeo = new THREE.CylinderGeometry(trunkR, trunkR, trunkH, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a4a21, roughness: 1.0, metalness: 0.0 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, trunkH / 2, z);
    trunk.castShadow = true;
    trunk.receiveShadow = true;

    // Foliage (stacked cones for a nicer shape)
    const foliageGroup = new THREE.Group();
    const foliageColor = 0x2e8b57;

    const cone1 = new THREE.Mesh(
      new THREE.ConeGeometry(trunkH * 0.55, trunkH * 1.0, 10),
      new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.9 })
    );
    cone1.position.y = trunkH + (trunkH * 1.0) / 2 - 0.2;
    cone1.castShadow = true;

    const cone2 = new THREE.Mesh(
      new THREE.ConeGeometry(trunkH * 0.45, trunkH * 0.8, 10),
      new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.9 })
    );
    cone2.position.y = trunkH + (trunkH * 1.0) - 0.3 + (trunkH * 0.8) / 2;
    cone2.castShadow = true;

    const cone3 = new THREE.Mesh(
      new THREE.ConeGeometry(trunkH * 0.32, trunkH * 0.6, 10),
      new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.9 })
    );
    cone3.position.y = trunkH + (trunkH * 1.0) + (trunkH * 0.8) - 0.4 + (trunkH * 0.6) / 2;
    cone3.castShadow = true;

    foliageGroup.add(cone1, cone2, cone3);
    foliageGroup.position.set(x, 0, z);

    forest.add(trunk);
    forest.add(foliageGroup);
  }
  scene.add(forest);
}
addForest(350);

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

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const SPEED = 40; // world units per second
const DAMPING = 8.0;

function onKeyDown(event) {
  switch (event.code) {
    case 'ArrowUp':
      moveForward = true; event.preventDefault(); break;
    case 'ArrowLeft':
      moveLeft = true; event.preventDefault(); break;
    case 'ArrowDown':
      moveBackward = true; event.preventDefault(); break;
    case 'ArrowRight':
      moveRight = true; event.preventDefault(); break;
    default:
      break;
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case 'ArrowUp':
      moveForward = false; event.preventDefault(); break;
    case 'ArrowLeft':
      moveLeft = false; event.preventDefault(); break;
    case 'ArrowDown':
      moveBackward = false; event.preventDefault(); break;
    case 'ArrowRight':
      moveRight = false; event.preventDefault(); break;
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
    if (moveForward || moveBackward) velocity.z -= direction.z * SPEED * delta;
    if (moveLeft || moveRight) velocity.x -= direction.x * SPEED * delta;

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