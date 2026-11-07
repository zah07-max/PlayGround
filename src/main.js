import './style.css';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Cube Land — a small, self-contained voxel puzzler.
const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $('stage-canvas'), level: $('level-number'), name: $('level-name'), dots: $('level-dots'),
  moves: $('moves-value'), score: $('score-value'), movesStat: $('moves-stat'), progress: $('progress-fill'),
  progressNote: $('progress-note'), hint: $('hint-text'), toast: $('toast'), combo: $('combo-badge'), comboValue: $('combo-value'),
  floatLayer: $('float-layer'), status: $('sr-status'), result: $('result-overlay'), resultTitle: $('result-title'),
  resultEyebrow: $('result-eyebrow'), resultSub: $('result-sub'), resultScore: $('result-score-value'),
  resultMoves: $('result-moves'), resultBlocks: $('result-blocks'), resultBest: $('result-best'),
  resultNext: $('result-next'), resultNextLabel: $('result-next-label'), resultSecondary: $('result-secondary'),
  stars: [...document.querySelectorAll('#result-stars .star')], help: $('help-overlay'),
};

const PALETTE = [
  { name: 'Coral', hex: 0xff8f7c, css: '#ff8f7c' }, { name: 'Mint', hex: 0x78d8b9, css: '#78d8b9' },
  { name: 'Lavender', hex: 0xa28cf1, css: '#a28cf1' }, { name: 'Sky', hex: 0x74c8e8, css: '#74c8e8' },
  { name: 'Lemon', hex: 0xffcf68, css: '#ffcf68' }, { name: 'Pink', hex: 0xf28fbe, css: '#f28fbe' },
];
const LEVELS = [
  { name: 'Cube', shape: 'cube', size: 3 },
  { name: 'Pyramid', shape: 'pyramid', size: 4 },
  { name: 'Cross', shape: 'cross', size: 3 },
  { name: 'Big Cube', shape: 'cube', size: 4 },
  { name: 'Tall Pyramid', shape: 'pyramid', size: 5 },
  { name: 'Plus', shape: 'cross', size: 4 },
];
const CELL = 0.92;
const HALF = CELL * 0.5;
const scene = new THREE.Scene();
scene.background = null;
const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
camera.position.set(6, 8, 10);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label', 'Interactive 3D voxel puzzle. Drag to rotate and select a color blaster.');
renderer.domElement.tabIndex = 0;
ui.canvas.appendChild(renderer.domElement);

const world = new THREE.Group();
scene.add(world);
const board = new THREE.Group();
world.add(board);
const ambient = new THREE.HemisphereLight(0xfffaf1, 0x9b8c9f, 2.0);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xfff5e8, 3.0);
keyLight.position.set(-5, 9, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -8; keyLight.shadow.camera.right = 8;
keyLight.shadow.camera.top = 8; keyLight.shadow.camera.bottom = -8;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xd9e7ff, 1.3);
fillLight.position.set(6, 4, -5);
scene.add(fillLight);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const cells = new Map();
const blockMeshes = new Map();
const blasters = [];
const projectiles = [];
const bursts = [];
const removeAfterAnimation = [];
let levelIndex = 0, levelNumber = 1, score = 0, levelScore = 0, movesLeft = 0;
let totalBlocks = 0, clearedBlocks = 0, combo = 0, busy = false, soundOn = true;
let drag = null, targetRotY = 0, targetRotX = 0.28, toastTimer = 0, comboTimer = 0;
let audioContext = null;

function keyOf(x, y, z) { return `${x},${y},${z}`; }
function coordsFromKey(key) { return key.split(',').map(Number); }
function cellPosition(x, y, z) {
  const l = state.level;
  return new THREE.Vector3((x - (l.width - 1) / 2) * CELL, (y - (l.height - 1) / 2) * CELL, (z - (l.depth - 1) / 2) * CELL);
}
let state = { level: LEVELS[0], components: [] };

function makeShape(config) {
  const out = [];
  const n = config.size;
  if (config.shape === 'cube') {
    for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out.push([x, y, z]);
  } else if (config.shape === 'pyramid') {
    for (let y = 0; y < n; y++) {
      const span = n - y;
      const start = Math.floor(y / 2);
      for (let z = start; z < start + span; z++) for (let x = start; x < start + span; x++) out.push([x, y, z]);
    }
  } else {
    const mid = Math.floor((n - 1) / 2);
    for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      if (x === mid || y === mid || z === mid) out.push([x, y, z]);
    }
  }
  return out;
}

