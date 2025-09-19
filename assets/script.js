// 3D Forest Walking Simulator
// Arrow keys to move, mouse to look around

import * as THREE from 'https://esm.sh/three@0.180.0';
import { PointerLockControls } from 'https://esm.sh/three@0.180.0/examples/jsm/controls/PointerLockControls.js';
import { mergeVertices } from 'https://esm.sh/three@0.180.0/examples/jsm/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'https://esm.sh/three@0.180.0/examples/jsm/geometries/ConvexGeometry.js';

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

// Keep track of tree footprints for later placement of rocks
const treeFootprints = [];

// Soft blob shadow texture used for cheap tree shadows
function createShadowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Trees (instanced for performance) — now with multiple species for variety
function addForestInstanced(treeCount = 4000) {
  const forest = new THREE.Group();

  // Base unit geometries
  const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const coneGeo = new THREE.ConeGeometry(1, 1, 10);
  const sphereGeo = new THREE.SphereGeometry(1, 12, 10);

  // Materials
  const trunkBrownMat = new THREE.MeshStandardMaterial({ color: 0x7a4a21, roughness: 1.0, metalness: 0.0 }); // pine/deciduous trunk
  const trunkBirchMat = new THREE.MeshStandardMaterial({ color: 0xe7ded0, roughness: 0.95 });                  // birch trunk
  const trunkDeadMat  = new THREE.MeshStandardMaterial({ color: 0x6b5b53, roughness: 1.0 });                   // dead wood

  const foliageConiferMat      = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.9 });  // pine
  const foliageConiferDarkMat  = new THREE.MeshStandardMaterial({ color: 0x1f6d3c, roughness: 0.95 }); // spruce
  const foliageDeciduousMat    = new THREE.MeshStandardMaterial({ color: 0x3ea24a, roughness: 0.9 });  // deciduous
  const foliageBirchMat        = new THREE.MeshStandardMaterial({ color: 0x6abd45, roughness: 0.95 }); // birch leaves

  // Transform buffers per species/part
  const transforms = {
    trunkBrown: [], trunkBirch: [], trunkDead: [],
    pineC1: [], pineC2: [], pineC3: [],
    spruceC1: [], spruceC2: [], spruceC3: [],
    decidBot: [], decidTop: [],
    birchBot: [], birchTop: [],
    shadowBlobs: [],
  };

  // Helper to push transforms
  const tmp = new THREE.Object3D();
  const push = (arr, x, y, z, sx, sy, sz) => {
    tmp.position.set(x, y, z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(sx, sy, sz);
    tmp.updateMatrix();
    arr.push(tmp.matrix.clone());
  };

  // Align blob shadows with the sun direction and offset them accordingly
  const sunDir = new THREE.Vector3().subVectors(dirLight.target.position, dirLight.position).normalize();
  const sunDirXZ = new THREE.Vector3(sunDir.x, 0, sunDir.z);
  let shadowAngleY = 0;
  let shadowOffsetFactor = 0;
  if (sunDirXZ.lengthSq() > 1e-6) {
    sunDirXZ.normalize();
    shadowAngleY = Math.atan2(sunDirXZ.x, sunDirXZ.z);
    // Lower sun (smaller |y|) -> longer shadows, but clamp for sanity
    shadowOffsetFactor = 1.2 / Math.max(0.3, Math.abs(sunDir.y));
  } else {
    sunDirXZ.set(1, 0, 0);
    shadowAngleY = 0;
    shadowOffsetFactor = 0;
  }

  const addShadow = (x, z, radius) => {
    // Slight randomness for more organic look
    const base = 1.7 * (0.95 + Math.random() * 0.1);
    const rx = Math.max(2, radius * base);
    const rz = Math.max(2, radius * (base + shadowOffsetFactor)); // stretch along sun direction
    const offset = radius * shadowOffsetFactor;

    tmp.position.set(x + sunDirXZ.x * offset, 0.02, z + sunDirXZ.z * offset);
    tmp.rotation.set(0, shadowAngleY, 0);
    // Scale in X and Z (ground plane). Keep Y ~1 so it doesn't stretch upward.
    tmp.scale.set(rx, 1, rz);
    tmp.updateMatrix();
    transforms.shadowBlobs.push(tmp.matrix.clone());
  };

  // Spatial hashing to reduce tree overlaps
  const CELL_SIZE = 12;
  const MAX_TREE_RADIUS = 10;
  const grid = new Map();
  const cellIndex = (v) => Math.floor(v / CELL_SIZE);
  const key = (ix, iz) => ix + ',' + iz;

  function canPlaceAt(x, z, r) {
    const ix = cellIndex(x);
    const iz = cellIndex(z);
    const range = Math.ceil((r + MAX_TREE_RADIUS) / CELL_SIZE);
    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const k = key(ix + dx, iz + dz);
        const cell = grid.get(k);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const p = cell[i];
          const minDist = r + p.r;
          const dxp = x - p.x;
          const dzp = z - p.z;
          if ((dxp * dxp + dzp * dzp) < (minDist * minDist)) return false;
        }
      }
    }
    return true;
  }

  function insertAt(x, z, r) {
    const ix = cellIndex(x);
    const iz = cellIndex(z);
    const k = key(ix, iz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ x, z, r });
    // Record globally for later rock placement
    treeFootprints.push({ x, z, r });
  }

  // Distribute trees across the ground with a few species
  let placed = 0;
  let attempts = 0;
  const MAX_ATTEMPTS = treeCount * 20;
  while (placed < treeCount && attempts < MAX_ATTEMPTS) {
    attempts++;

    const x = (Math.random() - 0.5) * (GROUND_SIZE - 100);
    const z = (Math.random() - 0.5) * (GROUND_SIZE - 100);

    // Keep a small clear area in the center
    const minRadius = 20;
    if (Math.hypot(x, z) < minRadius) continue;

    const r = Math.random();

    if (r < 0.35) {
      // Pine — classic conifer
      const trunkH = 5 + Math.random() * 4;
      const trunkR = 0.25 + Math.random() * 0.15;

      const h1 = trunkH * 1.00, r1 = trunkH * 0.55;
      const h2 = trunkH * 0.80, r2 = trunkH * 0.45;
      const h3 = trunkH * 0.60, r3 = trunkH * 0.32;

      const footR = Math.max(r1, r2, r3) * 0.9;
      if (!canPlaceAt(x, z, footR)) continue;

      push(transforms.trunkBrown, x, trunkH / 2, z, trunkR, trunkH, trunkR);
      push(transforms.pineC1, x, trunkH + h1 / 2 - 0.2, z, r1, h1, r1);
      push(transforms.pineC2, x, trunkH + h1 - 0.3 + h2 / 2, z, r2, h2, r2);
      push(transforms.pineC3, x, trunkH + h1 + h2 - 0.4 + h3 / 2, z, r3, h3, r3);

      const shadowR = Math.max(r1, r2, r3) * 1.1;
      addShadow(x, z, shadowR);
      insertAt(x, z, footR);

    } else if (r < 0.60) {
      // Spruce — taller, narrower, darker needles
      const trunkH = 6.5 + Math.random() * 5;
      const trunkR = 0.22 + Math.random() * 0.12;

      const h1 = trunkH * 1.30, r1 = trunkH * 0.42;
      const h2 = trunkH * 1.00, r2 = trunkH * 0.33;
      const h3 = trunkH * 0.70, r3 = trunkH * 0.24;

      const footR = Math.max(r1, r2, r3) * 0.9;
      if (!canPlaceAt(x, z, footR)) continue;

      push(transforms.trunkBrown, x, trunkH / 2, z, trunkR, trunkH, trunkR);
      push(transforms.spruceC1, x, trunkH + h1 / 2 - 0.2, z, r1, h1, r1);
      push(transforms.spruceC2, x, trunkH + h1 - 0.3 + h2 / 2, z, r2, h2, r2);
      push(transforms.spruceC3, x, trunkH + h1 + h2 - 0.4 + h3 / 2, z, r3, h3, r3);

      const shadowR = Math.max(r1, r2, r3) * 1.05;
      addShadow(x, z, shadowR);
      insertAt(x, z, footR);

    } else if (r < 0.85) {
      // Deciduous — rounded canopy
      const trunkH = 4.5 + Math.random() * 3.5;
      const trunkR = 0.28 + Math.random() * 0.18;

      // bottom canopy - broad ellipsoid
      const rB = trunkH * (0.85 + Math.random() * 0.15);
      const syB = rB * 0.75;

      // top canopy - smaller, slightly taller
      const rT = trunkH * (0.60 + Math.random() * 0.10);
      const syT = rT * 0.80;

      const footR = Math.max(rB, rT);
      if (!canPlaceAt(x, z, footR)) continue;

      push(transforms.trunkBrown, x, trunkH / 2, z, trunkR, trunkH, trunkR);
      push(transforms.decidBot, x, trunkH + syB * 0.6, z, rB, syB, rB);
      push(transforms.decidTop, x, trunkH + syB + syT * 0.5, z, rT, syT, rT);

      const shadowR = Math.max(rB, rT) * 1.15;
      addShadow(x, z, shadowR);
      insertAt(x, z, footR);

    } else if (r < 0.97) {
      // Birch — slender white trunk, light green canopy
      const trunkH = 5 + Math.random() * 3;
      const trunkR = 0.18 + Math.random() * 0.12;

      const rB = trunkH * (0.70 + Math.random() * 0.15);
      const syB = rB * 0.60;
      const rT = trunkH * (0.45 + Math.random() * 0.10);
      const syT = rT * 0.70;

      const footR = Math.max(rB, rT);
      if (!canPlaceAt(x, z, footR)) continue;

      push(transforms.trunkBirch, x, trunkH / 2, z, trunkR, trunkH, trunkR);
      push(transforms.birchBot, x, trunkH + syB * 0.65, z, rB, syB, rB);
      push(transforms.birchTop, x, trunkH + syB + syT * 0.55, z, rT, syT, rT);

      const shadowR = Math.max(rB, rT) * 1.1;
      addShadow(x, z, shadowR);
      insertAt(x, z, footR);

    } else {
      // Dead tree — trunk only
      const trunkH = 5 + Math.random() * 5;
      const trunkR = 0.23 + Math.random() * 0.15;

      const footR = trunkR * 2.0;
      if (!canPlaceAt(x, z, footR)) continue;

      push(transforms.trunkDead, x, trunkH / 2, z, trunkR, trunkH, trunkR);
      addShadow(x, z, trunkR * 1.5);
      insertAt(x, z, footR);
    }

    placed++;
  }

  // Helper to build InstancedMeshes from transform arrays
  function build(geo, mat, matrices, receiveShadow = false) {
    if (!matrices.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
    }
    mesh.castShadow = false; // disabled for perf with thousands of instances
    mesh.receiveShadow = receiveShadow;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  const meshes = [
    build(trunkGeo,  trunkBrownMat, transforms.trunkBrown, true),
    build(trunkGeo,  trunkBirchMat, transforms.trunkBirch, true),
    build(trunkGeo,  trunkDeadMat,  transforms.trunkDead,  true),

    build(coneGeo,   foliageConiferMat,     transforms.pineC1),
    build(coneGeo,   foliageConiferMat,     transforms.pineC2),
    build(coneGeo,   foliageConiferMat,     transforms.pineC3),

    build(coneGeo,   foliageConiferDarkMat, transforms.spruceC1),
    build(coneGeo,   foliageConiferDarkMat, transforms.spruceC2),
    build(coneGeo,   foliageConiferDarkMat, transforms.spruceC3),

    build(sphereGeo, foliageDeciduousMat,   transforms.decidBot),
    build(sphereGeo, foliageDeciduousMat,   transforms.decidTop),

    build(sphereGeo, foliageBirchMat,       transforms.birchBot),
    build(sphereGeo, foliageBirchMat,       transforms.birchTop),
  ];

  // Build blob shadows — orient geometry on XZ so instances lie flat on ground
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: createShadowTexture(),
    transparent: true,
    depthWrite: false,
  });
  const shadowMesh = build(shadowGeo, shadowMat, transforms.shadowBlobs);
  if (shadowMesh) {
    shadowMesh.renderOrder = 1;
    forest.add(shadowMesh);
  }

  for (const m of meshes) {
    if (m) forest.add(m);
  }

  scene.add(forest);
}

