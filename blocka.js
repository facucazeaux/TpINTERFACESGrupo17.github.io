/* ===========================
   BLOCKA – Canvas + Animaciones de rotación
   =========================== */

const IMAGE_BANK = [
  "images/skate-rnkq3.jpg",
  "images/firefighting-simulator-ignite-1a9vf.jpg",
  "images/gas-station-simulator-6na58.jpg",
  "images/hitman-world-of-assassination.webp",
  "images/hell-is-us-1dwvo.jpg",
  "images/f125.jpg",
  "images/silent-hill-f.jpg",
].filter(Boolean);

const LEVELS = [
  { shuffle: false, filters: ["grayscale(1)"], timeLimitMs: null },
  { shuffle: true,  filters: ["brightness(0.3)", "brightness(0.3)"], timeLimitMs: 20_000 },
  { shuffle: true,  filters: ["invert(1)", "grayscale(1)", "brightness(0.3)"], timeLimitMs: 15_000 }
];






/* ====== Ajustes de animación ====== */
const ROTATE_MS = 240;        // duración del giro (ms)
const BLUR_TAPS = 5;          // “fantasma” de motion-blur (0 = sin blur)
const POP_SCALE = 0.04;       // “pop” sutil durante el giro (0 = desactivar)
const EASING = t => 1 - Math.pow(1 - t, 3); // easeOutCubic

/* ====== DOM ====== */
const grid = document.getElementById("grid");
const btnComenzar  = document.getElementById("btnJugar");
const btnReiniciar = document.getElementById("btnReiniciar");
const btnSiguiente = document.getElementById("btnSiguiente");
const nivelSpan = document.getElementById("nivel");
const nivelesTotalesSpan = document.getElementById("nivelesTotales");
const minSpan = document.getElementById("min");
const segSpan = document.getElementById("seg");
const msSpan  = document.getElementById("ms");
const recordSpan = document.getElementById("record");
const thumbs = document.getElementById("thumbs");

/* ====== Estado ====== */
let levelIndex = 0;
let imageSrc = null;
let lastImageSrc = null;
let startTime = 0;
let timerId = null;
let running = false;

let rotation = [0,0,0,0];   // estado final por slot (0..359)
let order    = [0,1,2,3];   // qué cuadrante hay en cada slot
let currentImg = null;      // HTMLImageElement
let resizeObs = null;
let selectedSlot = null;    // para Shift-select

// Animaciones por slot: {from,to,start,dur}
let anims = [null,null,null,null];
let animRAF = 0;

// Thumbs
let thumbNodes = [];
let isChoosing = false;

/* ====== Utils ====== */
const randItem = arr => arr[Math.floor(Math.random()*arr.length)];
const shuffled = arr => arr.slice().sort(() => Math.random() - 0.5);
const randRot  = () => [0,90,180,270][Math.floor(Math.random()*4)];
const fmt2 = n => n.toString().padStart(2,"0");
// redondea al múltiplo de 90 más cercano
const snap90 = deg => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
const fmt3 = n => n.toString().padStart(3,"0");
const normDeg = d => (d % 360 + 360) % 360;
const closeToZero = (deg, eps = 0.5) => {
  const d = normDeg(deg);
  return d < eps || Math.abs(d - 360) < eps;
};
function storageKey(){ return "blocka_record_lvl_" + (levelIndex+1); }
function updateRecordUI(){
  const rec = localStorage.getItem(storageKey());
  if (recordSpan) recordSpan.textContent = rec || "—";
}
function timeToMs(t){
  const [mm, rest] = t.split(":");
  const [ss, mmm] = rest.split(".");
  return (parseInt(mm)*60 + parseInt(ss))*1000 + parseInt(mmm);
}
function trySaveRecord(){
  if (!minSpan || !segSpan || !msSpan) return;
  const now = `${minSpan.textContent}:${segSpan.textContent}.${msSpan.textContent}`;
  const prev = localStorage.getItem(storageKey());
  if (!prev || timeToMs(now) < timeToMs(prev)){
    localStorage.setItem(storageKey(), now);
    updateRecordUI();
  }
}