function colorFor(x, y, z, seed) {
  // Give each horizontal slice one color so every blaster clears a chunky,
  // connected layer instead of leaving a frustrating field of single cubes.
  return PALETTE[(y + seed) % PALETTE.length];
}

function findComponents() {
  const visited = new Set();
  const components = [];
  for (const [key, color] of cells) {
    if (visited.has(key)) continue;
    const queue = [key], keys = [];
    visited.add(key);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]; keys.push(current);
      const [x, y, z] = coordsFromKey(current);
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const next = keyOf(x + dx, y + dy, z + dz);
        if (!visited.has(next) && cells.get(next) === color) { visited.add(next); queue.push(next); }
      }
    }
    components.push({ color, keys });
  }
  return components;
}

function createBlock(key, color) {
  const [x, y, z] = coordsFromKey(key);
  const material = new THREE.MeshStandardMaterial({ color: color.hex, roughness: 0.36, metalness: 0.02 });
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(CELL * 0.94, CELL * 0.94, CELL * 0.94, 2, 0.075), material);
  mesh.position.copy(cellPosition(x, y, z));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.key = key;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL * 0.86, CELL * 0.86, CELL * 0.86)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }));
  mesh.add(edge);
  board.add(mesh); blockMeshes.set(key, mesh);
}

function clearWorld() {
  for (const mesh of blockMeshes.values()) {
    board.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
    mesh.children.forEach((child) => { child.geometry?.dispose(); child.material?.dispose(); });
  }
  blockMeshes.clear(); cells.clear();
  for (const item of blasters) { world.remove(item.group); item.group.traverse((child) => { child.geometry?.dispose(); child.material?.dispose(); }); }
  blasters.length = 0;
  for (const item of projectiles) { world.remove(item.mesh); item.mesh.geometry.dispose(); item.mesh.material.dispose(); }
  projectiles.length = 0;
  for (const item of bursts) { world.remove(item.mesh); item.mesh.geometry.dispose(); item.mesh.material.dispose(); }
  bursts.length = 0;
  removeAfterAnimation.length = 0;
  board.clear();
}

function makePlatform(level) {
  const radius = Math.max(level.width, level.depth) * CELL * 0.78 + 0.9;
  const platformY = -(level.height - 1) * CELL * 0.5 - 0.7;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.94, 0.32, 64), new THREE.MeshStandardMaterial({ color: 0xfffcf6, roughness: 0.48 }));
  base.position.y = platformY; base.castShadow = true; base.receiveShadow = true; board.add(base);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.97, 0.045, 10, 64), new THREE.MeshStandardMaterial({ color: 0xf0d8c8, roughness: 0.4 }));
  trim.rotation.x = Math.PI / 2; trim.position.y = platformY + 0.07; board.add(trim);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.69, radius * 0.82, 0.32, 48), new THREE.MeshStandardMaterial({ color: 0xe9ddd2, roughness: 0.58 }));
  foot.position.y = platformY - 0.26; foot.castShadow = true; board.add(foot);
  return { radius, platformY };
}

function makeBlaster(color, angle, radius, platformY) {
  const group = new THREE.Group();
  const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
  group.position.set(x, platformY + 0.2, z);
  group.rotation.y = -angle;
  group.userData.color = color;
  const dark = new THREE.MeshStandardMaterial({ color: 0x645e6b, roughness: 0.4, metalness: 0.14 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.28, 24), dark);
  body.position.y = 0.12; body.castShadow = true; group.add(body);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.22, 24), new THREE.MeshStandardMaterial({ color: color.hex, roughness: 0.3 }));
  collar.position.set(0, 0.31, 0); collar.castShadow = true; group.add(collar);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.43, 20), new THREE.MeshStandardMaterial({ color: color.hex, roughness: 0.27, metalness: 0.08 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.36, 0.2); barrel.castShadow = true; group.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.035, 8, 24), new THREE.MeshStandardMaterial({ color: 0xfff8ec, emissive: color.hex, emissiveIntensity: 0.3 }));
  muzzle.position.set(0, 0.36, 0.42); muzzle.add(new THREE.PointLight(color.hex, 0.5, 1.1)); group.add(muzzle);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 32), new THREE.MeshBasicMaterial({ color: color.hex, transparent: true, opacity: 0.22 }));
  glow.position.y = -0.035; group.add(glow);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.43, 16, 12), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.y = 0.22; hit.userData.hitArea = true; group.add(hit);
  board.add(group);
  blasters.push({ group, color });
}

