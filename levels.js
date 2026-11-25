/* ============================================================
   levels.js — Pixel Horror Mazes, Procedural Nightmare & Baking
   ============================================================ */
(function (global) {
  "use strict";

  const W = 320;
  const H = 200;
  const CX = 160;
  const CY = 100;

  // Deterministic PRNG for consistent pixel textures per level
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PALETTES = [
    // Floor I — The Cellar (Cold damp slate & rust)
    {
      wallDark: [18, 17, 22],
      wallMid: [35, 32, 40],
      wallLight: [56, 50, 62],
      wallTrim: [84, 42, 46],
      floorDark: [12, 11, 14],
      floorMid: [22, 20, 25],
      blood: [125, 16, 26],
      exitGlow: "#4be37a",
      lanternTint: [255, 204, 130],
    },
    // Floor II — The Catacombs (Bone ash & mold)
    {
      wallDark: [20, 19, 17],
      wallMid: [42, 39, 34],
      wallLight: [68, 63, 54],
      wallTrim: [94, 78, 56],
      floorDark: [11, 11, 10],
      floorMid: [21, 20, 18],
      blood: [118, 22, 28],
      exitGlow: "#5ef295",
      lanternTint: [255, 224, 155],
    },
    // Floor III — The Flesh Corridor (Crimson organic horror)
    {
      wallDark: [24, 8, 12],
      wallMid: [54, 14, 21],
      wallLight: [86, 22, 30],
      wallTrim: [128, 34, 44],
      floorDark: [13, 6, 9],
      floorMid: [25, 11, 15],
      blood: [165, 18, 32],
      exitGlow: "#6aff9e",
      lanternTint: [255, 175, 125],
    },
    // Floor IV — The Needle (Cold obsidian & steel)
    {
      wallDark: [10, 12, 18],
      wallMid: [24, 29, 42],
      wallLight: [44, 52, 72],
      wallTrim: [108, 30, 48],
      floorDark: [7, 8, 12],
      floorMid: [15, 18, 25],
      blood: [155, 20, 38],
      exitGlow: "#52ffc0",
      lanternTint: [220, 225, 255],
    },
    // Floor V — The Abyss (Pitch void & dried blood)
    {
      wallDark: [14, 7, 13],
      wallMid: [34, 14, 28],
      wallLight: [62, 22, 44],
      wallTrim: [150, 24, 42],
      floorDark: [8, 5, 8],
      floorMid: [17, 10, 16],
      blood: [185, 18, 34],
      exitGlow: "#7aff8c",
      lanternTint: [255, 165, 140],
    },
  ];

  // 5 Handcrafted, verified-solvable tight pixel mazes (all start at 160, 100)
  const CAMPAIGN_LEVELS = [
    {
      id: 1,
      name: "FLOOR I — THE CELLAR",
      subtitle: "STAY OFF THE DAMP STONE. REACH THE GREEN SIGIL.",
      corridorWidth: 18,
      sanctuaryRadius: 16,
      exitRadius: 11,
      lightRadius: 72,
      ambientLight: 0.28,
      palette: PALETTES[0],
      exitPos: [282, 52],
      paths: [
        // Main verified path
        [
          [160, 100],
          [160, 48],
          [70, 48],
          [70, 148],
          [120, 148],
          [120, 168],
          [245, 168],
          [245, 52],
          [282, 52],
        ],
        // Dead-end traps
        [
          [70, 48],
          [32, 48],
          [32, 110],
        ],
        [
          [245, 120],
          [286, 120],
          [286, 164],
        ],
      ],
    },
    {
      id: 2,
      name: "FLOOR II — THE CATACOMBS",
      subtitle: "THE WALLS ARE WATCHING. KEEP A STEADY HAND.",
      corridorWidth: 14,
      sanctuaryRadius: 15,
      exitRadius: 10,
      lightRadius: 64,
      ambientLight: 0.24,
      palette: PALETTES[1],
      exitPos: [286, 166],
      paths: [
        [
          [160, 100],
          [206, 100],
          [206, 32],
          [108, 32],
          [108, 62],
          [42, 62],
          [42, 134],
          [112, 134],
          [112, 168],
          [248, 168],
          [248, 76],
          [286, 76],
          [286, 166],
        ],
        // Dead-end traps
        [
          [108, 32],
          [36, 32],
        ],
        [
          [180, 168],
          [180, 136],
          [218, 136],
        ],
        [
          [248, 76],
          [248, 34],
          [286, 34],
        ],
      ],
    },
    {
      id: 3,
      name: "FLOOR III — FLESH CORRIDOR",
      subtitle: "IT BREATHES. DON'T LET YOUR FINGERS TREMBLE.",
      corridorWidth: 11,
      sanctuaryRadius: 15,
      exitRadius: 10,
      lightRadius: 56,
      ambientLight: 0.2,
      palette: PALETTES[2],
      exitPos: [288, 170],
      paths: [
        [
          [160, 100],
          [160, 146],
          [118, 146],
          [118, 100],
          [82, 100],
          [82, 170],
          [34, 170],
          [34, 30],
          [96, 30],
          [96, 66],
          [142, 66],
          [142, 30],
          [212, 30],
          [212, 72],
          [252, 72],
          [252, 30],
          [290, 30],
          [290, 126],
          [236, 126],
          [236, 170],
          [288, 170],
        ],
        // Dead-end traps
        [
          [160, 146],
          [196, 146],
          [196, 174],
          [130, 174],
        ],
        [
          [212, 72],
          [212, 108],
        ],
      ],
    },
    {
      id: 4,
      name: "FLOOR IV — THE NEEDLE",
      subtitle: "SPIRAL OUTWARD. RAZOR CORRIDORS AHEAD.",
      corridorWidth: 9,
      sanctuaryRadius: 14,
      exitRadius: 9,
      lightRadius: 50,
      ambientLight: 0.17,
      palette: PALETTES[3],
      exitPos: [294, 174],
      paths: [
        [
          [160, 100],
          [128, 100],
          [128, 66],
          [194, 66],
          [194, 134],
          [100, 134],
          [100, 40],
          [224, 40],
          [224, 162],
          [68, 162],
          [68, 24],
          [28, 24],
          [28, 180],
          [258, 180],
          [258, 30],
          [292, 30],
          [292, 70],
          [276, 70],
          [276, 110],
          [294, 110],
          [294, 174],
        ],
      ],
    },
    {
      id: 5,
      name: "FLOOR V — THE ABYSS",
      subtitle: "FINAL TRIAL. ONE SLIP AND IT FINDS YOU.",
      corridorWidth: 7,
      sanctuaryRadius: 14,
      exitRadius: 9,
      lightRadius: 46,
      ambientLight: 0.14,
      palette: PALETTES[4],
      exitPos: [22, 28],
      paths: [
        [
          [160, 100],
          [160, 72],
          [196, 72],
          [214, 52],
          [136, 52],
          [114, 76],
          [114, 128],
          [186, 128],
          [212, 102],
          [240, 102],
          [240, 26],
          [82, 26],
          [82, 154],
          [236, 154],
          [266, 126],
          [266, 26],
          [296, 26],
          [296, 178],
          [44, 178],
          [44, 28],
          [22, 28],
        ],
      ],
    },
  ];

  // Carve a filled circle on mask
  function carveCircle(mask, cx, cy, r, val) {
    const r2 = r * r;
    const x0 = Math.max(1, Math.floor(cx - r));
    const x1 = Math.min(W - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r));
    const y1 = Math.min(H - 2, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) {
          mask[y * W + x] = val;
        }
      }
    }
  }

  // Carve thick rounded segment between (x0,y0) and (x1,y1)
  function carveSegment(mask, x0, y0, x1, y1, radius, val) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      carveCircle(mask, x0 + dx * t, y0 + dy * t, radius, val);
    }
  }

  // Compute Manhattan BFS distance to nearest wall (0 = wall)
  function computeWallDistance(mask) {
    const dist = new Uint8Array(W * H);
    dist.fill(255);
    const queue = new Int32Array(W * H);
    let head = 0;
    let tail = 0;

    for (let i = 0; i < W * H; i++) {
      if (mask[i] === 0) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }

    while (head < tail) {
      const idx = queue[head++];
      const d = dist[idx];
      if (d >= 254) continue;
      const x = idx % W;
      const y = (idx / W) | 0;
      const nd = d + 1;

      if (x > 0 && dist[idx - 1] > nd) {
        dist[idx - 1] = nd;
        queue[tail++] = idx - 1;
      }
      if (x < W - 1 && dist[idx + 1] > nd) {
        dist[idx + 1] = nd;
        queue[tail++] = idx + 1;
      }
      if (y > 0 && dist[idx - W] > nd) {
        dist[idx - W] = nd;
        queue[tail++] = idx - W;
      }
      if (y < H - 1 && dist[idx + W] > nd) {
        dist[idx + W] = nd;
        queue[tail++] = idx + W;
      }
    }

    return dist;
  }

  // Place atmospheric pixel eyes embedded inside walls near corridors
  function placeWallEyes(mask, rand, count) {
    const eyes = [];
    let attempts = 0;
    while (eyes.length < count && attempts < 1400) {
      attempts++;
      const x = 14 + ((rand() * (W - 28)) | 0);
      const y = 14 + ((rand() * (H - 28)) | 0);

      // Must be solidly inside a wall (check 5x5 area all wall)
      let solid = true;
      for (let oy = -3; oy <= 3 && solid; oy++) {
        for (let ox = -4; ox <= 4; ox++) {
          if (mask[(y + oy) * W + (x + ox)] !== 0) {
            solid = false;
            break;
          }
        }
      }
      if (!solid) continue;

      // Must be within 18px of a walkable corridor so lantern reveals it
      let nearPath = false;
      for (let oy = -18; oy <= 18 && !nearPath; oy += 3) {
        for (let ox = -18; ox <= 18; ox += 3) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && mask[ny * W + nx] > 0) {
            nearPath = true;
            break;
          }
        }
      }
      if (!nearPath) continue;

      // Not too close to another eye
      let tooClose = false;
      for (let i = 0; i < eyes.length; i++) {
        if (Math.hypot(eyes[i].x - x, eyes[i].y - y) < 36) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      eyes.push({
        x,
        y,
        blinkPhase: rand() * Math.PI * 2,
        redIris: rand() < 0.45,
      });
    }
    return eyes;
  }

  // Bake procedural pixel-art maze texture onto an offscreen canvas
  function bakeMazeCanvas(levelDef, mask, wallDist, rand) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const pal = levelDef.palette;

    // Pre-generate a few creepy blood splatters near wall edges
    const stains = [];
    for (let i = 0; i < 18; i++) {
      stains.push({
        x: 10 + rand() * (W - 20),
        y: 10 + rand() * (H - 20),
        r: 3 + rand() * 8,
      });
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const p = idx * 4;
        const m = mask[idx];

        // Deterministic spatial hash for crisp pixel noise
        const h = ((x * 374761393 + y * 668265263 + levelDef.id * 919) ^ ((x * 13) >> 2)) >>> 0;
        const n = (h % 100) / 100;

        let r, g, b;

        if (m === 0) {
          // WALL PIXEL — Brick/stone/flesh texture + highlighted corridor rim
          const adjFloor =
            (x > 0 && mask[idx - 1] > 0) ||
            (x < W - 1 && mask[idx + 1] > 0) ||
            (y > 0 && mask[idx - W] > 0) ||
            (y < H - 1 && mask[idx + W] > 0);

          const adjFloor2 =
            !adjFloor &&
            ((x > 1 && mask[idx - 2] > 0) ||
              (x < W - 2 && mask[idx + 2] > 0) ||
              (y > 1 && mask[idx - W * 2] > 0) ||
              (y < H - 2 && mask[idx + W * 2] > 0));

          if (adjFloor) {
            // Sharp crisp wall border so players ALWAYS read boundaries accurately!
            const rimMix = n > 0.72 ? pal.wallLight : pal.wallTrim;
            r = rimMix[0];
            g = rimMix[1];
            b = rimMix[2];
          } else if (adjFloor2) {
            r = pal.wallLight[0];
            g = pal.wallLight[1];
            b = pal.wallLight[2];
          } else {
            // Brick pattern
            const brickRow = (y >> 3);
            const bx = (x + (brickRow & 1) * 7) % 14;
            const by = y % 8;
            const isMortar = bx === 0 || by === 0;

            if (isMortar) {
              r = pal.wallDark[0];
              g = pal.wallDark[1];
              b = pal.wallDark[2];
            } else {
              const shade = n < 0.2 ? pal.wallDark : n > 0.84 ? pal.wallLight : pal.wallMid;
              r = shade[0];
              g = shade[1];
              b = shade[2];
            }
          }
        } else {
          // WALKABLE FLOOR PIXEL — Cobblestone/tile grid + edge shadow
          const wd = wallDist[idx];
          const tileEdge = x % 8 === 0 || y % 8 === 0;
          const base = tileEdge || n < 0.35 ? pal.floorDark : pal.floorMid;
          r = base[0];
          g = base[1];
          b = base[2];

          // Subtle edge darkening right next to walls
          if (wd <= 1) {
            r = (r * 0.72) | 0;
            g = (g * 0.72) | 0;
            b = (b * 0.72) | 0;
          }
        }

        // Apply subtle bloodstains
        for (let s = 0; s < stains.length; s++) {
          const st = stains[s];
          const d = Math.hypot(x - st.x, y - st.y);
          if (d < st.r && n > 0.42) {
            const blend = (1 - d / st.r) * (m === 0 ? 0.45 : 0.35);
            r = (r * (1 - blend) + pal.blood[0] * blend) | 0;
            g = (g * (1 - blend) + pal.blood[1] * blend) | 0;
            b = (b * (1 - blend) + pal.blood[2] * blend) | 0;
            break;
          }
        }

        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    // Draw subtle chalk ritual ring in the exact center sanctuary
    ctx.strokeStyle = "rgba(180, 70, 78, 0.38)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(CX, CY, levelDef.sanctuaryRadius - 2, 0, Math.PI * 2);
    ctx.stroke();

    // Small center crosshair marks
    ctx.fillStyle = "rgba(210, 120, 110, 0.4)";
    ctx.fillRect(CX - 3, CY, 7, 1);
    ctx.fillRect(CX, CY - 3, 1, 7);

    return canvas;
  }

  function buildLevelData(levelDef) {
    const mask = new Uint8Array(W * H);
    const radius = levelDef.corridorWidth / 2;

    // Carve all corridor polylines
    for (let p = 0; p < levelDef.paths.length; p++) {
      const poly = levelDef.paths[p];
      for (let i = 0; i < poly.length - 1; i++) {
        carveSegment(
          mask,
          poly[i][0],
          poly[i][1],
          poly[i + 1][0],
          poly[i + 1][1],
          radius,
          1
        );
      }
    }

    // Carve safe center spawn chamber at EXACT (160, 100)
    carveCircle(mask, CX, CY, levelDef.sanctuaryRadius, 1);

    // Carve Exit Chamber (walkable rim + exit trigger core)
    const [ex, ey] = levelDef.exitPos;
    carveCircle(mask, ex, ey, levelDef.exitRadius + 1, 1);
    carveCircle(mask, ex, ey, levelDef.exitRadius - 1, 2);

    // Guarantee outer 2px border is ALWAYS lethal wall
    for (let x = 0; x < W; x++) {
      mask[x] = 0;
      mask[W + x] = 0;
      mask[(H - 1) * W + x] = 0;
      mask[(H - 2) * W + x] = 0;
    }
    for (let y = 0; y < H; y++) {
      mask[y * W] = 0;
      mask[y * W + 1] = 0;
      mask[y * W + (W - 1)] = 0;
      mask[y * W + (W - 2)] = 0;
    }

    const wallDist = computeWallDistance(mask);
    const rand = mulberry32(levelDef.seed || levelDef.id * 7919 + 1337);
    const eyes = placeWallEyes(mask, rand, 6 + Math.min(5, levelDef.id));
    const bakedCanvas = bakeMazeCanvas(levelDef, mask, wallDist, rand);

    return {
      def: levelDef,
      mask,
      wallDist,
      eyes,
      bakedCanvas,
    };
  }

  // Procedural tight pixel maze for Endless Nightmare mode
  function generateEndlessLevel(floorNum) {
    const cols = 15;
    const rows = 9;
    const step = 20;
    const startCol = 7; // maps to exact CX = 160
    const startRow = 4; // maps to exact CY = 100

    const seed = (Date.now() ^ (floorNum * 2654435761)) >>> 0;
    const rand = mulberry32(seed);

    const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
    const adj = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [])
    );
    const paths = [];

    // Recursive backtracker (iterative stack)
    const stack = [[startCol, startRow]];
    visited[startRow][startCol] = 1;

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    const cellToXY = (c, r) => [
      CX + (c - startCol) * step,
      CY + (r - startRow) * step,
    ];

    while (stack.length > 0) {
      const [c, r] = stack[stack.length - 1];
      const neighbors = [];
      for (let i = 0; i < 4; i++) {
        const nc = c + dirs[i][0];
        const nr = r + dirs[i][1];
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[nr][nc]) {
          neighbors.push([nc, nr]);
        }
      }
      if (neighbors.length === 0) {
        stack.pop();
      } else {
        const [nc, nr] = neighbors[(rand() * neighbors.length) | 0];
        visited[nr][nc] = 1;
        adj[r][c].push([nc, nr]);
        adj[nr][nc].push([c, r]);
        paths.push([cellToXY(c, r), cellToXY(nc, nr)]);
        stack.push([nc, nr]);
      }
    }

    // BFS from center to place Exit Portal at the furthest cell
    const distGrid = Array.from({ length: rows }, () => new Int16Array(cols).fill(-1));
    const q = [[startCol, startRow]];
    distGrid[startRow][startCol] = 0;
    let bestCell = [startCol, startRow];
    let bestDist = 0;

    for (let qi = 0; qi < q.length; qi++) {
      const [c, r] = q[qi];
      const d = distGrid[r][c];
      if (d > bestDist) {
        bestDist = d;
        bestCell = [c, r];
      }
      for (const [nc, nr] of adj[r][c]) {
        if (distGrid[nr][nc] === -1) {
          distGrid[nr][nc] = d + 1;
          q.push([nc, nr]);
        }
      }
    }

    const corridorWidth = Math.max(7, 11 - Math.floor((floorNum - 1) / 2));
    const pal = PALETTES[(floorNum - 1) % PALETTES.length];

    const levelDef = {
      id: 100 + floorNum,
      seed,
      name: `NIGHTMARE DEPTH ${floorNum}`,
      subtitle: "PROCEDURAL LABYRINTH. NO MERCY.",
      corridorWidth,
      sanctuaryRadius: 12,
      exitRadius: 9,
      lightRadius: Math.max(44, 62 - floorNum * 2),
      ambientLight: Math.max(0.12, 0.22 - floorNum * 0.015),
      palette: pal,
      exitPos: cellToXY(bestCell[0], bestCell[1]),
      paths,
    };

    return buildLevelData(levelDef);
  }

  global.MazeLevels = {
    W,
    H,
    CX,
    CY,
    CAMPAIGN_LEVELS,
    buildLevelData,
    generateEndlessLevel,
  };
})(window);