/* ====== Imagen & filtros ====== */
function loadImage(src){
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}
function filterForSlot(slot){
  const arr = LEVELS[levelIndex].filters || [];
  if (!arr.length) return "";
  return arr.length === 1 ? arr[0] : arr[slot % arr.length];
}

/* ====== Dibujo Canvas ====== */
function drawCanvasTile(ctx, img, quadIndex, deg, filterStr, scale=1){
  const w = ctx.canvas.width  = ctx.canvas.clientWidth  || 100;
  const h = ctx.canvas.height = ctx.canvas.clientHeight || 100;

  const gridSize = 2;
const col = quadIndex % gridCols;
const row = Math.floor(quadIndex / gridCols);

const sx = (img.width  / gridCols) * col;
const sy = (img.height / gridRows) * row;
const sw = img.width  / gridCols;
const sh = img.height / gridRows;

  ctx.clearRect(0, 0, w, h);

  ctx.save();
  if (typeof ctx.filter !== "undefined" && filterStr) ctx.filter = filterStr;

  ctx.translate(w/2, h/2);
  ctx.rotate((deg * Math.PI) / 180);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.translate(-w/2, -h/2);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
}

/* Redibuja 1 ficha. Si está animando, interpola y aplica motion blur */
function redrawTile(slot){
  const tile = grid.children[slot];
  if (!tile || !currentImg) return;

  const canvas = tile._canvas;
  const ctx = canvas.getContext("2d");
  const quadIndex = order[slot];
  const a = anims[slot];

  if (a){
    const now = performance.now();
    let t = Math.min(1, (now - a.start) / a.dur);
    const e = EASING(t);

    // interpola por el camino más corto
    let diff = normDeg(a.to - a.from);
    if (diff > 180) diff -= 360;
    const degNow = normDeg(a.from + diff * e);

    const scl = 1 + POP_SCALE * Math.sin(Math.PI * e);

    if (BLUR_TAPS > 0){
      ctx.save();
      for (let i = BLUR_TAPS; i >= 0; i--){
        const f = i / (BLUR_TAPS + 1);
        const eTap = EASING(Math.max(0, t - f * 0.08));
        const degTap = normDeg(a.from + diff * eTap);
        ctx.globalAlpha = i === 0 ? 1 : 0.12;
        drawCanvasTile(ctx, currentImg, quadIndex, degTap, filterForSlot(slot), scl);
      }
      ctx.restore();
    } else {
      drawCanvasTile(ctx, currentImg, quadIndex, degNow, filterForSlot(slot), scl);
    }

    // marcar correcto con tolerancia
    const level = LEVELS[levelIndex];
    const okPlace = (!level.shuffle) || (order[slot] === slot);
    tile.classList.toggle("correct", okPlace && closeToZero(degNow));

    if (t >= 1){
      // fuerza estado exacto al terminar
      anims[slot] = null;
      rotation[slot] = snap90(rotation[slot]);
      drawCanvasTile(ctx, currentImg, quadIndex, rotation[slot], filterForSlot(slot), 1);
      markCorrects();
      if (!anims.some(Boolean)) checkWin();
    }
    return;
  }

  // sin animación: dibujar y marcar
  drawCanvasTile(ctx, currentImg, quadIndex, rotation[slot], filterForSlot(slot), 1);

  const level = LEVELS[levelIndex];
  const okRotation = closeToZero(rotation[slot]);
  const okPlace = (!level.shuffle) || (order[slot] === slot);
  tile.classList.toggle("correct", okRotation && okPlace);
}


function redrawAll(){
  for (let i = 0; i < grid.children.length; i++) redrawTile(i);
}

/* ====== Timer ====== */
if (nivelesTotalesSpan) nivelesTotalesSpan.textContent = String(LEVELS.length);