function updateDots() {
  const total = LEVELS.length;
  ui.dots.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('i');
    const current = (levelNumber - 1) % total;
    if (i < current) dot.className = 'done';
    if (i === current) dot.className = 'active';
    ui.dots.appendChild(dot);
  }
}

function updateHud() {
  ui.level.textContent = String(levelNumber).padStart(2, '0');
  ui.name.textContent = state.level.name;
  ui.moves.textContent = String(movesLeft);
  ui.score.textContent = score.toLocaleString();
  ui.movesStat.classList.toggle('low', movesLeft <= 2 && movesLeft > 0);
  ui.progress.style.width = `${totalBlocks ? Math.min(100, (clearedBlocks / totalBlocks) * 100) : 0}%`;
  ui.progressNote.textContent = `${totalBlocks - clearedBlocks} blocks`;
  updateDots();
}

function makeLevel(index, keepScore = true) {
  busy = false; combo = 0; ui.combo.classList.remove('show');
  clearWorld();
  levelIndex = index % LEVELS.length;
  state.level = { ...LEVELS[levelIndex] };
  if (state.level.shape === 'pyramid') { state.level.width = state.level.size; state.level.depth = state.level.size; state.level.height = state.level.size; }
  else { state.level.width = state.level.size; state.level.depth = state.level.size; state.level.height = state.level.size; }
  const coords = makeShape(state.level);
  const seed = levelNumber + levelIndex * 3;
  for (const [x, y, z] of coords) cells.set(keyOf(x, y, z), colorFor(x, y, z, seed));
  for (const [key, color] of cells) createBlock(key, color);
  state.components = findComponents();
  totalBlocks = cells.size; clearedBlocks = 0;
  movesLeft = state.components.length + Math.max(3, Math.ceil(state.components.length * 0.5));
  if (!keepScore) { score = 0; levelScore = 0; }
  else levelScore = 0;
  const { radius, platformY } = makePlatform(state.level);
  const colors = [...new Set(state.components.map((component) => component.color))];
  colors.forEach((color, i) => {
    const spread = colors.length > 1 ? (i / (colors.length - 1) - 0.5) * 2.1 : 0;
    makeBlaster(color, spread, radius * 0.82, platformY);
  });
  targetRotY = -0.38;
  targetRotX = 0.28;
  board.rotation.set(targetRotX, targetRotY, 0);
  fitCamera();
  updateHud();
  ui.hint.textContent = 'Tap a blaster to fire';
  ui.status.textContent = `Level ${levelNumber}: ${state.level.name}. ${totalBlocks} blocks.`;
}

function fitCamera() {
  const rect = ui.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const aspect = rect.width / rect.height;
  const maxSpan = Math.max(state.level.width, state.level.depth) * CELL;
  const platformRadius = maxSpan * 0.78 + 0.9;
  // Fit the whole island, including the blaster controls, into the portrait stage.
  const worldWidth = Math.max(maxSpan + 2.4, platformRadius * 2 + 0.5);
  const viewHeight = Math.max(5.8, worldWidth / aspect);
  camera.left = -viewHeight * aspect / 2; camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
  camera.position.set(6, 8, 10).multiplyScalar(Math.max(1, maxSpan / 3));
  camera.lookAt(0, -0.2, 0);
  camera.updateProjectionMatrix();
}

function componentCenter(component) {
  const center = new THREE.Vector3();
  for (const key of component.keys) {
    const [x, y, z] = coordsFromKey(key);
    center.add(cellPosition(x, y, z));
  }
  return center.multiplyScalar(1 / component.keys.length);
}