// Add rocks scattered on the ground, avoiding trees and each other
function addRocksInstanced(rockCount = 1200) {
  const group = new THREE.Group();

  // Base geometries (low-poly rocks)
  let rockGeoA = new THREE.IcosahedronGeometry(1, 0);
  let rockGeoB = new THREE.IcosahedronGeometry(1, 1);

  // Make rocks flat on the bottom so they sit on the ground
  function flattenBottom(geo) {
    const pos = geo.getAttribute('position');
    const arr = pos.array;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i + 1] < 0) arr[i + 1] = 0;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  // Displace vertices along normals (keeps faces stitched) for organic variation
  function displaceAlongNormals(geo, amplitude = 0.18, yFactor = 0.8) {
    geo.computeVertexNormals();
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const pArr = pos.array;
    const nArr = nrm.array;
    for (let i = 0; i < pArr.length; i += 3) {
      const amp = amplitude * (0.6 + Math.random() * 0.8);
      pArr[i]     += nArr[i]     * amp;
      pArr[i + 1] += nArr[i + 1] * amp * yFactor;
      pArr[i + 2] += nArr[i + 2] * amp;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  // Rebuild as a convex, closed mesh with a flat bottom
  function toConvexFlatBottom(geo) {
    const pos = geo.getAttribute('position');
    const points = [];
    for (let i = 0; i < pos.count; i++) {
      points.push(new THREE.Vector3(
        pos.getX(i),
        Math.max(0, pos.getY(i)),
        pos.getZ(i)
      ));
    }
    const convex = new ConvexGeometry(points);
    convex.computeVertexNormals();
    return convex;
  }

  function prepareRockGeometry(baseGeo, amp, yFactor) {
    // Merge duplicate vertices so faces stay connected during displacement
    const merged = mergeVertices(baseGeo, 1e-5);
    displaceAlongNormals(merged, amp, yFactor);
    // Build a watertight convex mesh from the displaced points, clamped at y >= 0
    const convex = toConvexFlatBottom(merged);
    return convex;
  }

  // Create additional base shapes and vary them
  let rockGeoC = new THREE.DodecahedronGeometry(1, 0);
  let rockGeoD = new THREE.BoxGeometry(1.2, 0.7, 1.2, 2, 1, 2); // slab-like
  let rockGeoE = new THREE.OctahedronGeometry(1, 0);

  // Prepare each shape (weld, displace, flatten)
  rockGeoA = prepareRockGeometry(rockGeoA, 0.15, 0.7);
  rockGeoB = prepareRockGeometry(rockGeoB, 0.12, 0.8);
  rockGeoC = prepareRockGeometry(rockGeoC, 0.15, 0.8);
  rockGeoD = prepareRockGeometry(rockGeoD, 0.08, 0.6);
  rockGeoE = prepareRockGeometry(rockGeoE, 0.20, 0.9);

  // Materials (a few subtle color variants)
  const rockMatA = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.98, metalness: 0.0, flatShading: true }); // light granite
  const rockMatB = new THREE.MeshStandardMaterial({ color: 0x70757d, roughness: 0.98, metalness: 0.0, flatShading: true }); // dark granite
  const rockMatC = new THREE.MeshStandardMaterial({ color: 0x7a6e65, roughness: 0.98, metalness: 0.0, flatShading: true }); // brownish
  const rockMatD = new THREE.MeshStandardMaterial({ color: 0x5f6a58, roughness: 0.98, metalness: 0.0, flatShading: true }); // mossy green-gray
  const rockMatE = new THREE.MeshStandardMaterial({ color: 0x6b7685, roughness: 0.98, metalness: 0.0, flatShading: true }); // slate

  // Transform arrays per geometry
  const matsA = [];
  const matsB = [];
  const matsC = [];
  const matsD = [];
  const matsE = [];

  // Helpers
  const tmp = new THREE.Object3D();
  const push = (arr, x, y, z, sx, sy, sz, ry) => {
    tmp.position.set(x, y, z);
    tmp.rotation.set(0, ry, 0);
    tmp.scale.set(sx, sy, sz);
    tmp.updateMatrix();
    arr.push(tmp.matrix.clone());
  };
  const rand = (a, b) => a + Math.random() * (b - a);

  // Build a spatial grid for trees to quickly reject collisions
  const CELL_SIZE_TREES = 12;
  const tCellIndex = (v) => Math.floor(v / CELL_SIZE_TREES);
  const tKey = (ix, iz) => ix + ',' + iz;
  const treeGrid = new Map();
  for (const p of treeFootprints) {
    const ix = tCellIndex(p.x);
    const iz = tCellIndex(p.z);
    const k = tKey(ix, iz);
    if (!treeGrid.has(k)) treeGrid.set(k, []);
    treeGrid.get(k).push(p);
  }

  // Rock spatial grid (avoid rock-rock overlaps)
  const CELL_SIZE_ROCKS = 6;
  const rCellIndex = (v) => Math.floor(v / CELL_SIZE_ROCKS);
  const rKey = (ix, iz) => ix + ',' + iz;
  const rockGrid = new Map();

  function canPlaceAgainstTrees(x, z, r) {
    const ix = tCellIndex(x);
    const iz = tCellIndex(z);
    const range = Math.ceil((r + 10) / CELL_SIZE_TREES); // 10 ~ typical tree radius
    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const k = tKey(ix + dx, iz + dz);
        const cell = treeGrid.get(k);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const p = cell[i];
          const minDist = r + p.r * 0.8; // small allowance so rocks can be near but not intersect trunks/canopies
          const dxp = x - p.x;
          const dzp = z - p.z;
          if ((dxp * dxp + dzp * dzp) < (minDist * minDist)) return false;
        }
      }
    }
    return true;
  }

  function canPlaceAgainstRocks(x, z, r) {
    const ix = rCellIndex(x);
    const iz = rCellIndex(z);
    const range = Math.ceil(r / CELL_SIZE_ROCKS) + 1;
    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const k = rKey(ix + dx, iz + dz);
        const cell = rockGrid.get(k);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const p = cell[i];
          const minDist = r + p.r;
          const dxp = x - p.x;
          const dzp = z - p.z;
          if ((dxp * dxp + dzp * dzp) < (minDist * minDist)) return false;
        }
      }
    }
    return true;
  }

  function insertRock(x, z, r) {
    const ix = rCellIndex(x);
    const iz = rCellIndex(z);
    const k = rKey(ix, iz);
    if (!rockGrid.has(k)) rockGrid.set(k, []);
    rockGrid.get(k).push({ x, z, r });
  }

  let placed = 0;
  let attempts = 0;
  const MAX_ATTEMPTS = rockCount * 30;

  while (placed < rockCount && attempts < MAX_ATTEMPTS) {
    attempts++;

    const x = (Math.random() - 0.5) * (GROUND_SIZE - 100);
    const z = (Math.random() - 0.5) * (GROUND_SIZE - 100);
    const minRadius = 18;
    if (Math.hypot(x, z) < minRadius) continue;

    const scaleMul = 10;

    // Choose a rock variant for more visual variety
    const v = Math.random();
    let variant = 'A';
    if (v < 0.25) variant = 'A';
    else if (v < 0.50) variant = 'B';
    else if (v < 0.70) variant = 'C';
    else if (v < 0.90) variant = 'D'; // slab
    else variant = 'E';               // boulder

    let sx, sy, sz;
    if (variant === 'A') {
      sx = rand(0.25, 1.10) * scaleMul;
      sz = rand(0.25, 1.10) * scaleMul;
      sy = rand(0.18, 0.70) * scaleMul;
    } else if (variant === 'B') {
      sx = rand(0.30, 1.40) * scaleMul;
      sz = rand(0.30, 1.40) * scaleMul;
      sy = rand(0.25, 0.90) * scaleMul;
    } else if (variant === 'C') {
      sx = rand(0.40, 1.60) * scaleMul;
      sz = rand(0.40, 1.60) * scaleMul;
      sy = rand(0.20, 1.20) * scaleMul;
    } else if (variant === 'D') {
      // flat slab-like stones
      sx = rand(0.80, 2.20) * scaleMul;
      sz = rand(0.80, 2.20) * scaleMul;
      sy = rand(0.15, 0.35) * scaleMul;
    } else {
      // large boulders
      const bigMul = scaleMul * 2.0;
      sx = rand(1.00, 1.80) * bigMul;
      sz = rand(1.00, 1.80) * bigMul;
      sy = rand(0.90, 2.50) * bigMul;
    }

    const r = Math.max(sx, sz) * 0.9;

    if (!canPlaceAgainstTrees(x, z, r)) continue;
    if (!canPlaceAgainstRocks(x, z, r)) continue;

    const ry = rand(0, Math.PI * 2);
    const y = -rand(0.05, 0.20) * sy; // bury slightly so the flat bottom sits in the dirt

    if (variant === 'A') {
      push(matsA, x, y, z, sx, sy, sz, ry);
    } else if (variant === 'B') {
      push(matsB, x, y, z, sx, sy, sz, ry);
    } else if (variant === 'C') {
      push(matsC, x, y, z, sx, sy, sz, ry);
    } else if (variant === 'D') {
      push(matsD, x, y, z, sx, sy, sz, ry);
    } else {
      push(matsE, x, y, z, sx, sy, sz, ry);
    }

    insertRock(x, z, r);
    placed++;
  }

  function build(geo, mat, matrices) {
    if (!matrices.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
    }
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  const mA = build(rockGeoA, rockMatA, matsA);
  const mB = build(rockGeoB, rockMatB, matsB);
  const mC = build(rockGeoC, rockMatC, matsC);
  const mD = build(rockGeoD, rockMatD, matsD);
  const mE = build(rockGeoE, rockMatE, matsE);
  if (mA) group.add(mA);
  if (mB) group.add(mB);
  if (mC) group.add(mC);
  if (mD) group.add(mD);
  if (mE) group.add(mE);

  scene.add(group);
}

