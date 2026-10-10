(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Nonogram = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const CACHE = new Map();
  const MAX_ATTEMPTS = 400;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRng(seed) {
    const next = mulberry32(seed);
    return {
      next,
      int(max) {
        return Math.floor(next() * max);
      },
    };
  }

  function allPlacements(clues, length) {
    const key = length + ":" + clues.join(",");
    const hit = CACHE.get(key);
    if (hit) return hit;

    const results = [];
    if (clues.length === 0) {
      results.push(0);
      CACHE.set(key, results);
      return results;
    }

    const need = clues.reduce((sum, clue) => sum + clue, 0) + clues.length - 1;
    if (need > length) {
      CACHE.set(key, results);
      return results;
    }

    function walk(index, minStart, bits) {
      if (index === clues.length) {
        results.push(bits);
        return;
      }
      let tail = 0;
      for (let j = index + 1; j < clues.length; j++) tail += clues[j] + 1;
      const maxStart = length - clues[index] - tail;
      for (let start = minStart; start <= maxStart; start++) {
        let nextBits = bits;
        for (let k = 0; k < clues[index]; k++) nextBits |= 1 << (start + k);
        walk(index + 1, start + clues[index] + 1, nextBits);
      }
    }

    walk(0, 0, 0);
    CACHE.set(key, results);
    return results;
  }

  function cluesOfLine(cells) {
    const clues = [];
    let run = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i]) run++;
      else if (run) {
        clues.push(run);
        run = 0;
      }
    }
    if (run) clues.push(run);
    return clues;
  }

  function buildClues(solution, rows, cols) {
    const rowClues = [];
    const colClues = [];
    for (let r = 0; r < rows; r++) {
      const line = [];
      for (let c = 0; c < cols; c++) line.push(solution[r * cols + c]);
      rowClues.push(cluesOfLine(line));
    }
    for (let c = 0; c < cols; c++) {
      const line = [];
      for (let r = 0; r < rows; r++) line.push(solution[r * cols + c]);
      colClues.push(cluesOfLine(line));
    }
    return { rows: rowClues, cols: colClues };
  }

  function maskOf(grid, cols, lineLength, isRow, index, value) {
    let mask = 0;
    for (let i = 0; i < lineLength; i++) {
      const cell = isRow ? grid[index * cols + i] : grid[i * cols + index];
      if (cell === value) mask |= 1 << i;
    }
    return mask;
  }

  // Returns changed column or row indexes, or null on contradiction.
  function constrainLine(grid, cols, lineLength, isRow, index, clues) {
    const fill = maskOf(grid, cols, lineLength, isRow, index, 1);
    const empty = maskOf(grid, cols, lineLength, isRow, index, 2);
    if (fill & empty) return null;

    const placements = allPlacements(clues, lineLength);
    let possible = 0;
    let mustFill = (1 << lineLength) - 1;
    let found = 0;
    for (let p = 0; p < placements.length; p++) {
      const bits = placements[p];
      if ((bits & fill) !== fill) continue;
      if (bits & empty) continue;
      mustFill &= bits;
      possible |= bits;
      found++;
    }
    if (!found) return null;

    const mustEmpty = ((1 << lineLength) - 1) & ~possible;
    const changed = [];
    for (let i = 0; i < lineLength; i++) {
      const idx = isRow ? index * cols + i : i * cols + index;
      let next = 0;
      if ((mustFill >> i) & 1) next = 1;
      else if ((mustEmpty >> i) & 1) next = 2;
      if (!next) continue;
      if (grid[idx] !== 0 && grid[idx] !== next) return null;
      if (grid[idx] === 0) {
        grid[idx] = next;
        changed.push(i);
      }
    }
    return changed;
  }

  function propagate(grid, rowClues, colClues, dirtyRows, dirtyCols) {
    const rowCount = rowClues.length;
    const colCount = colClues.length;
    const rowDirty =
      dirtyRows || Uint8Array.from({ length: rowCount }, () => 1);
    const colDirty =
      dirtyCols || Uint8Array.from({ length: colCount }, () => 1);
    const rows = [];
    const cols = [];
    for (let i = 0; i < rowCount; i++) if (rowDirty[i]) rows.push(i);
    for (let i = 0; i < colCount; i++) if (colDirty[i]) cols.push(i);

    while (rows.length || cols.length) {
      while (rows.length) {
        const r = rows.pop();
        rowDirty[r] = 0;
        const changed = constrainLine(
          grid,
          colCount,
          colCount,
          true,
          r,
          rowClues[r],
        );
        if (!changed) return false;
        for (let i = 0; i < changed.length; i++) {
          const c = changed[i];
          if (!colDirty[c]) {
            colDirty[c] = 1;
            cols.push(c);
          }
        }
      }
      while (cols.length) {
        const c = cols.pop();
        colDirty[c] = 0;
        const changed = constrainLine(
          grid,
          colCount,
          rowCount,
          false,
          c,
          colClues[c],
        );
        if (!changed) return false;
        for (let i = 0; i < changed.length; i++) {
          const r = changed[i];
          if (!rowDirty[r]) {
            rowDirty[r] = 1;
            rows.push(r);
          }
        }
      }
    }
    return true;
  }

  function isComplete(grid) {
    for (let i = 0; i < grid.length; i++) if (grid[i] === 0) return false;
    return true;
  }

  function matchesSolution(grid, solution) {
    for (let i = 0; i < solution.length; i++) {
      const want = solution[i] ? 1 : 2;
      if (grid[i] !== want) return false;
    }
    return true;
  }

  // maxDepth 0: overlapping line placements only.
  // maxDepth 1: also force a cell when the other value contradicts by line logic.
  function solve(rowClues, colClues, maxDepth) {
    const rowCount = rowClues.length;
    const colCount = colClues.length;
    const grid = new Uint8Array(rowCount * colCount);
    let depthUsed = 0;
    if (!propagate(grid, rowClues, colClues)) {
      return { solved: false, grid, depthUsed };
    }

    if (maxDepth > 0) {
      if (grid.length > 100) {
        let unknown = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] === 0) unknown++;
        if (unknown > 90) return { solved: false, grid, depthUsed: 0 };
      }
      let moved = true;
      while (moved && !isComplete(grid)) {
        moved = false;
        for (let i = 0; i < grid.length && !moved; i++) {
          if (grid[i] !== 0) continue;
          const row = (i / colCount) | 0;
          const col = i - row * colCount;
          for (let guess = 1; guess <= 2; guess++) {
            const snap = grid.slice();
            grid[i] = guess;
            const rowDirty = new Uint8Array(rowCount);
            const colDirty = new Uint8Array(colCount);
            rowDirty[row] = 1;
            colDirty[col] = 1;
            const ok = propagate(grid, rowClues, colClues, rowDirty, colDirty);
            grid.set(snap);
            if (!ok) {
              grid[i] = guess === 1 ? 2 : 1;
              depthUsed = 1;
              rowDirty.fill(0);
              colDirty.fill(0);
              rowDirty[row] = 1;
              colDirty[col] = 1;
              if (!propagate(grid, rowClues, colClues, rowDirty, colDirty)) {
                return { solved: false, grid, depthUsed };
              }
              moved = true;
              break;
            }
          }
        }
      }
    }

    return { solved: isComplete(grid), grid, depthUsed };
  }

  function genBlocks(rows, cols, rng, blocks, maxW, maxH) {
    const grid = new Uint8Array(rows * cols);
    const widthCap = Math.max(1, Math.min(maxW, cols - 1));
    const heightCap = Math.max(1, Math.min(maxH, rows - 1));
    for (let b = 0; b < blocks; b++) {
      const w = 1 + rng.int(widthCap);
      const h = 1 + rng.int(heightCap);
      const x = rng.int(cols - w + 1);
      const y = rng.int(rows - h + 1);
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) grid[yy * cols + xx] = 1;
      }
    }
    return grid;
  }

  function genNoise(rows, cols, rng, base, stick) {
    const grid = new Uint8Array(rows * cols);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let p = base;
        if (x && grid[y * cols + x - 1]) p += stick;
        if (y && grid[(y - 1) * cols + x]) p += stick * 0.75;
        if (p > 0.92) p = 0.92;
        grid[y * cols + x] = rng.next() < p ? 1 : 0;
      }
    }
    return grid;
  }

  function punchHoles(grid, rng, holes) {
    const filled = [];
    for (let i = 0; i < grid.length; i++) if (grid[i]) filled.push(i);
    for (let h = 0; h < holes && filled.length; h++) {
      const pick = rng.int(filled.length);
      grid[filled[pick]] = 0;
      filled.splice(pick, 1);
    }
    return grid;
  }

  function lineCounts(grid, rows, cols) {
    const rowCounts = new Uint8Array(rows);
    const colCounts = new Uint8Array(cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid[r * cols + c]) continue;
        rowCounts[r]++;
        colCounts[c]++;
      }
    }
    return { rowCounts, colCounts };
  }

  function pickIndex(pool, rng, fallback) {
    if (!pool.length) return fallback;
    return pool[rng.int(pool.length)];
  }

  // Every row and column must contain ink and paper. Empty lines and solid lines are rejected later.
  function repairLines(grid, rows, cols, rng) {
    const passes = Math.max(rows, cols);
    for (let pass = 0; pass < passes; pass++) {
      const { rowCounts, colCounts } = lineCounts(grid, rows, cols);
      let changed = false;

      for (let r = 0; r < rows; r++) {
        if (rowCounts[r] !== cols) continue;
        const options = [];
        for (let c = 0; c < cols; c++) if (colCounts[c] > 1) options.push(c);
        const c = pickIndex(options, rng, rng.int(cols));
        grid[r * cols + c] = 0;
        rowCounts[r]--;
        colCounts[c]--;
        changed = true;
      }

      for (let c = 0; c < cols; c++) {
        if (colCounts[c] !== rows) continue;
        const options = [];
        for (let r = 0; r < rows; r++) if (rowCounts[r] > 1) options.push(r);
        const r = pickIndex(options, rng, rng.int(rows));
        grid[r * cols + c] = 0;
        rowCounts[r]--;
        colCounts[c]--;
        changed = true;
      }

      for (let r = 0; r < rows; r++) {
        if (rowCounts[r] !== 0) continue;
        const preferred = [];
        const backup = [];
        for (let c = 0; c < cols; c++) {
          if (colCounts[c] >= rows - 1) continue;
          const touches =
            (r > 0 && grid[(r - 1) * cols + c]) ||
            (r + 1 < rows && grid[(r + 1) * cols + c]);
          if (touches) preferred.push(c);
          else backup.push(c);
        }
        const c = pickIndex(
          preferred.length ? preferred : backup,
          rng,
          rng.int(cols),
        );
        grid[r * cols + c] = 1;
        rowCounts[r]++;
        colCounts[c]++;
        changed = true;
      }

      for (let c = 0; c < cols; c++) {
        if (colCounts[c] !== 0) continue;
        const preferred = [];
        const backup = [];
        for (let r = 0; r < rows; r++) {
          if (rowCounts[r] >= cols - 1) continue;
          const touches =
            (c > 0 && grid[r * cols + c - 1]) ||
            (c + 1 < cols && grid[r * cols + c + 1]);
          if (touches) preferred.push(r);
          else backup.push(r);
        }
        const r = pickIndex(
          preferred.length ? preferred : backup,
          rng,
          rng.int(rows),
        );
        grid[r * cols + c] = 1;
        rowCounts[r]++;
        colCounts[c]++;
        changed = true;
      }

      if (!changed) break;
    }
    return grid;
  }

  function candidate(rows, cols, difficulty, rng) {
    const small = rows <= 5 && cols <= 5;
    const large = rows >= 16 || cols >= 16;
    let grid;
    if (difficulty === "easy") {
      if (small) grid = genBlocks(rows, cols, rng, 2 + rng.int(2), 3, 2);
      else if (large) grid = genBlocks(rows, cols, rng, 7 + rng.int(3), 8, 5);
      else grid = genBlocks(rows, cols, rng, 4 + rng.int(2), 4, 3);
    } else if (large) {
      grid = genBlocks(rows, cols, rng, 6 + rng.int(2), 7, 4);
      punchHoles(grid, rng, 2 + rng.int(2));
    } else {
      const roll = rng.int(3);
      if (roll === 0) {
        grid = genBlocks(
          rows,
          cols,
          rng,
          small ? 3 + rng.int(2) : 5 + rng.int(3),
          small ? 2 : 3,
          2,
        );
        punchHoles(grid, rng, small ? 1 + rng.int(2) : 2 + rng.int(3));
      } else if (roll === 1) grid = genNoise(rows, cols, rng, 0.22, 0.28);
      else grid = genNoise(rows, cols, rng, 0.34, 0.12);
    }
    return repairLines(grid, rows, cols, rng);
  }

  function isSolidRectangle(solution, rows, cols) {
    let minR = rows;
    let maxR = -1;
    let minC = cols;
    let maxC = -1;
    let filled = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!solution[r * cols + c]) continue;
        filled++;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
    if (!filled) return true;
    return filled === (maxR - minR + 1) * (maxC - minC + 1);
  }

  function hasExtremeLine(solution, rows, cols) {
    const { rowCounts, colCounts } = lineCounts(solution, rows, cols);
    for (let r = 0; r < rows; r++) {
      if (rowCounts[r] === 0 || rowCounts[r] === cols) return true;
    }
    for (let c = 0; c < cols; c++) {
      if (colCounts[c] === 0 || colCounts[c] === rows) return true;
    }
    return false;
  }

  function acceptableShape(solution, rows, cols) {
    if (hasExtremeLine(solution, rows, cols)) return false;
    if (isSolidRectangle(solution, rows, cols)) return false;
    return true;
  }

  function nudge(grid, rows, cols, rng, harder) {
    if (harder) {
      const filled = [];
      for (let i = 0; i < grid.length; i++) if (grid[i]) filled.push(i);
      if (filled.length) grid[filled[rng.int(filled.length)]] = 0;
      return;
    }
    const options = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (grid[i]) continue;
        if (
          (c > 0 && grid[i - 1]) ||
          (c + 1 < cols && grid[i + 1]) ||
          (r > 0 && grid[i - cols]) ||
          (r + 1 < rows && grid[i + cols])
        ) {
          options.push(i);
        }
      }
    }
    if (options.length) grid[options[rng.int(options.length)]] = 1;
  }

  function generatePuzzle(rows, cols, difficulty, seed) {
    rows = Number(rows);
    cols = Number(cols);
    if (
      !Number.isInteger(rows) ||
      !Number.isInteger(cols) ||
      rows < 2 ||
      cols < 2
    )
      throw new Error("rows and cols must be integers >= 2");
    if (difficulty !== "easy" && difficulty !== "medium")
      throw new Error("bad difficulty");
    const numericSeed = seed >>> 0;
    if (!numericSeed) throw new Error("seed must be non-zero");

    const rng = createRng(numericSeed);
    const reasons = { shape: 0, unsolved: 0, depth: 0, mismatch: 0 };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const solution = candidate(rows, cols, difficulty, rng);
      const climb = rows >= 16 && difficulty === "medium";
      const steps = climb ? 8 : 1;
      for (let step = 0; step < steps; step++) {
        if (climb && hasExtremeLine(solution, rows, cols)) {
          repairLines(solution, rows, cols, rng);
        }
        if (!acceptableShape(solution, rows, cols)) {
          reasons.shape++;
          if (!climb) break;
          nudge(solution, rows, cols, rng, false);
          continue;
        }
        const clues = buildClues(solution, rows, cols);
        const maxDepth = difficulty === "easy" ? 0 : 1;
        const result = solve(clues.rows, clues.cols, maxDepth);
        if (!result.solved) {
          reasons.unsolved++;
          if (!climb) break;
          nudge(solution, rows, cols, rng, false);
          continue;
        }
        if (difficulty === "medium" && result.depthUsed !== 1) {
          reasons.depth++;
          if (!climb) break;
          nudge(solution, rows, cols, rng, true);
          continue;
        }
        if (!matchesSolution(result.grid, solution)) {
          reasons.mismatch++;
          break;
        }
        return {
          rows,
          cols,
          difficulty,
          seed: numericSeed,
          solution,
          rowClues: clues.rows,
          colClues: clues.cols,
          depthUsed: result.depthUsed,
        };
      }
    }
    throw new Error(
      "no puzzle for seed " + numericSeed + " " + JSON.stringify(reasons),
    );
  }

  return {
    createRng,
    allPlacements,
    cluesOfLine,
    buildClues,
    solve,
    generatePuzzle,
  };
});