function findTarget(color, shooter) {
  board.updateMatrixWorld(true);
  const from = new THREE.Vector3(); shooter.getWorldPosition(from);
  let best = null, bestDistance = Infinity;
  for (const component of state.components) {
    if (component.color !== color) continue;
    const center = componentCenter(component);
    const worldCenter = board.localToWorld(center.clone());
    const distance = from.distanceTo(worldCenter);
    if (distance < bestDistance) { bestDistance = distance; best = { component, center }; }
  }
  return best;
}

function playTone(frequency = 480, duration = 0.11, type = 'sine', volume = 0.045) {
  if (!soundOn) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.62), audioContext.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch { /* Audio is an optional flourish; gameplay never depends on it. */ }
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1650);
}

function showFloat(center, value, color, label) {
  const worldPoint = board.localToWorld(center.clone());
  worldPoint.project(camera);
  const rect = ui.canvas.getBoundingClientRect();
  const element = document.createElement('div');
  element.className = 'float-score';
  element.style.left = `${(worldPoint.x * 0.5 + 0.5) * rect.width}px`;
  element.style.top = `${(-worldPoint.y * 0.5 + 0.5) * rect.height}px`;
  element.style.color = color.css;
  element.innerHTML = `+${value.toLocaleString()}<small>${label}</small>`;
  ui.floatLayer.appendChild(element);
  setTimeout(() => element.remove(), 1150);
}

function makeBurst(position, color, count = 15) {
  const material = new THREE.MeshBasicMaterial({ color: color.hex, transparent: true, opacity: 1 });
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055 + Math.random() * 0.045, 0), material.clone());
    mesh.position.copy(position);
    const velocity = new THREE.Vector3((Math.random() - 0.5) * 2.7, Math.random() * 2.6 + 0.25, (Math.random() - 0.5) * 2.7);
    board.add(mesh);
    bursts.push({ mesh, velocity, life: 0.58 + Math.random() * 0.38, age: 0 });
  }
  material.dispose();
}

function fireBlaster(blaster) {
  if (busy || movesLeft <= 0) return;
  const target = findTarget(blaster.color, blaster.group);
  if (!target) { showToast('That color is all clear!'); return; }
  busy = true;
  movesLeft--;
  updateHud();
  playTone(330, 0.15, 'triangle', 0.055);
  const origin = blaster.group.position.clone().add(new THREE.Vector3(0, 0.58, 0.5).applyQuaternion(blaster.group.quaternion));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), new THREE.MeshStandardMaterial({ color: blaster.color.hex, emissive: blaster.color.hex, emissiveIntensity: 0.5, roughness: 0.22 }));
  mesh.position.copy(origin); board.add(mesh);
  const glow = new THREE.PointLight(blaster.color.hex, 1.8, 2.3); mesh.add(glow);
  projectiles.push({ mesh, from: origin, to: target.center.clone(), component: target.component, color: blaster.color, elapsed: 0, duration: 0.42 });
  ui.hint.textContent = `${blaster.color.name} blaster firing…`;
}

function beginClusterClear(component, color, center) {
  combo++;
  const multiplier = Math.min(2.5, 1 + (combo - 1) * 0.25);
  const points = Math.round(component.keys.length * 100 * multiplier);
  score += points; levelScore += points;
  clearedBlocks += component.keys.length;
  showFloat(center, points, color, combo > 1 ? `${combo}× combo` : `${component.keys.length} cubes`);
  if (combo > 1) {
    ui.comboValue.textContent = multiplier.toFixed(2);
    ui.combo.classList.add('show');
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => ui.combo.classList.remove('show'), 1550);
  }
  playTone(610 + Math.min(component.keys.length, 10) * 24, 0.24, 'sine', 0.06);
  makeBurst(center, color, Math.min(34, 12 + component.keys.length * 2));
  for (const key of component.keys) {
    const mesh = blockMeshes.get(key);
    if (!mesh) continue;
    const [x, y, z] = coordsFromKey(key);
    const from = mesh.position.clone();
    const scatter = new THREE.Vector3((x - (state.level.width - 1) / 2) * 0.16, 0.12 + Math.random() * 0.35, (z - (state.level.depth - 1) / 2) * 0.16);
    removeAfterAnimation.push({ key, mesh, from, to: from.clone().add(scatter), age: 0, duration: 0.43 + Math.random() * 0.12 });
  }
  updateHud();
  ui.status.textContent = `Cleared ${component.keys.length} ${color.name} cubes for ${points} points.`;
  setTimeout(() => finishClusterClear(component, color), 510);
}