function startTimer(){ startTime = performance.now(); running = true; tick(); }
function stopTimer(){ running = false; if (timerId) cancelAnimationFrame(timerId); }
function tick(){
  if (!running) return;

  const elapsed = performance.now() - startTime;
  const limit = LEVELS[levelIndex].timeLimitMs ?? null;

  if (limit && minSpan && segSpan && msSpan){
    const remain = Math.max(0, limit - elapsed);
    const ms = Math.floor(remain % 1000);
    const s  = Math.floor(remain / 1000) % 60;
    const m  = Math.floor(remain / 60000);
    minSpan.textContent = fmt2(m);
    segSpan.textContent = fmt2(s);
    msSpan.textContent  = fmt3(ms);

    const timeEl = document.querySelector(".time");
    if (remain <= 10_000) timeEl?.classList.add("danger");
    else timeEl?.classList.remove("danger");

    if (remain <= 0) { onTimeout(); return; }
  } else if (minSpan && segSpan && msSpan){
    const ms = Math.floor(elapsed % 1000);
    const s  = Math.floor(elapsed / 1000) % 60;
    const m  = Math.floor(elapsed / 60000);
    minSpan.textContent = fmt2(m);
    segSpan.textContent = fmt2(s);
    msSpan.textContent  = fmt3(ms);
  }

  timerId = requestAnimationFrame(tick);
}

// === Grid dinámico por cantidad de piezas ===
const GRID_PRESETS = {
  4:  { cols: 2, rows: 2 }, // 2x2
  6:  { cols: 3, rows: 2 }, // 3x2
  8:  { cols: 4, rows: 2 }, // 4x2
};
let gridCols = 2, gridRows = 2;          // activo
let pieceCount = 4;                       // 4/6/8
const pieceSelect = document.getElementById('pieceCount');

pieceSelect?.addEventListener('change', async (e) => {
  const n = parseInt(e.target.value, 10);
  applyGridPreset(n);
  await setupLevel(true); // preview sin timer
});


function applyGridPreset(n) {
  const p = GRID_PRESETS[n] || GRID_PRESETS[4];
  gridCols = p.cols; gridRows = p.rows;
  pieceCount = gridCols * gridRows;
}
applyGridPreset(4); // default




function onTimeout(){
  stopTimer(); running = false;
  [...grid.children].forEach(t => { t.setAttribute("draggable","false"); t.style.pointerEvents="none"; });
  grid.classList.add("lost");
  const timeEl = document.querySelector(".time");
  timeEl?.classList.remove("danger"); timeEl?.classList.add("timeout");
  if (btnReiniciar) btnReiniciar.disabled = false;
  if (btnSiguiente) btnSiguiente.disabled = true;
}

/* ====== Thumbnails ====== */
function renderThumbs(){
  if (!thumbs) return;
  thumbs.innerHTML = "";
  thumbNodes = IMAGE_BANK.map((src, i) => {
    const img = document.createElement("img");
    img.src = src; img.alt = "Imagen banco " + (i+1); img.dataset.src = src;
    img.addEventListener("click", () => {
      if (isChoosing || running) return;
      imageSrc = src; highlightActiveThumb(); setupLevel(true);
    });
    thumbs.appendChild(img);
    return img;
  });
}
function highlightActiveThumb(){
  if (!thumbs) return;
  thumbNodes.forEach(n => n.classList.toggle("active", imageSrc && (n.dataset.src === imageSrc)));
}
function chooseImageWithAnimation(){
  return new Promise(resolve => {
    if (!thumbs || thumbNodes.length === 0){
      let choice;
      do { choice = randItem(IMAGE_BANK); } while (choice === lastImageSrc && IMAGE_BANK.length > 1);
      resolve(choice); return;
    }
    isChoosing = true; btnComenzar && (btnComenzar.disabled = true);
    let targetSrc;
    do { targetSrc = randItem(IMAGE_BANK); } while (targetSrc === lastImageSrc && IMAGE_BANK.length > 1);

    const totalSpinsMs = 1200, baseStepMs = 90;
    let elapsed = 0, idx = 0;
    const timer = setInterval(() => {
      elapsed += baseStepMs;
      thumbNodes.forEach(n => n.classList.remove("active","roulette"));
      const node = thumbNodes[idx % thumbNodes.length];
      node.classList.add("active","roulette");
      idx++;
      if (elapsed >= totalSpinsMs){
        clearInterval(timer);
        const finalIndex = IMAGE_BANK.findIndex(s => s === targetSrc);
        thumbNodes.forEach(n => n.classList.remove("active","roulette"));
        if (finalIndex >= 0) thumbNodes[finalIndex].classList.add("active");
        isChoosing = false; btnComenzar && (btnComenzar.disabled = false);
        resolve(targetSrc);
      }
    }, baseStepMs);
  });
}