addForestInstanced(4000);
addRocksInstanced(1200);

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
const SPEED = 80; // world units per second (doubled)
const DAMPING = 8.0;
const SPRINT_MULTIPLIER = 2.0;

// Stamina
const MAX_STAMINA = 100;
let stamina = MAX_STAMINA;
const STAMINA_DRAIN_PER_SEC = 30; // while sprinting
const STAMINA_REGEN_PER_SEC = 20; // while not sprinting
const staminaFill = document.getElementById('stamina-fill');

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
    const moving = moveForward || moveBackward || moveLeft || moveRight;
    const sprinting = isSprinting && moving && stamina > 0;

    const curSpeed = SPEED * (sprinting ? SPRINT_MULTIPLIER : 1);
    if (moveForward || moveBackward) velocity.z -= direction.z * curSpeed * delta;
    if (moveLeft || moveRight) velocity.x -= direction.x * curSpeed * delta;

    // Apply movement
    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);
    clampPlayer();

    // Stamina drain/regen
    if (sprinting) {
      stamina -= STAMINA_DRAIN_PER_SEC * delta;
    } else {
      stamina += STAMINA_REGEN_PER_SEC * delta;
    }
    stamina = Math.max(0, Math.min(MAX_STAMINA, stamina));
  }

  // Update stamina UI
  const ratio = stamina / MAX_STAMINA;
  if (staminaFill) {
    staminaFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    staminaFill.style.backgroundColor = ratio > 0.6 ? '#22c55e' : (ratio > 0.3 ? '#f59e0b' : '#ef4444');
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