function finishClusterClear(component, color) {
  for (const key of component.keys) {
    const mesh = blockMeshes.get(key);
    if (mesh) {
      board.remove(mesh); mesh.geometry.dispose();
      mesh.children.forEach((child) => { child.geometry?.dispose(); child.material?.dispose(); });
      mesh.material.dispose(); blockMeshes.delete(key);
    }
    cells.delete(key);
  }
  state.components = findComponents();
  for (let i = blasters.length - 1; i >= 0; i--) {
    if (!state.components.some((part) => part.color === blasters[i].color)) {
      const [removed] = blasters.splice(i, 1);
      board.remove(removed.group);
      removed.group.traverse((child) => { child.geometry?.dispose(); child.material?.dispose(); });
    }
  }
  updateHud();
  if (!cells.size) {
    busy = false;
    finishLevel(true);
  } else {
    busy = false;
    ui.hint.textContent = 'Tap a blaster to fire';
    showToast(`${component.keys.length} ${color.name.toLowerCase()} cubes cleared`);
    if (movesLeft <= 0) finishLevel(false);
  }
}

function finishLevel(won) {
  busy = true;
  ui.result.classList.add('open');
  ui.result.setAttribute('aria-hidden', 'false');
  ui.resultTitle.textContent = won ? 'Level clear!' : 'So close!';
  ui.resultEyebrow.textContent = won ? `LEVEL ${String(levelNumber).padStart(2, '0')} COMPLETE` : 'ONE MORE TRY';
  ui.resultSub.textContent = won ? 'Beautifully done. Every little cube, in its place.' : 'Your color blasters are ready when you are.';
  ui.resultScore.textContent = levelScore.toLocaleString();
  ui.resultMoves.textContent = String(movesLeft);
  ui.resultBlocks.textContent = String(totalBlocks);
  const bestKey = `cube-land-best-${levelNumber}`;
  const best = Math.max(Number(localStorage.getItem(bestKey) || 0), levelScore);
  if (won) localStorage.setItem(bestKey, String(best));
  ui.resultBest.textContent = Math.max(best, Number(localStorage.getItem(bestKey) || 0)).toLocaleString();
  const stars = won ? (movesLeft >= Math.ceil((state.components.length + 2) * 0.45) ? 3 : movesLeft > 0 ? 2 : 1) : 0;
  ui.stars.forEach((star, i) => star.classList.toggle('on', i < stars));
  ui.resultNextLabel.textContent = won ? 'Next level' : 'Try again';
  ui.resultSecondary.textContent = won ? 'Replay level' : 'Restart level';
  ui.resultNext.setAttribute('aria-label', won ? 'Start next level' : 'Try this level again');
  playTone(won ? 760 : 220, 0.32, 'sine', 0.06);
  setTimeout(() => ui.resultNext.focus(), 120);
}

function closeOverlay(element) {
  element.classList.remove('open');
  element.setAttribute('aria-hidden', 'true');
}

// INTERACTION
ui.canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  ui.canvas.classList.add('dragging');
  ui.canvas.setPointerCapture?.(event.pointerId);
});
ui.canvas.addEventListener('pointermove', (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
  if (drag.moved) {
    targetRotY += dx * 0.008;
    targetRotX = THREE.MathUtils.clamp(targetRotX + dy * 0.006, -0.22, 0.82);
  }
  drag.lastX = event.clientX; drag.lastY = event.clientY;
});
ui.canvas.addEventListener('pointerup', (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  const wasDrag = drag.moved;
  drag = null; ui.canvas.classList.remove('dragging');
  if (wasDrag) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(blasters.map((item) => item.group), true);
  for (const hit of hits) {
    let node = hit.object;
    while (node && !node.userData.color) node = node.parent;
    if (node?.userData.color) {
      const shooter = blasters.find((item) => item.group === node);
      if (shooter) fireBlaster(shooter);
      break;
    }
  }
});
ui.canvas.addEventListener('pointercancel', () => { drag = null; ui.canvas.classList.remove('dragging'); });
ui.canvas.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') targetRotY -= 0.2;
  if (event.key === 'ArrowRight') targetRotY += 0.2;
  if (event.key === 'ArrowUp') targetRotX = THREE.MathUtils.clamp(targetRotX - 0.12, -0.22, 0.82);
  if (event.key === 'ArrowDown') targetRotX = THREE.MathUtils.clamp(targetRotX + 0.12, -0.22, 0.82);
  if (/^[1-6]$/.test(event.key)) fireBlaster(blasters[Number(event.key) - 1]);
});