/* ====== Selección / swap ====== */
function clearSelection(){
  [...grid.children].forEach(t => t.classList.remove('is-selected'));
  selectedSlot = null;
}
function swapOrder(a, b){
  const level = LEVELS[levelIndex];
  if (!level.shuffle || a === b) return;
  [order[a], order[b]] = [order[b], order[a]];
  redrawTile(a); redrawTile(b);
  markCorrects(); if (!anims.some(Boolean)) checkWin();
}

/* ====== Rotación con animación ====== */
function getCurrentDeg(slot){
  const a = anims[slot];
  if (!a) return rotation[slot];
  const now = performance.now();
  const t = Math.min(1, (now - a.start) / a.dur);
  const e = EASING(t);
  let diff = normDeg(a.to - a.from);
  if (diff > 180) diff -= 360;
  return normDeg(a.from + diff * e);
}

function rotate(slot, delta){
  if (!running) return;

  // Si hay anim en curso, partimos del ángulo real actual
  const current = getCurrentDeg(slot);      // ya la tenés
  const target  = snap90(current + delta);  // fuerza múltiplo de 90

  // Estado lógico final (entero múltiplo de 90)
  rotation[slot] = target;

  // Lanzar animación desde el ángulo real actual hacia el “snap”
  anims[slot] = { from: normDeg(current), to: target, start: performance.now(), dur: ROTATE_MS };
  if (!animRAF) animationLoop();
}


function animationLoop(){
  animRAF = requestAnimationFrame(() => {
    let any = false;
    for (let i = 0; i < anims.length; i++){
      if (anims[i]) any = true;
      // Redibujar cada slot en cada frame (si tiene animación, se interpola)
      redrawTile(i);
    }
    if (any){
      animationLoop();
    } else {
      animRAF = 0;
      // Al terminar todas las animaciones, validar victoria
      markCorrects(); checkWin();
    }
  });
}

/* ====== Correctos & Win ====== */
function markCorrects(){
  const level = LEVELS[levelIndex];
  for (let slot = 0; slot < pieceCount; slot++){
    const tile = grid.children[slot];
    if (!tile) continue;
    const okRotation = closeToZero(rotation[slot]);
    const okPlace = (!level.shuffle) || (order[slot] === slot);
    tile.classList.toggle("correct", okRotation && okPlace);
  }
}


function checkWin(){
  const level = LEVELS[levelIndex];

  // no ganar si hay animaciones en curso
  if (anims.some(Boolean)) return;

  const allZero = rotation.every(r => closeToZero(r));
  const orderOk = !level.shuffle || order.every((q,i) => q === i);

  if (allZero && orderOk){
    // normalizar todos a múltiplos exactos
    rotation = rotation.map(snap90);

    stopTimer();

    // Redibujar sin filtros al ganar
    for (let i = 0; i < pieceCount; i++){
      const tile = grid.children[i];
      const ctx = tile?._canvas?.getContext("2d");
      if (ctx) drawCanvasTile(ctx, currentImg, order[i], rotation[i], "", 1);
    }

    btnSiguiente && (btnSiguiente.disabled = levelIndex >= LEVELS.length - 1);
    btnReiniciar && (btnReiniciar.disabled = false);
    trySaveRecord();
  }
}