$('restart-btn').addEventListener('click', () => {
  closeOverlay(ui.result);
  makeLevel(levelIndex, true);
  showToast('Level restarted');
});
$('sound-btn').addEventListener('click', (event) => {
  soundOn = !soundOn;
  event.currentTarget.classList.toggle('muted', !soundOn);
  event.currentTarget.setAttribute('aria-pressed', String(soundOn));
  if (soundOn) playTone(520, 0.1);
});
$('help-btn').addEventListener('click', () => { ui.help.classList.add('open'); ui.help.setAttribute('aria-hidden', 'false'); $('help-got-it').focus(); });
$('help-close').addEventListener('click', () => closeOverlay(ui.help));
$('help-got-it').addEventListener('click', () => closeOverlay(ui.help));
ui.help.addEventListener('click', (event) => { if (event.target === ui.help) closeOverlay(ui.help); });
ui.result.addEventListener('click', (event) => { if (event.target === ui.result) return; });
ui.resultNext.addEventListener('click', () => {
  const won = ui.resultTitle.textContent === 'Level clear!';
  closeOverlay(ui.result);
  if (won) { levelNumber++; makeLevel(levelIndex + 1, true); }
  else makeLevel(levelIndex, true);
});
ui.resultSecondary.addEventListener('click', () => {
  closeOverlay(ui.result);
  makeLevel(levelIndex, true);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (ui.help.classList.contains('open')) closeOverlay(ui.help);
    else if (ui.result.classList.contains('open')) closeOverlay(ui.result);
  }
});

function resize() {
  const rect = ui.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  renderer.setSize(rect.width, rect.height, false);
  fitCamera();
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(ui.canvas);
window.addEventListener('resize', resize, { passive: true });

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  board.rotation.y = THREE.MathUtils.damp(board.rotation.y, targetRotY, 8, delta);
  board.rotation.x = THREE.MathUtils.damp(board.rotation.x, targetRotX, 8, delta);
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const shot = projectiles[i];
    shot.elapsed += delta;
    const t = Math.min(1, shot.elapsed / shot.duration);
    shot.mesh.position.lerpVectors(shot.from, shot.to, t);
    shot.mesh.position.y += Math.sin(t * Math.PI) * 0.48;
    shot.mesh.scale.setScalar(0.7 + Math.sin(t * Math.PI) * 0.5);
    if (t >= 1) {
      board.remove(shot.mesh); shot.mesh.geometry.dispose(); shot.mesh.material.dispose();
      projectiles.splice(i, 1);
      beginClusterClear(shot.component, shot.color, shot.to);
    }
  }
  for (let i = removeAfterAnimation.length - 1; i >= 0; i--) {
    const item = removeAfterAnimation[i];
    item.age += delta;
    const t = Math.min(1, item.age / item.duration);
    const eased = 1 - (1 - t) ** 3;
    item.mesh.position.lerpVectors(item.from, item.to, eased);
    const scale = Math.max(0.001, 1 - t);
    item.mesh.scale.setScalar(scale);
    item.mesh.rotation.x += delta * 5; item.mesh.rotation.y += delta * 4;
    if (t >= 1) removeAfterAnimation.splice(i, 1);
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const particle = bursts[i];
    particle.age += delta;
    particle.velocity.y -= delta * 4.2;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.mesh.rotation.x += delta * 5; particle.mesh.rotation.z += delta * 3;
    particle.mesh.material.opacity = Math.max(0, 1 - particle.age / particle.life);
    particle.mesh.scale.setScalar(Math.max(0.01, 1 - particle.age / particle.life));
    if (particle.age >= particle.life) {
      board.remove(particle.mesh); particle.mesh.geometry.dispose(); particle.mesh.material.dispose();
      bursts.splice(i, 1);
    }
  }
  renderer.render(scene, camera);
}

makeLevel(0, false);
resize();
animate();