/* ====== Construir nivel ====== */
/* ====== Construir nivel ====== */
async function setupLevel(preview = false) {
  const level = LEVELS[levelIndex];
  if (nivelSpan) nivelSpan.textContent = String(levelIndex + 1);

  if (!imageSrc) imageSrc = randItem(IMAGE_BANK);
  currentImg = await loadImage(imageSrc);

  // Definir orden y rotaciones según cantidad de fichas
  order = level.shuffle
    ? shuffled([...Array(pieceCount).keys()])
    : [...Array(pieceCount).keys()];

  rotation = Array.from({ length: pieceCount }, () => randRot());
  if (rotation.every(r => r === 0))
    rotation[Math.floor(Math.random() * pieceCount)] = 90;

  anims = Array.from({ length: pieceCount }, () => null); // cancelar animaciones viejas

  // Configurar grilla dinámica según la cantidad de piezas
  grid.innerHTML = "";
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${gridRows}, 1fr)`;
  grid.classList.remove("lost");

  for (let slot = 0; slot < pieceCount; slot++) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.index = slot;
    tile.dataset.quad = order[slot];
    tile.dataset.deg = rotation[slot];

    const canvas = document.createElement("canvas");
    tile.appendChild(canvas);
    tile._canvas = canvas;

    // --- Drag & drop + Shift-select ---
    if (level.shuffle) {
      tile.setAttribute("draggable", "true");

      tile.addEventListener("dragstart", (e) =>
        e.dataTransfer.setData("text/plain", String(slot))
      );
      tile.addEventListener("dragover", (e) => e.preventDefault());
      tile.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!running) return;
        const from = parseInt(e.dataTransfer.getData("text/plain"));
        if (!Number.isNaN(from)) swapOrder(from, slot);
      });

      tile.addEventListener(
        "click",
        (ev) => {
          if (!running) return;
          if (ev.shiftKey) {
            if (selectedSlot === null) {
              selectedSlot = slot;
              tile.classList.add("is-selected");
            } else {
              const other = selectedSlot;
              clearSelection();
              swapOrder(other, slot);
            }
            ev.stopImmediatePropagation();
          }
        },
        true
      );
    }

    // --- Rotaciones con animación ---
    tile.addEventListener("click", () => rotate(slot, -90));
    tile.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      rotate(slot, +90);
    });

    grid.appendChild(tile);
  }

  // Primer render
  redrawAll();

  // Reset visual
  document.querySelector(".time")?.classList.remove("danger", "timeout");
  highlightActiveThumb();
  clearSelection();

  // UI inicial (según preview o no)
  btnSiguiente && (btnSiguiente.disabled = true);
  btnReiniciar && (btnReiniciar.disabled = true);
  stopTimer();
  if (minSpan && segSpan && msSpan) {
    minSpan.textContent = "00";
    segSpan.textContent = "00";
    msSpan.textContent = "000";
  }
  updateRecordUI();

  // Redibujo en responsive
  if (resizeObs) resizeObs.disconnect();
  resizeObs = new ResizeObserver(() => redrawAll());
  resizeObs.observe(grid);
}


/* ====== Botones ====== */
btnComenzar?.addEventListener("click", async () => {
  if (isChoosing) return;
  imageSrc = await chooseImageWithAnimation();
  lastImageSrc = imageSrc;
  await setupLevel();
  startTimer();
  btnReiniciar && (btnReiniciar.disabled = false);
});

btnReiniciar?.addEventListener("click", async () => {
  await setupLevel();
  startTimer();
});

btnSiguiente?.addEventListener("click", async () => {
  if (levelIndex < LEVELS.length - 1) levelIndex++;
  let next;
  do { next = randItem(IMAGE_BANK); } while (next === imageSrc && IMAGE_BANK.length > 1);
  imageSrc = lastImageSrc = next;
  await setupLevel();
  startTimer();
});

/* ====== Inicial ====== */
function renderThumbs(){
  if (!thumbs) return;
  thumbs.innerHTML = "";
  thumbNodes = IMAGE_BANK.map((src, i) => {
    const img = document.createElement("img");
    img.src = src; img.alt = "Imagen banco " + (i+1); img.dataset.src = src;
    img.addEventListener("click", () => {
      if (isChoosing || running) return;
      imageSrc = src; highlightActiveThumb(); setupLevel(true);
    });
    thumbs.appendChild(img);
    return img;
  });
}
renderThumbs();
setupLevel(true);


document.querySelectorAll('.carrusel-container').forEach(container => {
  const carrusel = container.querySelector('.carrusel');
  const btnPrev = container.querySelector('.carrusel-btn.prev');
  const btnNext = container.querySelector('.carrusel-btn.next');

  const scrollStep = 350;

  btnPrev.addEventListener('click', () => {
    carrusel.scrollBy({ left: -scrollStep, behavior: 'smooth' });
  });

  btnNext.addEventListener('click', () => {
    carrusel.scrollBy({ left: scrollStep, behavior: 'smooth' });
  });
});

